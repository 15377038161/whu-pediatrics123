/* eslint-disable no-console */
/**
 * 三组既有教师病例各 20 轮真实病史模型验证。
 * - 与 handleSourceQuestion 一致，使用 sourceHistoryFacts + historyDialogue -> invokeCozeAI。
 * - 使用纯内存 SessionState 延续最近对话，不创建账号、不登录、不写数据库。
 * - 只保存 execution/model/attempts/duration/hash 等元数据，不保存病例、问题或回复正文。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { AgentMessage, SessionState } from '../src/domain/agent';
import { getCase } from '../src/domain/case';
import { SOURCE_HISTORY_TOPICS } from '../src/domain/source-history';
import type { HistoryFact } from '../src/domain/teaching-package';
import { createInitialSession } from '../src/lib/agent-engine';
import { verifiedComplaint } from '../src/lib/admission-complaint';
import { computeImportVersion } from '../src/lib/teacher-case-import';
import { describeAIConfig, getAIGatewaySettings } from '../src/lib/coze-ai';
import { ensureControlledCaseBundle } from '../src/lib/controlled-case-bundle';
import { parseControlledCasePackageManifest } from '../src/lib/controlled-case-package';
import { controlledCaseBundles } from '../src/lib/controlled-case-registry';
import { registerControlledCase } from '../src/lib/controlled-case-store';
import { resolveAuditedCommunicationProfile } from '../src/lib/communication-profile-overrides';
import { disclosedHistoryCodes, historyDialogue, sourceHistoryFacts } from '../src/lib/history-dialogue';
import { recordSchema } from '../src/lib/teacher-case-data';

type CaseKey = 'dka' | 'newborn' | 'respiratory';

const CASE_IDS: Record<CaseKey, string> = {
  dka: 'teacher-1型糖尿病伴有酮症酸中毒',
  newborn: 'teacher-新生儿败血症',
  respiratory: 'teacher-急性毛细支气管炎',
};

const TOPIC_QUESTIONS: Record<string, string> = {
  起病与病程: '孩子这次不舒服是什么时候开始的？',
  发热与处理: '孩子有没有发热，体温最高多少，做过哪些退热处理？',
  '一般状态、进食及排泄': '孩子现在精神、饮食、睡眠和大小便情况怎么样？',
  '出生、喂养与生长发育': '孩子出生、喂养和生长发育情况怎么样？',
  '既往、过敏、接种及家族史': '孩子既往健康、过敏、疫苗接种和家族史有什么需要了解的？',
  已用药物与院外处理: '这次就诊前在家用过什么药或做过什么处理？',
  呼吸相关症状: '孩子有咳嗽、喘息、痰或呼吸费力吗？',
  水肿及尿液变化: '孩子有没有水肿，尿液和排尿有什么变化？',
  疼痛及消化道症状: '孩子有没有疼痛、呕吐、腹泻或其他消化道不舒服？',
  '神经、意识与肢体功能': '孩子有没有抽搐、意识变化或肢体活动异常？',
  '黄疸、皮肤及出血': '孩子有没有黄疸、皮疹、皮肤变化或出血表现？',
};

interface RoundEvidence {
  round: number;
  topic: string;
  followUp: boolean;
  contextMessagesProvided: number;
  execution: string;
  model: string | null;
  attempts: number;
  durationMs: number;
  errorKind: string | null;
  modelDialoguePresent: boolean;
  modelDialogueHash: string | null;
  dialogueLength: number;
  dialogueActors: string[];
  utteranceCount: number;
  citedFactCount: number;
  fallbackContentUsed: boolean;
  exactQuestionEcho: boolean;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const CANDIDATE_ARCHIVE = {
  fileId: '579c3fbb0bddf46c921ef344b1d7de90',
  fileName: 'peds-workbuddy-67-import-candidate.zip',
  bytes: 364182,
  sha256: 'ebf4286039913a41c67c6b16f4321ea1d04f987f81788a0407a176e6ff657487',
} as const;

/** Read one verified candidate source into the process-local store; never installs or writes persistent data. */
async function ensureCandidateSource(caseId: string): Promise<string | null> {
  const { StorageClient } = await import('coder-coding-dev-sdk');
  const bytes = await new StorageClient().readFile({ fileId: CANDIDATE_ARCHIVE.fileId });
  if (bytes.length !== CANDIDATE_ARCHIVE.bytes || createHash('sha256').update(bytes).digest('hex') !== CANDIDATE_ARCHIVE.sha256) {
    throw new Error('候选包字节数或 SHA256 与只读审计不一致');
  }
  const files = unzipSync(bytes);
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('候选包缺少 manifest.json');
  const manifest = parseControlledCasePackageManifest(JSON.parse(strFromU8(manifestBytes)));
  if (!manifest.sourceCaseIds.includes(caseId)) return null;
  const memberPath = `knowledge/teaching-cases/${caseId}.json`;
  const member = files[memberPath];
  if (!member || createHash('sha256').update(member).digest('hex') !== manifest.hashes[memberPath]) {
    throw new Error('目标病例缺失或 manifest 哈希不匹配');
  }
  const record = recordSchema.parse(JSON.parse(strFromU8(member)));
  if (record.caseId !== caseId) throw new Error('目标病例 ID 不匹配');
  const version = computeImportVersion(record);
  registerControlledCase(record, version);
  return version;
}

