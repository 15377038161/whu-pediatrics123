import { createHash } from 'node:crypto';
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import type { CaseMedia } from '@/domain/agent';
import { decodeCaseMedia } from '@/lib/case-media';

/**
 * 结构化病例快照（来源：平台知识库召回）
 * - 仅当本地 knowledge/teaching-cases/{id}.json 缺失时，用知识库召回构建快照。
 * - 快照内容全部来自真实召回分片，不做任何模型补造；解析仅做分段与脱敏。
 * - 来源校验（失败关闭）：召回候选按可信来源标题精确匹配（已审核源名派生，
 *   正文 {源名}.txt / 影像册 {源名}_完整影像资料册.pdf）；标题缺失或异源候选一律拒绝，
 *   不以 clean()/schema 合格或关键词相近替代来源校验；无独立来源（folder 空）不召回，
 *   保持「资料不足」不编造（此前 NRDS 曾混入先天性肌力分片，2026-10-10 修复）。
 * - 版本绑定：快照全文 sha256 指纹作为版本号；会话首次加载时绑定该版本，
 *   之后读取（含服务重启后）优先按绑定版本从数据库持久缓存恢复，不因 TTL/重启换患者事实。
 * - 数据库持久缓存：case_snapshot_facts（登录可读的教学事实，不含诊断答案）+
 *   case_snapshot_answers（仅教师：诊断/诊疗经过/原文分片/媒体 URL）。
 * - 注意：不 import teacher-case-data（其回退读取本模块，避免循环依赖）。
 */

function getTeacherSourceId(caseId: string): string {
  const decoded = decodeURIComponent(caseId);
  return TEACHER_CASE_LINKS[decoded]?.sourceId ?? decoded;
}

/** 可信来源标题（权威映射派生）：正文 txt 与同源影像资料册 pdf，均由已审核目录源名精确派生。
 *  仅用于精确匹配，不做关键词/正文包含判断（同源影像册属同一已审核来源文件夹材料）。 */
export function trustedSourceTitles(sourceName: string): string[] {
  return [`${sourceName}.txt`, `${sourceName}_完整影像资料册.pdf`];
}

/** 来源校验（失败关闭）：候选标题必须与可信标题 trim 后完全一致；
 *  标题缺失/为空（来源不可证）或异源（跨病例混召）一律拒绝。 */
export function isTrustedSourceTitle(title: string | null | undefined, trusted: readonly string[]): boolean {
  const t = (title ?? '').trim();
  return t.length > 0 && trusted.includes(t);
}

/** 召回候选来源过滤（纯函数，供单测注入异源/同源/空标题夹具）：仅保留可信标题精确匹配的候选。 */
export function filterTrustedRecallCandidates<T extends { title: string | null }>(items: readonly T[], trusted: readonly string[]): T[] {
  return items.filter((item) => isTrustedSourceTitle(item.title, trusted));
}

export const KB_DOC_ID = '3821591';
const SNAPSHOT_TTL_MS = 10 * 60_000;

export interface CaseSnapshotMedia {
  url: string;
  caption: string;
}

export interface CaseSnapshotMeta {
  caseId: string;
  sourceName: string;
  sourceKb: string;
  builtAt: string;
  chunkCount: number;
  mediaCount: number;
  /** 固定事实、原文与媒体绑定的内容指纹（算法v2），用于会话绑定与数据库恢复。 */
  version: string;
}

interface SnapshotEntry {
  data: SnapshotCaseData;
  media: CaseSnapshotMedia[];
  meta: CaseSnapshotMeta;
  expiresAt: number;
  inflight?: Promise<SnapshotResult | null>;
}

export interface SnapshotCaseData {
  caseId: string;
  sourceName: string;
  sourceDocument: string;
  age: string;
  sex: string;
  complaint: string;
  sections: { history: string; exam: string; tests: string; diagnosis: string; plan: string };
  vitals: { temperature: number | null; heartRate: number | null; respiratoryRate: number | null; spo2: number | null };
  documents: Array<{ source: string; text: string; sha256: string }>;
  examMedia?: Array<{examId: string; media: CaseMedia[]}>;
}

export interface SnapshotResult {
  data: SnapshotCaseData;
  media: CaseSnapshotMedia[];
  meta: CaseSnapshotMeta;
}

const snapshotStore = new Map<string, SnapshotEntry>();

let cachedClient: KnowledgeClient | null = null;

function getKnowledgeClient(): KnowledgeClient {
  if (!cachedClient) {
    const apiKey = process.env.CODER_CODING_API_KEY?.trim();
    const baseUrl = process.env.CODER_CODING_BASE_URL?.trim();
    const config = new Config({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      timeout: 30_000,
    });
    cachedClient = new KnowledgeClient(config);
  }
  return cachedClient;
}

