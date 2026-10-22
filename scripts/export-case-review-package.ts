export {};


/**
 * K02-K03：生成 70 例逐例审核材料包（docs/case-review-package/）。
 *
 * 两种模式：
 *  1) --offline（离线骨架，沙箱工程侧可运行）：
 *     仅用本地就绪账本（docs/case-readiness-register.json）生成逐例审核表：
 *     源事实元数据 + 已知缺口 + 未核对标注 + 审核人签字栏（留空）。
 *     病例五段全文标注为「需教师凭据导出」（facts/answers 表 RLS 仅教师可读）。
 *  2) 默认模式（教师凭据 fail-closed，用户侧教师运行）：
 *     凭据仅经 --cred-file <0600 JSON {email,password}> 或
 *     PEDIATRICS_TEACHER_EMAIL / PEDIATRICS_TEACHER_PWD 环境变量输入；
 *     两者皆缺直接退出；绝不 signup、不改密码、不打印凭据/token/患者原文到 stdout。
 *     登录后校验 profiles.role='teacher'，非教师身份拒绝执行。
 *     以教师身份只读查询 case_snapshot_facts / case_snapshot_answers，
 *     按账本 publishedVersion 逐例导出五段全文，与账本逐例合并生成完整审核材料包。
 *
 * 原则（与账本一致）：
 *  - 材料仅含源事实与已记录缺口；未核对项如实标注 unaudited，不标 ready；
 *  - 源文只读导出、逐字保留，不做任何改写、不做分段清洗、不生成任何临床结论；
 *  - 审核人签字栏留空，由人工审核填写（模型不自审自通过）；
 *  - 别名/亚型条目不复制患者事实（同一患者不因别名绕过），指向源病例审核表；
 *  - 无独立来源条目如实标注资料不足，不编造。
 *
 * 输出仅病例 ID / 计数 / 布尔，不打印患者原文与凭据。
 *
 * 运行：
 *   pnpm exec tsx scripts/export-case-review-package.ts --offline
 *   pnpm exec tsx scripts/export-case-review-package.ts --cred-file /tmp/.teacher-creds.json
 */


import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ===== 环境与参数 =====
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const OFFLINE = process.argv.includes('--offline');
const OUT_DIR = path.resolve(process.cwd(), 'docs', 'case-review-package');

interface RegisterRow {
  publicCaseId: string;
  sourceCaseId: string | null;
  relation: 'independent' | 'alias' | 'subtype' | 'no_source';
  catalogStatus: string;
  published: boolean;
  publishedVersion: string | null;
  historicalVersions: string[];
  ageKnown: string | null;
  ageBand: string;
  sexKnown: 'male' | 'female' | 'unknown';
  dimensionChars: { history: number; exam: number; tests: number; diagnosis: number; plan: number } | null;
  audit: { batch: number; batchLabel: string; pass: boolean; checkedAt: string; findings: string[] } | null;
  readiness: { history: string; exam: string; tests: string; reasoning: string; plan: string };
  avatarReady: string;
  communicationReady: boolean;
  speechRoleReady: boolean;
  rubricReady: boolean;
  supportedModes: string[];
  blockers: string[];
  ledgerMarker: string;
  reviewer: null;
  reviewedAt: string | null;
  e2eResult: string | null;
}

interface SnapshotFacts {
  age: string;
  sex: string;
  complaint: string;
  sections: { history?: string; exam?: string; tests?: string; diagnosis?: string; plan?: string };
  vitals: { temperature: number | null; heartRate: number | null; respiratoryRate: number | null; spo2: number | null };
}

interface ExportedCase {
  facts: SnapshotFacts | null;
  diagnosis: string | null;
  plan: string | null;
  mediaCount: number;
  mediaCaptions: string[];
  missing: string[];
}

// ===== 凭据：受控通道 fail-closed，绝不 signup =====
function loadCredentials(argv: string[]): { email: string; password: string } {
  const idx = argv.indexOf('--cred-file');
  if (idx >= 0 && argv[idx + 1]) {
    const credPath = argv[idx + 1];
    if ((statSync(credPath).mode & 0o077) !== 0) throw new Error('CREDENTIAL_FILE_PERMISSIONS（须 0600）');
    const raw = JSON.parse(readFileSync(credPath, 'utf8')) as { email?: string; password?: string };
    if (!raw.email || !raw.password) throw new Error('INVALID_CREDENTIAL_FILE');
    return { email: raw.email, password: raw.password };
  }
  if (process.env.PEDIATRICS_TEACHER_EMAIL && process.env.PEDIATRICS_TEACHER_PWD) {
    return { email: process.env.PEDIATRICS_TEACHER_EMAIL, password: process.env.PEDIATRICS_TEACHER_PWD };
  }
  throw new Error('缺少教师凭据：--cred-file <0600 JSON> 或 PEDIATRICS_TEACHER_EMAIL/PEDIATRICS_TEACHER_PWD（复用既有教师账号，不 signup 不改密）');
}