function message(actor: AgentMessage['actor'], content: string): AgentMessage {
  const createdAt = new Date().toISOString();
  return { id: crypto.randomUUID(), actor, content, emotion: 'neutral', kind: 'dialogue', createdAt };
}

function allSourceFacts(session: SessionState): HistoryFact[] {
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  const source = pediatricCase.sourceFacts;
  if (!source) throw new Error(`${session.caseId} 缺少可核验的教师病例正文`);
  const facts = sourceHistoryFacts(source.sections.history);
  facts.push({ id: 'SOURCE_HX_-1', text: `孩子${source.age}，${source.sex}。`, topics: ['年龄与性别'], sourceLocator: 'age/sex', origin: 'source', actor: 'parent' });
  const complaint = verifiedComplaint(source);
  if (complaint) facts.push({ id: 'SOURCE_HX_-2', text: complaint, topics: ['主要不适'], sourceLocator: 'complaint', origin: 'source', actor: 'mixed' });
  if (facts.length === 0) throw new Error(`${session.caseId} 没有可用于验证的病史事实`);
  return facts;
}

async function main(): Promise<void> {
  const caseKey = argument('--case') as CaseKey;
  if (!Object.hasOwn(CASE_IDS, caseKey)) throw new Error('必须指定 --case dka|newborn|respiratory');
  const outputArgument = argument('--output');
  if (!outputArgument) throw new Error('必须指定 --output <artifacts/model-acceptance/*.json>');
  const output = path.resolve(outputArgument);
  const outputRoot = path.resolve('artifacts/model-acceptance');
  if (!output.startsWith(`${outputRoot}${path.sep}`) || path.extname(output) !== '.json') {
    throw new Error('输出仅允许写入 artifacts/model-acceptance/*.json');
  }
  mkdirSync(outputRoot, { recursive: true });

  process.env.ENABLE_AI_FIXTURE = 'false';
  const config = describeAIConfig();
  if (config.apiKeySource === 'missing') throw new Error('缺少真实模型凭据，未执行任何轮次');
  const gateway = getAIGatewaySettings();
  const caseId = CASE_IDS[caseKey];
  const bundle = controlledCaseBundles.find((item) => item.sourceId === caseId) ?? null;
  let sourceVersion = bundle?.version ?? null;
  if (!sourceVersion) sourceVersion = await ensureCandidateSource(caseId);
  if (!sourceVersion) throw new Error(`${caseId} 在受控注册表和已校验候选包中均无可核验来源`);
  await ensureControlledCaseBundle(caseId, sourceVersion);
  const session = createInitialSession('offline-model-verification-no-auth', 'guided', caseId, undefined, sourceVersion);
  const pediatricCase = getCase(caseId, sourceVersion, session.id);
  const facts = allSourceFacts(session);
  const topics = SOURCE_HISTORY_TOPICS.filter((topic) => facts.some((fact) => fact.topics.includes(topic.label)));
  if (topics.length === 0) throw new Error(`${caseId} 未解析到可提问的病史主题`);
  const profile = resolveAuditedCommunicationProfile(caseId, pediatricCase.age);
  const configuredModel = process.env.COZE_AI_ROLE_MODEL || 'doubao-seed-1-8-251228';
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const evidence = {
    schemaVersion: 2,
    status: 'running' as 'running' | 'completed' | 'failed',
    startedAt: new Date().toISOString(),
    completedAt: null as string | null,
    sourceCommit,
    caseKey,
    caseId,
    requestedRounds: 20,
    sourceFactCount: facts.length,
    availableTopicCount: topics.length,
    sourceSnapshot: {
      origin: bundle ? 'registered-controlled-bundle' : 'verified-candidate-archive-not-activated',
      version: sourceVersion,
      fileId: bundle?.fileId ?? CANDIDATE_ARCHIVE.fileId,
      archiveSha256: bundle?.sha256 ?? CANDIDATE_ARCHIVE.sha256,
      persistentInstallationPerformed: false,
    },
    runtime: {
      path: 'sourceHistoryFacts + historyDialogue + invokeCozeAI',
      provider: config.provider,
      apiKeySource: config.apiKeySource,
      sdkVersion: config.sdkVersion,
      timeoutMs: gateway.timeoutMs,
      configuredModel,
      rawResponseContentSaved: false,
      questionContentSaved: false,
      authenticationUsed: false,
      databaseWritesUsed: false,
      inMemorySessionOnly: true,
    },
    rounds: [] as RoundEvidence[],
    summary: null as null | Record<string, unknown>,
  };
  const save = () => writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  save();

  try {
    for (let round = 1; round <= 20; round += 1) {
      const topic = topics[(round - 1) % topics.length];
      const followUp = round > topics.length;
      const baseQuestion = TOPIC_QUESTIONS[topic.label] ?? `请具体说说${topic.label}。`;
      const question = followUp ? `${baseQuestion}请接着刚才的情况说，后来还有什么变化？` : baseQuestion;
      const contextMessagesProvided = session.messages.filter((item) => ['student', 'child', 'parent'].includes(item.actor)).slice(-12).length;
      const { dialogue, runtime } = await historyDialogue(session, question, facts, profile);
      const dialogueText = dialogue.utterances.map((item) => item.text).join('\n');
      const modelDialogueText = runtime.execution === 'model' ? dialogueText : '';
      const codes = disclosedHistoryCodes(dialogue, facts);

      session.messages.push(message('student', question));
      session.messages.push(...dialogue.utterances.map((item) => message(item.actor, item.text)));
      session.askedIntents = [...new Set([...session.askedIntents, ...codes])];
      session.unlockedEvidence = [...new Set([...session.unlockedEvidence, ...codes])];
      session.dialogueMemory = {
        topic: dialogue.topic,
        lastFactIds: codes.length ? codes : session.dialogueMemory?.lastFactIds ?? [],
        clarifiedQuestion: dialogue.clarification ?? null,
        concern: /担心|严重|危险/.test(question) ? question : session.dialogueMemory?.concern ?? null,
      };
      session.updatedAt = new Date().toISOString();

      evidence.rounds.push({
        round,
        topic: topic.label,
        followUp,
        contextMessagesProvided,
        execution: runtime.execution,
        model: runtime.model,
        attempts: runtime.attempts ?? 0,
        durationMs: runtime.durationMs,
        errorKind: runtime.errorKind ?? null,
        modelDialoguePresent: Boolean(modelDialogueText),
        modelDialogueHash: modelDialogueText ? sha256(modelDialogueText) : null,
        dialogueLength: dialogueText.length,
        dialogueActors: dialogue.utterances.map((item) => item.actor),
        utteranceCount: dialogue.utterances.length,
        citedFactCount: codes.length,
        fallbackContentUsed: runtime.execution !== 'model',
        exactQuestionEcho: dialogueText.trim() === question.trim(),
      });
      save();
      console.log(`ROUND ${caseKey} ${round}/20 execution=${runtime.execution} model=${runtime.model ?? 'null'} attempts=${runtime.attempts ?? 0} durationMs=${runtime.durationMs} context=${contextMessagesProvided}`);
    }

    const durations = evidence.rounds.map((item) => item.durationMs).sort((a, b) => a - b);
    const executions = evidence.rounds.reduce<Record<string, number>>((acc, item) => {
      acc[item.execution] = (acc[item.execution] ?? 0) + 1;
      return acc;
    }, {});
    const modelHashes = evidence.rounds.map((item) => item.modelDialogueHash).filter((item): item is string => Boolean(item));
    evidence.summary = {
      completedRounds: evidence.rounds.length,
      executions,
      modelRounds: executions.model ?? 0,
      fallbackRounds: executions.model_fallback ?? 0,
      deterministicRounds: executions.deterministic ?? 0,
      uniqueModelDialogueHashes: new Set(modelHashes).size,
      exactQuestionEchoRounds: evidence.rounds.filter((item) => item.exactQuestionEcho).length,
      contextCarriedRounds: evidence.rounds.filter((item) => item.contextMessagesProvided > 0).length,
      totalAttempts: evidence.rounds.reduce((sum, item) => sum + item.attempts, 0),
      latencyMs: {
        min: durations[0] ?? 0,
        p50: durations[Math.floor((durations.length - 1) * 0.5)] ?? 0,
        p95: durations[Math.floor((durations.length - 1) * 0.95)] ?? 0,
        max: durations.at(-1) ?? 0,
      },
    };
    evidence.status = 'completed';
    evidence.completedAt = new Date().toISOString();
    save();
    console.log(`SUMMARY ${JSON.stringify(evidence.summary)}`);
    if (evidence.rounds.length !== 20 || (executions.model ?? 0) === 0) process.exitCode = 1;
  } catch (error) {
    evidence.status = 'failed';
    evidence.completedAt = new Date().toISOString();
    evidence.summary = { harnessError: error instanceof Error ? error.message.slice(0, 300) : String(error) };
    save();
    throw error;
  }
}

main().catch((error) => {
  console.error(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