export function isKnowledgeConfigured(): boolean {
  return Boolean(process.env.CODER_CODING_API_KEY?.trim() && process.env.CODER_CODING_BASE_URL?.trim());
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 与 prepare-teacher-cases.py 一致的脱敏规则。 */
function clean(text: string): string {
  return text
    .replace(/(?:姓名|住院号|门诊号|病案号|身份证(?:号)?|联系电话|联系方式|电话|家庭住址|地址|籍贯|家长姓名|签名|医师姓名|记录医师)[：:\s]*[^\n，；。|]+/g, '[身份信息已隐去]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份信息已隐去]')
    .trim();
}

const SECTION_HEADERS: Array<{ pattern: RegExp; key: 'history' | 'exam' | 'tests' | 'diagnosis' | 'plan' }> = [
  { pattern: /^(?:入院查体|体格检查|体检|体查|查体|专科检查|PE\s*[:：])/i, key: 'exam' },
  { pattern: /^(?:辅助检查|辅检|入院(?:前|后)?[^:：]{0,10}(?:辅检|辅助检查|相关检查)|相关检查|实验室检查|检查结果|入院检查)/, key: 'tests' },
  { pattern: /^(?:入院诊断|出院诊断|初步诊断|最后诊断|诊断依据|诊断\s*[:：]|诊断$|鉴别诊断|目前情况|出院情况|目前诊断)/, key: 'diagnosis' },
  { pattern: /^(?:诊疗经过|诊治经过|治疗经过|治疗方案|诊疗计划|治疗\s*[:：]|治疗$|出院医嘱|出院指导)/, key: 'plan' },
  { pattern: /^(?:现病史|既往史|个人史|家族史|主诉|入院情况|病史特点|病例结构化摘要|病例摘要)/, key: 'history' },
];

/** 影像资料册/来源图片等分片噪声行（markdown 图片、编号说明、超声报告页眉脚），不进入教学正文分段。 */
function isMediaNoise(line: string): boolean {
  if (/!\[[^\]]*\]\([^)]+\)/.test(line)) return true;
  if (/(?:来源图片|来源影像|影像资料册)\s*\d*\s*\/\s*\d+/.test(line)) return true;
  if (/\d+\s*[-—－]\s*(?:来源图片|影像)/.test(line)) return true;
  if (/^(?:共\s*\d+\s*张|图片使用|病例事实与诊疗经过|仅供教学)/.test(line)) return true;
  if (/^(?:检查时间|诊断医生|注[:：]|超声检查有一定的局限性)/.test(line)) return true;
  if (/^(?:武汉|中南)?(?:大学)?(?:中南)?医院.*(?:报告单|检查报告)/.test(line)) return true;
  return false;
}

/** 行内前缀标题（如 "4.入院查体：…" "二、诊断 : …" "【诊疗经过】"）也切换段落。 */
function matchInlineHeader(line: string, normalized: string): keyof SnapshotCaseData['sections'] | null {
  // 形如 "数字/汉字序号 + 标题词 + 冒号或紧接正文"
  if (/^.{0,12}(?:查体|体格检查)[:：]/.test(line)) return 'exam';
  if (/^.{0,12}(?:辅检|辅助检查|相关检查|实验室检查)[:：]/.test(line)) return 'tests';
  if (/^.{0,12}(?:诊疗经过|诊治经过|治疗经过|治疗方案|出院医嘱)[:：]/.test(line)) return 'plan';
  if (/^.{0,12}(?:诊断)[:：\s]/.test(line) && /诊断/.test(normalized)) return 'diagnosis';
  if (/^【(现病史|既往史|个人史|家族史|主诉|病史)】/.test(line)) return 'history';
  if (/^【(查体|体格检查)】/.test(line)) return 'exam';
  if (/^【(辅助检查|辅检|检查)】/.test(line)) return 'tests';
  if (/^【(诊断)】/.test(line)) return 'diagnosis';
  if (/^【(诊疗经过|治疗经过|处置)】/.test(line)) return 'plan';
  return null;
}

export function splitSnapshotSections(text: string): SnapshotCaseData['sections'] {
  const buckets: Record<keyof SnapshotCaseData['sections'], string[]> = { history: [], exam: [], tests: [], diagnosis: [], plan: [] };
  let current: keyof typeof buckets = 'history';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || isMediaNoise(line)) continue;
    const normalized = line.replace(/^[一二三四五六七八九十\d、.．（）()\s]+/, '');
    const explicitTests = /^(?:辅助检查|辅检|相关检查|实验室检查|检查结果|入院检查)\s*(?:[:：]|$)/.test(normalized)
      || /^【(?:辅助检查|辅检|检查)】/.test(line);
    const matched = SECTION_HEADERS.find(item => item.pattern.test(normalized)
      && !(current === 'plan' && item.key === 'tests' && !explicitTests));
    // A numbered diagnosis is a diagnosis, not a match for the first exam rule.
    if (/^[一二三四五六七八九十]+[、.．]\s*诊断/.test(line)) current = 'diagnosis';
    else if (matched) current = matched.key;
    else {
      const inline = matchInlineHeader(line, normalized);
      if (inline && !(current === 'plan' && inline === 'tests' && !explicitTests)) current = inline;
    }
    buckets[current].push(line);
  }
  return { history: buckets.history.join('\n').trim(), exam: buckets.exam.join('\n').trim(), tests: buckets.tests.join('\n').trim(), diagnosis: buckets.diagnosis.join('\n').trim(), plan: buckets.plan.join('\n').trim() };
}