async function loginTeacher(): Promise<{ accessToken: string; userId: string }> {
  const { email, password } = loadCredentials(process.argv);
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as { access_token?: string; user?: { id?: string }; error_code?: string };
  if (!resp.ok || !body.access_token || !body.user?.id) throw new Error(`教师登录失败: ${body.error_code ?? resp.status}`);
  return { accessToken: body.access_token, userId: body.user.id };
}

function userDb(accessToken: string) {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${accessToken}` } },
  });
}

async function assertTeacherRole(accessToken: string, userId: string): Promise<void> {
  const db = userDb(accessToken);
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error || !data) throw new Error('无法读取 profiles（教师身份校验失败）');
  if (data.role !== 'teacher') throw new Error(`账号角色为 ${data.role}，非教师——拒绝导出`);
}

/** 以教师身份按账本 publishedVersion 只读导出单例五段全文。 */
async function exportCaseFullText(accessToken: string, sourceCaseId: string, version: string): Promise<ExportedCase> {
  const db = userDb(accessToken);
  const result: ExportedCase = { facts: null, diagnosis: null, plan: null, mediaCount: 0, mediaCaptions: [], missing: [] };
  const { data: factsRow, error: factsError } = await db.from('case_snapshot_facts')
    .select('facts').eq('case_id', sourceCaseId).eq('version', version).maybeSingle();
  if (factsError) throw new Error(`读取 case_snapshot_facts 失败: ${factsError.message}`);
  if (!factsRow) result.missing.push('facts 行缺失（case_snapshot_facts 无该版本）');
  else result.facts = factsRow.facts as SnapshotFacts;
  const { data: answersRow, error: answersError } = await db.from('case_snapshot_answers')
    .select('diagnosis,plan,media').eq('case_id', sourceCaseId).eq('version', version).maybeSingle();
  if (answersError) throw new Error(`读取 case_snapshot_answers 失败: ${answersError.message}`);
  if (!answersRow) result.missing.push('answers 行缺失（case_snapshot_answers 无该版本）');
  else {
    result.diagnosis = answersRow.diagnosis || null;
    result.plan = answersRow.plan || null;
    const media = (answersRow.media ?? []) as Array<{ caption?: string }>;
    result.mediaCount = media.length;
    result.mediaCaptions = media.map((m) => m.caption ?? '（无标题）');
  }
  return result;
}

// ===== 标签映射 =====
const RELATION_LABEL: Record<RegisterRow['relation'], string> = {
  independent: '独立来源',
  alias: '别名',
  subtype: '亚型',
  no_source: '无独立来源',
};
const AGE_BAND_LABEL: Record<string, string> = {
  newborn: '新生儿', infant: '婴儿', toddler: '幼儿', preschool: '学龄前', school: '学龄', adolescent: '青少年', unknown: '未知',
};
const SEX_LABEL: Record<string, string> = { male: '男', female: '女', unknown: '未知' };
const DIM_LABEL: Array<[keyof RegisterRow['readiness'], string]> = [
  ['history', '病史'], ['exam', '查体'], ['tests', '辅助检查'], ['reasoning', '诊断'], ['plan', '处置'],
];
const DIM_STATE_LABEL: Record<string, string> = {
  ready: '就绪', pending_review: '待医学审核', unaudited: '未核对', insufficient: '内容不足',
};
const CHAR_KEY_OF_LABEL: Record<string, 'history' | 'exam' | 'tests' | 'diagnosis' | 'plan'> = {
  病史: 'history', 查体: 'exam', 辅助检查: 'tests', 诊断: 'diagnosis', 处置: 'plan',
};

function sanitizeFileName(caseId: string): string {
  return caseId.replace(/[/\\:*?"<>|]/g, '_');
}

function renderReviewSheet(
  index: number,
  row: RegisterRow,
  fileNameOf: (otherCaseId: string) => string | null,
  exported: ExportedCase | null,
): string {
  const lines: string[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  lines.push(`# ${pad(index)}. ${row.publicCaseId}`);
  lines.push('');
  lines.push(`> 关系：${RELATION_LABEL[row.relation]}${row.sourceCaseId && row.sourceCaseId !== row.publicCaseId ? ` ｜ 源病例：${row.sourceCaseId}` : ''}`);
  lines.push(`> 发布：${row.published ? '是' : '否'}${row.publishedVersion ? `（版本指纹 ${row.publishedVersion}）` : ''}`);
  if (row.historicalVersions.length > 0) lines.push(`> 历史版本（仅列指纹，待教师清理）：${row.historicalVersions.join('、')}`);
  if (row.supportedModes.length > 0) lines.push(`> 开放模式：${row.supportedModes.join('/')}`);
  lines.push('');
  lines.push('## 审核人记录栏（人工填写，留空）');
  lines.push('');
  lines.push('- 审核人：＿＿＿＿＿＿　审核日期：＿＿＿＿＿＿');
  lines.push('- 审核结论：□ 通过　□ 需修改　□ 拒绝');
  lines.push('- 五维结论：史＿＿＿　体＿＿＿　检＿＿＿　诊＿＿＿　处＿＿＿');
  lines.push('- 审核意见（如需修改，请具体到段落）：');
  lines.push('');
  if (row.relation === 'no_source') {
    lines.push('## 患者事实');
    lines.push('');
    lines.push('无独立来源（folder 空），未发布，资料不足——不编造（保持「资料不足」）。');
    lines.push('');
    return lines.join('\n');
  }
  if (row.relation === 'alias' || row.relation === 'subtype') {
    lines.push('## 患者事实');
    lines.push('');
    lines.push(`别名/亚型入口：患者事实与源病例**完全相同**（同一患者不因别名绕过门控）。`);
    lines.push(`请审核源病例表：${row.sourceCaseId ? (fileNameOf(row.sourceCaseId) ?? row.sourceCaseId) : '—'}`);
    lines.push('');
  } else {
    // 独立来源：患者事实
    lines.push('## 患者事实（源文只读导出，逐字保留，未做任何改写）');
    lines.push('');
    if (exported?.facts) {
      lines.push(`- 年龄表述：${exported.facts.age}（账本推导年龄段：${AGE_BAND_LABEL[row.ageBand] ?? row.ageBand}）`);
      lines.push(`- 性别：${exported.facts.sex}`);
      lines.push(`- 主诉：${exported.facts.complaint}`);
      const v = exported.facts.vitals;
      if (v) {
        lines.push(`- 生命体征：T ${v.temperature ?? '—'}℃ ｜ P ${v.heartRate ?? '—'}次/分 ｜ R ${v.respiratoryRate ?? '—'}次/分 ｜ SpO2 ${v.spo2 ?? '—'}%`);
      }
    } else {
      lines.push(`- 年龄表述：${row.ageKnown ?? '未知'}（推导年龄段：${AGE_BAND_LABEL[row.ageBand] ?? row.ageBand}）`);
      lines.push(`- 性别：${SEX_LABEL[row.sexKnown]}`);
    }
    lines.push('');
    const sectionBlocks: Array<[string, string | null | undefined]> = [
      ['病史', exported?.facts?.sections.history],
      ['查体', exported?.facts?.sections.exam],
      ['辅助检查', exported?.facts?.sections.tests],
      ['诊断', exported?.diagnosis ?? exported?.facts?.sections.diagnosis],
      ['处置', exported?.plan ?? exported?.facts?.sections.plan],
    ];
    for (const [label, text] of sectionBlocks) {
      lines.push(`## ${label}（源文）`);
      lines.push('');
      if (typeof text === 'string' && text.length > 0) {
        lines.push(text);
      } else if (exported) {
        lines.push('（该段在导出版本中为空——按源事实记录，不补造）');
      } else {
        const chars = row.dimensionChars?.[CHAR_KEY_OF_LABEL[label]];
        lines.push(`【病例全文：需教师凭据导出——运行 pnpm exec tsx scripts/export-case-review-package.ts --cred-file <0600 JSON>；本骨架仅含元数据（该段账本记录 ${chars ?? '—'} 字符）】`);
      }
      lines.push('');
    }
    if (exported) {
      lines.push(`## 媒体（${exported.mediaCount} 条）`);
      lines.push('');
      if (exported.mediaCaptions.length > 0) {
        for (const caption of exported.mediaCaptions) lines.push(`- ${caption}`);
      } else {
        lines.push('（无媒体）');
      }
      if (exported.missing.length > 0) {
        lines.push('');
        lines.push(`> ⚠️ 导出缺口：${exported.missing.join('；')}`);
      }
      lines.push('');
    }
  }
  // 已知缺口与核对记录（账本原样带入）
  lines.push('## 已知缺口（来自就绪账本，原样带入）');
  lines.push('');
  if (row.blockers.length > 0) {
    for (const b of row.blockers) lines.push(`- ${b}`);
  } else {
    lines.push('-（账本未记录缺口）');
  }
  if (row.ledgerMarker) lines.push(`- 台账标记：${row.ledgerMarker}`);
  lines.push('');
  lines.push('## 逐例核对记录（账本）');
  lines.push('');
  if (row.audit) {
    lines.push(`- 核对批次：${row.audit.batchLabel}（${row.audit.checkedAt}）结论：${row.audit.pass ? '通过' : '未通过'}`);
    for (const f of row.audit.findings) lines.push(`- 发现：${f}`);
  } else {
    lines.push('- 未逐例核对（unaudited）——本表即供审核人核对');
  }
  if (row.e2eResult) lines.push(`- 链路验证：${row.e2eResult}`);
  lines.push('');
  lines.push('## 五维就绪状态（账本快照，审核后由人工更新）');
  lines.push('');
  for (const [key, label] of DIM_LABEL) {
    lines.push(`- ${label}：${DIM_STATE_LABEL[row.readiness[key]] ?? row.readiness[key]}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> 声明：本表内容为源事实与已记录缺口的只读汇集，不含模型生成的临床结论；未核对项如实标注 unaudited，不以非空冒充可用。');
  lines.push('');
  return lines.join('\n');
}

// ===== 主流程 =====
async function main(): Promise<void> {
  const register = JSON.parse(readFileSync(path.resolve(process.cwd(), 'docs', 'case-readiness-register.json'), 'utf8')) as { rows: RegisterRow[] };
  const rows = register.rows;
  if (rows.length !== 70) throw new Error(`账本条目数异常: ${rows.length}（预期 70）`);
  mkdirSync(OUT_DIR, { recursive: true });

  let accessToken: string | null = null;
  if (!OFFLINE) {
    if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量（CODER_SUPABASE_URL/ANON_KEY/TENANT_ID）');
    const login = await loginTeacher();
    await assertTeacherRole(login.accessToken, login.userId);
    accessToken = login.accessToken;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const fileNames = new Map<string, string>();
  rows.forEach((row, i) => { fileNames.set(row.publicCaseId, `${pad(i + 1)}-${sanitizeFileName(row.publicCaseId)}.md`); });
  const fileNameOf = (caseId: string): string | null => fileNames.get(caseId) ?? null;

  const exportErrors: string[] = [];
  const indexLines: string[] = [];
  indexLines.push('# 70 例逐例审核材料包（K02-K03）');
  indexLines.push('');
  indexLines.push(`> 生成模式：${OFFLINE ? '离线骨架（仅元数据与缺口，病例全文需教师凭据导出）' : '教师凭据全文导出'} ｜ 生成时间：${new Date().toISOString()}`);
  indexLines.push('> 数据源：docs/case-readiness-register.json（就绪账本）' + (OFFLINE ? '' : ' + case_snapshot_facts/case_snapshot_answers（教师只读，按账本 publishedVersion）'));
  indexLines.push('> 原则：仅源事实与已记录缺口；未核对项如实标注 unaudited；不含模型生成的临床结论；审核人签字栏留空由人工填写。');
  indexLines.push('> 别名/亚型（14 条目）与源病例共用同一患者事实，请审核对应源病例表；无独立来源（3 条目）如实标注资料不足。');
  indexLines.push('');
  indexLines.push('| 序号 | 条目 | 关系 | 源病例 | 版本指纹 | 发布 | 审核人 | 结论 | 日期 |');
  indexLines.push('|---|---|---|---|---|---|---|---|---|');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let exported: ExportedCase | null = null;
    if (accessToken && row.relation === 'independent' && row.publishedVersion) {
      try {
        exported = await exportCaseFullText(accessToken, row.sourceCaseId ?? row.publicCaseId, row.publishedVersion);
      } catch (error) {
        exportErrors.push(`${row.publicCaseId}: ${(error as Error).message}`);
        exported = { facts: null, diagnosis: null, plan: null, mediaCount: 0, mediaCaptions: [], missing: [(error as Error).message] };
      }
    }
    const sheet = renderReviewSheet(i + 1, row, fileNameOf, exported);
    writeFileSync(path.join(OUT_DIR, fileNames.get(row.publicCaseId)!), sheet);
    indexLines.push(`| ${pad(i + 1)} | ${row.publicCaseId} | ${RELATION_LABEL[row.relation]} | ${row.sourceCaseId ?? '—'} | ${row.publishedVersion ?? '—'} | ${row.published ? '是' : '否'} |  |  |  |`);
  }

  writeFileSync(path.join(OUT_DIR, 'INDEX.md'), indexLines.join('\n') + '\n');
  console.log(`生成完成：${rows.length} 个逐例审核表 + INDEX.md -> docs/case-review-package/`);
  if (exportErrors.length > 0) {
    console.log(`导出异常 ${exportErrors.length} 例（详见对应表内「导出缺口」）`);
    for (const e of exportErrors) console.log(`  - ${e}`);
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(String(error)); process.exit(1); });