function extractNumber(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? Number.parseFloat(match[1]) : null;
}

function extractImageUrls(content: string): CaseSnapshotMedia[] {
  const results: CaseSnapshotMedia[] = [];
  const re = /!\[[^\]]*\]\((https:\/\/p\.cldisk\.com\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    results.push({ url: match[1], caption: '病例来源图片' });
  }
  return results;
}

async function recallCaseChunks(client: KnowledgeClient, caseName: string, trustedTitles: readonly string[]): Promise<Array<{ text: string; sha: string }>> {
  // “来源图片”变体用于召回影像资料册分片（媒体 URL 主要存在于该类分片中的可信来源材料内）。
  const variants = [caseName, `${caseName} 现病史 主诉 查体`, `${caseName} 诊断 诊疗经过`, `${caseName} 来源图片`];
  const raw: Array<{ title: string | null; content: string | null }> = [];
  for (const query of variants) {
    const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
    raw.push(...result.results.map((item) => ({ title: item.title, content: item.content })));
  }
  // 来源校验（失败关闭）：异源候选（跨病例混召）与空标题候选（来源不可证）一律拒绝，
  // 不拼入其他患者事实，不以 clean()/schema 合格或关键词相近替代来源校验。
  const trusted = filterTrustedRecallCandidates(raw, trustedTitles);
  if (process.env.LOG_LEVEL === 'debug' && raw.length > trusted.length) {
    console.debug(`[case-snapshot] source filter: kept=${trusted.length} rejected=${raw.length - trusted.length} case=${caseName}`);
  }
  const seen = new Map<string, string>();
  for (const item of trusted) {
    const text = (item.content || '').trim();
    if (!text) continue;
    const sha = sha256(text);
    if (!seen.has(sha)) seen.set(sha, text);
  }
  return [...seen.entries()].map(([sha, text]) => ({ text, sha }));
}

/** 剥离图片 markdown 与来源图片说明后的纯文本长度，用于识别纯影像册分片。 */
function textOnlyLength(text: string): number {
  const stripped = text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/https:\/\/p\.cldisk\.com\/[^\s)!，。]+/g, '')
    .split('\n')
    .filter((line) => !isMediaNoise(line.trim()))
    .join('\n')
    .replace(/\s/g, '');
  return stripped.length;
}

const AGE_PATTERN = String.raw`(\d+(?:\.\d+)?\s*(?:岁(?:\s*\d+\s*(?:个)?月)?(?:\s*\d+\s*天)?|个?月(?:\s*\d+\s*天)?|天|小时|分钟))`;

/**
 * 从病史首段提取年龄/性别，按证据强度分优先级：
 *  1. 人口学句「患儿/患者，男，6岁」——年龄与性别同源，且不会被主诉病程时长（"发热3天"）抢先；
 *  2. 显式声明「性别：男」「年龄：6岁」（"性别：性别未记录"占位不匹配）；
 *  3. 内联性别「患儿，男」、最左年龄模式（历史兜底，可能取到病程时长，仅在前两级缺失时使用）。
 * 性别兼容「患者」句式（肝豆状核变性来源文本）；性别字后允许 性/婴/童（男性、男婴、男童/女童）或分隔符，
 * 拒绝"患者女儿"类误命中（女后跟随儿不匹配；儿不在允许集合内，童在集合内不影响该拒绝）。
 */
export function extractSnapshotDemographics(historyHead: string): { age?: string; sex?: string } {
  const demo = new RegExp(`(?:患儿|患者)[，,\\s]*(男|女)?[性婴童]?\\s*[，,]?\\s*${AGE_PATTERN}`).exec(historyHead);
  const sexDecl = /性别\s*[:：]?\s*(男|女)(?=[，,。；;、\s\d性婴童]|$)/.exec(historyHead);
  const ageDecl = new RegExp(`年龄\\s*[:：]?\\s*${AGE_PATTERN}`).exec(historyHead);
  const sexInline = /(?:患儿|患者)[，,\s]*(男|女)(?=[，,。；;、\s\d性婴童]|$)/.exec(historyHead);
  const ageAny = new RegExp(AGE_PATTERN).exec(historyHead);
  return {
    age: (demo?.[2] ?? ageDecl?.[1] ?? ageAny?.[1])?.replace(/\s/g, ''),
    sex: demo?.[1] ?? sexDecl?.[1] ?? sexInline?.[1],
  };
}

function buildSnapshot(caseId: string, caseName: string, chunks: Array<{ text: string; sha: string }>, media: CaseSnapshotMedia[]): SnapshotResult {
  const cleaned = chunks.map((chunk) => ({ ...chunk, text: clean(chunk.text) })).filter((chunk) => chunk.text);
  // 纯影像册分片（剥离图片后无有效正文）不进入教学正文分段，媒体 URL 已单独提取。
  const textChunks = cleaned.filter((chunk) => textOnlyLength(chunk.text) >= 80);
  const fullText = textChunks.map((chunk) => chunk.text).join('\n');
  const facts = splitSnapshotSections(fullText);
  const historyHead = facts.history.slice(0, 500);
  const { age, sex } = extractSnapshotDemographics(historyHead);
  const chief = /(?:主诉\s*[:：]|^\s*2[.．、])\s*([^\n]+)/m.exec(facts.history);
  const complaint = chief ? chief[1].replace(/^主诉\s*[:：]\s*/, '').replace(/[；;。]+$/, '') : '请向家长了解本次就诊的主要不适。';
  const data: SnapshotCaseData = {
      caseId,
      sourceName: caseName,
      sourceDocument: `知识库召回（${KB_DOC_ID}，${cleaned.length} 个分片）`,
      age: age ?? '年龄未记录',
      sex: sex ?? '性别未记录',
      complaint,
      sections: facts,
      vitals: {
        temperature: extractNumber(facts.exam, /(?:\bT|体温)\s*[:：]?\s*(\d{2}(?:\.\d+)?)\s*(?:℃|°?C)/i),
        heartRate: extractNumber(facts.exam, /(?:\bP\b|\bHR|心率|脉搏)\s*[:：]?\s*(\d{2,3})/),
        respiratoryRate: extractNumber(facts.exam, /(?:\bR\b|\bRR|呼吸频率|呼吸)\s*[:：]?\s*(\d{1,3})\s*(?:次|\/|bpm)/),
        spo2: extractNumber(facts.exam, /(?:SpO[₂2]|血氧饱和度|氧饱和度)\s*[:：]?\s*(\d{2,3})\s*%/i),
      },
      documents: cleaned.map((chunk) => ({ source: `knowledge-recall://${KB_DOC_ID}/${chunk.sha.slice(0, 12)}`, text: chunk.text, sha256: chunk.sha })),
  };
  return {
    data,
    media,
    meta: {
      caseId,
      sourceName: caseName,
      sourceKb: KB_DOC_ID,
      builtAt: new Date().toISOString(),
      chunkCount: cleaned.length,
      mediaCount: media.length,
      version: computeCaseDataVersion(data, media),
    },
  };
}

/** 确保某病例的快照可用（本地文件优先，召回兜底）；失败返回 null，不抛错。
 *  accessToken 提供时：召回成功后写入数据库持久缓存（facts 登录可读；answers 仅教师）。
 *  teacher=true 时同时持久化 answers（诊断/原文/媒体）；学生身份只持久化教学事实。 */
export async function ensureCaseSnapshot(caseId: string, options?: { accessToken?: string | null; teacher?: boolean }): Promise<SnapshotResult | null> {
  const sourceId = getTeacherSourceId(caseId);
  const item = TEACHER_CASE_CATALOG.find((entry) => entry.id === sourceId);
  if (!item) return null;
  // 来源守卫（失败关闭）：别名解析后仍无已审核来源文件夹（D 类 3 项缺独立来源）不召回，
  // 保持「资料不足」，不因关键词召回拼入其他患者事实。
  if (!item.folder) return null;
  const entry = snapshotStore.get(sourceId);
  if (entry && entry.expiresAt > Date.now()) return { data: entry.data, media: entry.media, meta: entry.meta };
  if (!isKnowledgeConfigured()) return null;
  if (entry?.inflight) return entry.inflight;
  const task = (async (): Promise<SnapshotResult | null> => {
    try {
      const client = getKnowledgeClient();
      const chunks = await recallCaseChunks(client, item.name, trustedSourceTitles(item.name));
      if (chunks.length === 0) return null;
      const media: CaseSnapshotMedia[] = [];
      for (const chunk of chunks) media.push(...extractImageUrls(chunk.text));
      const snapshot = buildSnapshot(sourceId, item.name, chunks, media);
      const expiresAt = Date.now() + SNAPSHOT_TTL_MS;
      // 多版本键：同病例不同快照版本独立缓存（sourceId@version），并发会话各取绑定版本，互不覆盖"换患者"；
      // sourceId 裸键仅作"最新版本"指针，供会话首次绑定（getSnapshotVersion）与教师预热读取。
      snapshotStore.set(`${sourceId}@${snapshot.meta.version}`, { data: snapshot.data, media: snapshot.media, meta: snapshot.meta, expiresAt });
      snapshotStore.set(sourceId, { data: snapshot.data, media: snapshot.media, meta: snapshot.meta, expiresAt });
      await persistSnapshot(options?.accessToken ?? null, snapshot, Boolean(options?.teacher));
      return snapshot;
    } catch (error) {
      if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] recall failed', sourceId, (error as Error).message);
      return null;
    } finally {
      const current = snapshotStore.get(sourceId);
      if (current) current.inflight = undefined;
    }
  })();
  const current: SnapshotEntry = snapshotStore.get(sourceId) ?? {
    data: null as unknown as SnapshotCaseData, media: [], meta: null as unknown as CaseSnapshotMeta, expiresAt: 0,
  };
  current.inflight = task;
  snapshotStore.set(sourceId, current);
  return task;
}


/** 教学事实子集（不含诊断/诊疗经过/原文/媒体）：学生可安全读取的持久缓存载荷。 */
function buildFactsPayload(snapshot: SnapshotResult): Omit<SnapshotCaseData, 'sections' | 'documents'> & { sections: Pick<SnapshotCaseData['sections'], 'history' | 'exam' | 'tests'> } {
  return {
    caseId: snapshot.data.caseId,
    sourceName: snapshot.data.sourceName,
    sourceDocument: snapshot.data.sourceDocument,
    age: snapshot.data.age,
    sex: snapshot.data.sex,
    complaint: snapshot.data.complaint,
    sections: { history: snapshot.data.sections.history, exam: snapshot.data.sections.exam, tests: snapshot.data.sections.tests },
    vitals: snapshot.data.vitals,
  };
}


/** 召回成功后写持久缓存（仅教师：facts+answers 双写。学生身份无写入权限，RLS 拦截，代码侧同步跳过）。 */
async function persistSnapshot(accessToken: string | null, snapshot: SnapshotResult, teacher: boolean): Promise<void> {
  if (!teacher || !accessToken || !isDatabaseConfigured()) return;
  try {
    const db = getSupabaseUserClient(accessToken);
    const { error: factsError } = await db.from('case_snapshot_facts')
      .upsert({ case_id: snapshot.data.caseId, version: snapshot.meta.version, source_name: snapshot.data.sourceName, facts: buildFactsPayload(snapshot) },
        { onConflict: 'case_id,version', ignoreDuplicates: true });
    if (factsError) throw factsError;
    if (teacher) {
      const { error: answersError } = await db.from('case_snapshot_answers')
        .upsert({
          case_id: snapshot.data.caseId,
          version: snapshot.meta.version,
          diagnosis: snapshot.data.sections.diagnosis,
          plan: snapshot.data.sections.plan,
          documents: snapshot.data.documents,
          media: snapshot.media,
        }, { onConflict: 'case_id,version', ignoreDuplicates: true });
      if (answersError) throw answersError;
    }
  } catch (error) {
    // 持久化失败不阻塞教学（进程内缓存仍可用），仅记录
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] persist failed', snapshot.data.caseId, (error as Error).message);
  }
}


/** 按绑定版本从数据库恢复教学事实（服务重启/TTL过期后防患者事实漂移）；失败返回 null。
 *  权限收紧后：学生不再直读 case_snapshot_facts（仅教师 RLS），改走受控 RPC case_snapshot_get_facts
 *  （服务端校验：登录 + 会话归属本人 + 版本绑定一致 + 病例匹配）。教师仍直读。 */
export async function restoreCaseSnapshotFacts(caseId: string, version: string, accessToken: string | null, role?: string, sessionId?: string): Promise<SnapshotCaseData | null> {
  const sourceId = getTeacherSourceId(caseId);
  if (!accessToken || !isDatabaseConfigured()) return null;
  try {
    const db = getSupabaseUserClient(accessToken);
    let facts: ReturnType<typeof buildFactsPayload> | null = null;
    if (role === 'student' && sessionId) {
      // 会话 RPC 传入口 ID；数据库先严格核绑定，再按可信映射查来源快照。
      // 学生：受控 RPC（会话归属+版本绑定+病例匹配，缺一返回 null）
      const { data: rpcData, error: rpcError } = await db.rpc('case_snapshot_get_facts', {
        p_case_id: decodeURIComponent(caseId), p_version: version, p_session_id: sessionId,
      });
      if (rpcError) throw rpcError;
      if (rpcData) facts = rpcData as ReturnType<typeof buildFactsPayload>;
    } else {
      // 教师直读（RLS app_is_teacher 放行）
      const { data, error } = await db.from('case_snapshot_facts').select('facts').eq('case_id', sourceId).eq('version', version).maybeSingle();
      if (error) throw error;
      if (data) facts = data.facts as ReturnType<typeof buildFactsPayload>;
      if (facts) {
        // Teacher supervision keeps its existing RLS-authorized read. Never reuse this
        // full private metadata in the student/session-scoped RPC cache.
        const {data: answer,error: bindingError}=await db.from('case_snapshot_answers')
          .select('binding_config').eq('case_id',sourceId).eq('version',version).maybeSingle();
        if (!bindingError && Array.isArray(answer?.binding_config?.examMedia)) {
          facts.examMedia=answer.binding_config.examMedia.filter((item: {examId?: unknown})=>typeof item?.examId==='string')
            .map((item: {examId:string;media:unknown})=>({examId:item.examId,media:decodeCaseMedia(item.media)}));
        }
      }
    }
    if (!facts) return null;
    // 学生受控 RPC 的阶段化事实投影（迁移 20261010120000）：未执行查体/开检查前
    // sections.exam/tests 被安全剥离（键缺失），完成会话补 diagnosis/plan 空串。
    // 恢复态必须规范化缺键为空串，否则 readTeacherCaseData 的 recordSchema 校验
    // （五键全 string）失败 → 冷启动会话整体降级"资料不足"（真实缺陷，实测定位）。
    const norm = (key: string): string => (typeof (facts!.sections as Record<string, unknown>)[key] === 'string' ? (facts!.sections as Record<string, unknown>)[key] as string : '');
    const restored: SnapshotCaseData = {
      ...facts,
      sections: {
        history: norm('history'),
        exam: norm('exam'),
        tests: norm('tests'),
        diagnosis: norm('diagnosis'),
        plan: norm('plan'),
      },
      documents: [],
    };
    // 缓存写入分作用域：
    // - 学生 RPC 恢复的是【按会话证据投影】的 facts（阶段化投影，迁移 20261010120000），
    //   仅对本人会话有效——写入会话作用域键 sourceId@version#sessionId，禁止跨会话共享：
    //   否则会话 B（未解锁，剥离态）的恢复覆盖共享键后，会话 A（已解锁）在回合 await 间隙
    //   再读即丢失已解锁内容；反向，A 的完整投影写入后 B 直接读取即绕过解锁（泄露）。
    // - 教师直读不受会话投影约束（RLS 放行全量 facts）：sessionId 提供时同时写会话作用域键
    //   （引擎/评分链路统一按会话作用域读取，教师会话命不中共享键）与共享版本键
    //   sourceId@version（供无会话上下文的读取路径，如建会话/预热）；教师内容为全量 facts，
    //   会话作用域键仅本人会话可命中，学生不可能读到教师会话的键。
    // 两者均不覆盖裸键（裸键是"最新版本"指针，只由 ensureCaseSnapshot 召回刷新）。
    const previous = snapshotStore.get(sourceId);
    const entry: SnapshotEntry = {
      data: restored,
      media: previous?.media ?? [],
      meta: { caseId: sourceId, sourceName: facts.sourceName, sourceKb: KB_DOC_ID, builtAt: new Date().toISOString(), chunkCount: 0, mediaCount: previous?.media.length ?? 0, version },
      expiresAt: Date.now() + SNAPSHOT_TTL_MS,
    };
    if (sessionId) snapshotStore.set(`${sourceId}@${version}#${sessionId}`, entry);
    if (role !== 'student') snapshotStore.set(`${sourceId}@${version}`, entry);
    return restored;
  } catch (error) {
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] restore failed', sourceId, (error as Error).message);
    return null;
  }
}

/** 会话作用域缓存是否为「已解锁证据但仍剥离」的过期投影（假阴性检测）。
 *  evidence.hasExam/hasTests 依据会话内 unlockedEvidence（EX_/SOURCE_EX_ 前缀）与 orderedTests 判定，
 *  与受控 RPC case_snapshot_get_facts 的投影门控口径一致（迁移 20261010120000）。 */
export function isProjectionStale(cached: SnapshotCaseData | null | undefined, evidence: { hasExam: boolean; hasTests: boolean }): boolean {
  if (!cached) return false;
  const staleExam = evidence.hasExam && !cached.sections.exam;
  const staleTests = evidence.hasTests && !cached.sections.tests;
  return staleExam || staleTests;
}

/** 会话内证据驱动的投影刷新：学生真实执行查体/开单后，受控 RPC 门控已按本人证据放行扩展投影，
 *  但会话作用域缓存仅在会话载入（loadSession 恢复路径）时写入一次剥离态——后续回合引擎规则匹配
 *  仍读剥离态，造成假阴性（病例实际有记录却判定无规则/资料未提供）。
 *  本函数按当前会话证据检测剥离态并重新走受控 RPC 恢复（RPC 以本人会话证据放行），
 *  仅刷新会话作用域缓存（restoreCaseSnapshotFacts 学生分支不写共享键/裸键）；
 *  无恢复态缓存（正常路径：本地文件/共享键）不动作，避免多余 RPC。 */
export async function refreshProjectedFacts(caseId: string, version: string, sessionId: string, accessToken: string | null, evidence: { hasExam: boolean; hasTests: boolean }): Promise<void> {
  const sourceId = getTeacherSourceId(caseId);
  const cached = snapshotStore.get(`${sourceId}@${version}#${sessionId}`);
  if (!cached || cached.expiresAt <= Date.now()) return;
  if (!isProjectionStale(cached.data, evidence)) return;
  await restoreCaseSnapshotFacts(caseId, version, accessToken, 'student', sessionId);
}

/** 会话作用域检查目录缓存（无答案，仅 id/label）：
 *  恢复态投影剥离 sections.tests（未开单）时，目录经 case_snapshot_list_tests 注入，
 *  保证学生可见可下单目录（目录/结果分离死锁修复）。目录不含结果文本，缓存无泄露面。 */
interface SessionTestsCatalogEntry {
  version: string;
  items: Array<{ id: string; label: string }>;
  expiresAt: number;
}
const testsCatalogStore = new Map<string, SessionTestsCatalogEntry>();
const TESTS_CATALOG_TTL_MS = 30 * 60_000;

export function setSessionTestsCatalog(sessionId: string, version: string, items: Array<{ id: string; label: string }>): void {
  testsCatalogStore.set(sessionId, { version, items, expiresAt: Date.now() + TESTS_CATALOG_TTL_MS });
}

export function getSessionTestsCatalog(caseId: string, version: string | null | undefined, sessionId: string | null | undefined): Array<{ id: string; label: string }> | null {
  if (!sessionId) return null;
  const entry = testsCatalogStore.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  if (entry.version !== (version ?? null)) return null;
  return entry.items;
}

/** 读取本人会话的无答案检查目录（case_snapshot_list_tests，门控：归属+版本+病例）。
 *  失败返回 null（fail-closed，不编造目录）。 */
export async function listCaseTests(caseId: string, version: string, sessionId: string, accessToken: string | null): Promise<Array<{ id: string; label: string }> | null> {
  const sourceId = getTeacherSourceId(caseId);
  if (!accessToken || !isDatabaseConfigured()) return null;
  try {
    const db = getSupabaseUserClient(accessToken);
    const { data, error } = await db.rpc('case_snapshot_list_tests', { p_case_id: decodeURIComponent(caseId), p_version: version, p_session_id: sessionId });
    if (error) throw error;
    if (!Array.isArray(data)) return null;
    return data.filter((item): item is { id: string; label: string } => Boolean(item && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { label?: unknown }).label === 'string'));
  } catch (error) {
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] list tests failed', sourceId, (error as Error).message);
    return null;
  }
}

/** 持久化下单（case_snapshot_record_test_order，幂等原子追加 orderedTests）：
 *  先落库下单、再行级取结果——get_test 的已下单验证依赖 DB 状态，先记单后取结果不产生死锁。
 *  返回 orderedTests 数组；守卫拒绝（归属/版本/病例/完成态/项目越界）返回 null；
 *  网络/权限错误抛出（调用方不得伪记成功下单或资料未提供）。
 *  无 token / 未配置 DB 时返回 null（预览内存模式由引擎状态 + saveSession 持久化，不经此 RPC）。 */
export async function recordCaseTestOrder(caseId: string, version: string, sessionId: string, accessToken: string | null, testId: string): Promise<string[] | null> {
  const sourceId = getTeacherSourceId(caseId);
  if (!accessToken || !isDatabaseConfigured()) return null;
  try {
    const db = getSupabaseUserClient(accessToken);
    const { data, error } = await db.rpc('case_snapshot_record_test_order', { p_case_id: decodeURIComponent(caseId), p_version: version, p_session_id: sessionId, p_test_id: testId });
    if (error) throw error;
    if (!Array.isArray(data)) return null;
    return data.filter((item): item is string => typeof item === 'string');
  } catch (error) {
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] record test order failed', sourceId, testId, (error as Error).message);
    throw new Error('TEST_ORDER_RPC_FAILED');
  }
}

/** 按 testId 行级读取本人会话病例的单行检查结果（case_snapshot_get_test，门控：归属+版本+病例+已下单持久化）。
 *  一次下单仅返回该项目结果，不以一次下单暴露全部 tests 全文。
 *  未下单/守卫拒绝返回 null；网络/权限错误抛出（调用方不得把读取失败伪记为「资料未提供」）。 */
export interface ReleasedCaseTestResult {
  id: string; label: string; result: string;
  pending?: boolean; resultDelayNote?: string; media?: CaseMedia[];
}

export function decodeCaseTestResult(data: unknown, testId: string): ReleasedCaseTestResult | null {
  if (!data || typeof data !== 'object') return null;
  const item = data as Record<string, unknown>;
  const identity = { id: typeof item.id === 'string' ? item.id : testId, label: typeof item.label === 'string' ? item.label : '' };
  if (identity.id !== testId) return null;
  // Pending responses must never retain even accidentally supplied results/media.
  if (item.pending === true) return {...identity, result: '', pending: true,
    resultDelayNote: typeof item.resultDelayNote === 'string' ? item.resultDelayNote : '标本已送检，结果待回报。'};
  if (typeof item.result !== 'string' || !item.result) return null;
  const media=decodeCaseMedia(item.media);
  return {...identity, result: item.result, ...(media.length ? {media} : {})};
}

export async function getCaseTestResult(caseId: string, version: string, sessionId: string, accessToken: string | null, testId: string): Promise<ReleasedCaseTestResult | null> {
  const sourceId = getTeacherSourceId(caseId);
  if (!accessToken || !isDatabaseConfigured()) return null;
  try {
    const db = getSupabaseUserClient(accessToken);
    const { data, error } = await db.rpc('case_snapshot_get_test', { p_case_id: decodeURIComponent(caseId), p_version: version, p_session_id: sessionId, p_test_id: testId });
    if (error) throw error;
    return decodeCaseTestResult(data, testId);
  } catch (error) {
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] get test failed', sourceId, testId, (error as Error).message);
    throw new Error('TEST_RESULT_RPC_FAILED');
  }
}

/** 按会话绑定版本读取评分对照（原病例诊断/诊疗经过，不含原文分片与媒体）。
 *  学生走受控 RPC case_snapshot_get_reference（会话归属+版本绑定+病例匹配校验）；
 *  教师直读 case_snapshot_answers（RLS app_is_teacher 放行）。失败返回 null（评分对照留空，不回退漂移数据）。 */
export async function restoreCaseSnapshotReference(caseId: string, version: string, accessToken: string | null, role?: string, sessionId?: string): Promise<{ diagnosis: string; plan: string } | null> {
  const sourceId = getTeacherSourceId(caseId);
  if (!accessToken || !isDatabaseConfigured() || !sessionId) return null;
  try {
    const db = getSupabaseUserClient(accessToken);
    if (role === 'student') {
      const { data, error } = await db.rpc('case_snapshot_get_reference', {
        p_case_id: decodeURIComponent(caseId), p_version: version, p_session_id: sessionId,
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        const reference = data as { diagnosis?: unknown; plan?: unknown };
        return {
          diagnosis: typeof reference.diagnosis === 'string' ? reference.diagnosis : '',
          plan: typeof reference.plan === 'string' ? reference.plan : '',
        };
      }
      return null;
    }
    // 教师直读（RLS 放行），仅取对照所需两列
    const { data, error } = await db.from('case_snapshot_answers').select('diagnosis,plan').eq('case_id', sourceId).eq('version', version).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { diagnosis: data.diagnosis ?? '', plan: data.plan ?? '' };
  } catch (error) {
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] reference restore failed', sourceId, (error as Error).message);
    return null;
  }
}

/** 读取当前进程内快照的版本指纹（无缓存返回 null），用于会话首次绑定。 */
export function getSnapshotVersion(caseId: string): string | null {
  const sourceId = getTeacherSourceId(caseId);
  return snapshotStore.get(sourceId)?.meta?.version ?? null;
}


/** 冷启动版本解析：本地文件与召回缓存均无版本时，从 DB 持久缓存取该病例最新导入版本。
 *  走新 RPC case_snapshot_latest_version（迁移 20261013150000）：仅返回版本指纹文本，
 *  不含任何病例内容；authenticated 可执行（学生冷启动绑定版本无需教师身份）。
 *  失败/无数据返回 null，不阻塞建会话（保持"资料不足"降级）。 */
export async function getDatabaseSnapshotVersion(caseId: string, accessToken: string | null): Promise<string | null> {
  const sourceId = getTeacherSourceId(caseId);
  if (!accessToken || !isDatabaseConfigured()) return null;
  try {
    const db = getSupabaseUserClient(accessToken);
    const { data, error } = await db.rpc('case_snapshot_latest_version', { p_case_id: sourceId });
    if (error) throw error;
    return typeof data === 'string' && data ? data : null;
  } catch (error) {
    if (process.env.LOG_LEVEL === 'debug') console.warn('[case-snapshot] db version resolve failed', sourceId, (error as Error).message);
    return null;
  }
}

/** 读取当前进程内已缓存的快照（不触发召回），供同步路径 readTeacherCaseData 使用。
 *  version 提供时（会话已绑定版本）：仅命中该版本的缓存键，版本不一致返回 null（资料不足），
 *  绝不回退到其他版本的漂移数据。
 *  sessionId 提供时（学生会话）：会话作用域键 sourceId@version#sessionId 优先——学生恢复态
 *  是按本人会话证据投影的 facts，跨会话共享即泄露（他人完整投影）或丢失（被剥离态覆盖）。
 *  会话作用域键未命中时仅允许：裸键版本一致（ensureCaseSnapshot 召回快照，非会话投影产物）。
 *  共享版本键 sourceId@version 仅教师直读恢复写入（全量 facts，非投影），学生不读。 */
export function getCachedSnapshot(caseId: string, version?: string | null, sessionId?: string | null): SnapshotCaseData | null {
  const sourceId = getTeacherSourceId(caseId);
  if (version) {
    if (sessionId) {
      const scoped = snapshotStore.get(`${sourceId}@${version}#${sessionId}`);
      if (scoped && scoped.expiresAt > Date.now()) return scoped.data;
      const latest = snapshotStore.get(sourceId);
      if (latest && latest.expiresAt > Date.now() && latest.meta?.version === version) return latest.data;
      return null;
    }
    const pinned = snapshotStore.get(`${sourceId}@${version}`);
    if (pinned && pinned.expiresAt > Date.now()) return pinned.data;
    const latest = snapshotStore.get(sourceId);
    if (latest && latest.expiresAt > Date.now() && latest.meta?.version === version) return latest.data;
    return null;
  }
  const entry = snapshotStore.get(sourceId);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.data;
}

export function getSnapshotMedia(caseId: string): CaseSnapshotMedia[] {
  const sourceId = getTeacherSourceId(caseId);
  return snapshotStore.get(sourceId)?.media ?? [];
}

/** 仅测试使用：向进程内快照缓存注入媒体，用于验证学生侧不泄露原图 URL。测试通过 PEDIATRICS_SNAPSHOT_TEST_PRIME=1 显式开启。 */
export function primeSnapshotMediaForTest(caseId: string, media: CaseSnapshotMedia[]): void {
  if (process.env.PEDIATRICS_SNAPSHOT_TEST_PRIME !== '1') return;
  const sourceId = getTeacherSourceId(caseId);
  const entry = snapshotStore.get(sourceId) ?? {
    data: null as unknown as SnapshotCaseData, media: [], meta: null as unknown as CaseSnapshotMeta, expiresAt: 0,
  };
  entry.media = media;
  entry.expiresAt = Date.now() + 60_000;
  snapshotStore.set(sourceId, entry);
}
