/* eslint-disable no-console */
/**
 * 三组教师病例各 20 轮真实病史模型验证。
 * - 强制读取隔离恢复目录中的新版教学包及精确版本源病例，不访问对象存储或旧候选 ZIP。
 * - 每轮走 runAgentTurn(ASK_QUESTION) 真实引擎路径，不手工重放会话状态。
 * - 只保存执行元数据与安全校验码；模型原文仅可写入 /tmp 下的私有目录。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SessionState } from '../src/domain/agent';
import { getCase } from '../src/domain/case';
import { SOURCE_HISTORY_TOPICS } from '../src/domain/source-history';
import type { HistoryFact } from '../src/domain/teaching-package';
import { createInitialSession, runAgentTurn } from '../src/lib/agent-engine';
import { verifiedComplaint } from '../src/lib/admission-complaint';
import { computeCaseDataVersion } from '../src/lib/case-data-version';
import { describeAIConfig, getAIGatewaySettings, invokeCozeAI } from '../src/lib/coze-ai';
import { registerControlledCase } from '../src/lib/controlled-case-store';
import { sessionTeachingPackage } from '../src/lib/session-teaching';
import { readTeachingPackage } from '../src/lib/teaching-package-store';
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
  modelCalls: number;
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
  validationReasons: string[];
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Load the exact recovered pair into memory only; never installs or writes persistent data. */
function loadRecoveredCase(caseId: string, runtimeRoot: string, sourceRoot: string) {
  const index = JSON.parse(readFileSync(path.join(runtimeRoot, 'index.json'), 'utf8')) as {
    schemaVersion: number;
    entries: Record<string, string>;
  };
  if (index.schemaVersion !== 1) throw new Error('恢复目录 index.json 版本不受支持');
  const teachingVersion = index.entries[caseId];
  if (!teachingVersion) throw new Error(`${caseId} 不在新版 runtime/index.json 中`);
  const pack = readTeachingPackage(caseId, teachingVersion);
  if (!pack) throw new Error(`${caseId} 新版教学包缺失、损坏或版本校验失败`);
  if (!/^teacher-[^/\\]+$/.test(pack.sourceId)) throw new Error('教学包 sourceId 不安全');
  const record = recordSchema.parse(JSON.parse(readFileSync(path.join(sourceRoot, `${pack.sourceId}.json`), 'utf8')));
  if (record.caseId !== pack.sourceId) throw new Error('源病例与教学包 sourceId 不一致');
  const sourceVersion = computeCaseDataVersion(record);
  if (sourceVersion !== pack.sourceVersion) throw new Error('源病例与教学包 sourceVersion 不一致');
  registerControlledCase(record, sourceVersion);
  return { pack, sourceVersion };
}

/** Mirror the engine's fact inventory for topic selection; the turn itself still uses runAgentTurn. */
function allSourceFacts(session: SessionState): HistoryFact[] {
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  const source = pediatricCase.sourceFacts;
  const pack = sessionTeachingPackage(session);
  if (!source || !pack) throw new Error(`${session.caseId} 缺少已绑定的新版教学包或源病例`);
  const facts = [...pack.historyFacts];
  facts.push({ id: 'SOURCE_HX_-1', text: `孩子${source.age}，${source.sex}。`, topics: ['年龄与性别'], sourceLocator: 'age/sex', origin: 'source', actor: 'parent' });
  const complaint = verifiedComplaint(source);
  if (complaint) facts.push({ id: 'SOURCE_HX_-2', text: complaint, topics: ['主要不适'], sourceLocator: 'complaint', origin: 'source', actor: 'mixed' });
  if (facts.length === 0) throw new Error(`${session.caseId} 没有可用于验证的病史事实`);
  return facts;
}

async function main(): Promise<void> {
  const caseKey = argument('--case') as CaseKey;
  if (!Object.hasOwn(CASE_IDS, caseKey)) throw new Error('必须指定 --case dka|newborn|respiratory');
  const runtimeRootArgument = argument('--runtime-root') || process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT || '';
  if (!runtimeRootArgument) throw new Error('必须指定 --runtime-root <隔离恢复目录/runtime>');
  const runtimeRoot = path.resolve(runtimeRootArgument);
  const sourceRoot = path.resolve(argument('--source-root') || path.join(path.dirname(runtimeRoot), 'source-cases'));
  const outputArgument = argument('--output');
  if (!outputArgument) throw new Error('必须指定 --output <artifacts/model-acceptance/*.json>');
  const output = path.resolve(outputArgument);
  const outputRoot = path.resolve('artifacts/model-acceptance');
  if (!output.startsWith(`${outputRoot}${path.sep}`) || path.extname(output) !== '.json') {
    throw new Error('输出仅允许写入 artifacts/model-acceptance/*.json');
  }
  mkdirSync(outputRoot, { recursive: true });
  const privateRawArgument = argument('--private-raw-dir');
  const privateRawDir = privateRawArgument ? path.resolve(privateRawArgument) : null;
  if (privateRawDir) {
    const temporaryRoot = path.resolve(tmpdir());
    if (!privateRawDir.startsWith(`${temporaryRoot}${path.sep}`)) {
      throw new Error('私有原文只能写入独立临时目录，不得进入项目或 Git');
    }
    mkdirSync(privateRawDir, { recursive: true, mode: 0o700 });
  }

  process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT = runtimeRoot;
  process.env.ENABLE_AI_FIXTURE = 'false';
  const config = describeAIConfig();
  if (config.apiKeySource === 'missing') throw new Error('缺少真实模型凭据，未执行任何轮次');
  const gateway = getAIGatewaySettings();
  const caseId = CASE_IDS[caseKey];
  const { pack, sourceVersion } = loadRecoveredCase(caseId, runtimeRoot, sourceRoot);
  const session = createInitialSession('offline-model-verification-no-auth', 'guided', caseId, undefined, sourceVersion);
  assert.equal(session.sourceSnapshotVersion, sourceVersion);
  assert.equal(session.teachingPackageVersion, pack.version);
  const facts = allSourceFacts(session);
  const topics = SOURCE_HISTORY_TOPICS.filter((topic) => facts.some((fact) => fact.topics.includes(topic.label)));
  if (topics.length === 0) throw new Error(`${caseId} 未解析到可提问的病史主题`);
  const configuredModel = process.env.COZE_AI_ROLE_MODEL || 'doubao-seed-1-8-251228';
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const evidence = {
    schemaVersion: 4,
    status: 'running' as 'running' | 'completed' | 'failed',
    startedAt: new Date().toISOString(),
    completedAt: null as string | null,
    sourceCommit,
    workingTreeDirty,
    caseKey,
    caseId,
    requestedRounds: 20,
    sourceFactCount: facts.length,
    availableTopicCount: topics.length,
    sourceSnapshot: {
      origin: 'isolated-recovered-source-case',
      version: sourceVersion,
      persistentInstallationPerformed: false,
      objectStorageReadUsed: false,
    },
    teachingPackage: {
      origin: 'isolated-recovered-runtime-index',
      version: pack.version,
      sourceVersion: pack.sourceVersion,
      sessionBindingVerified: true,
    },
    runtime: {
      path: 'runAgentTurn(ASK_QUESTION) + sessionTeachingPackage + historyDialogue + invokeCozeAI',
      provider: config.provider,
      apiKeySource: config.apiKeySource,
      sdkVersion: config.sdkVersion,
      timeoutMs: gateway.timeoutMs,
      configuredModel,
      rawResponseContentSaved: false,
      privateRawFileCount: 0,
      privateTemporaryRawCapture: Boolean(privateRawDir),
      questionContentSaved: false,
      authenticationUsed: false,
      databaseWritesUsed: false,
      objectStorageWritesUsed: false,
      inMemorySessionOnly: true,
    },
    rounds: [] as RoundEvidence[],
    summary: null as null | Record<string, unknown>,
  };
  let activeRound = 0;
  let activeRoundCall = 0;
  let rawCaptureCount = 0;
  const save = () => {
    evidence.runtime.rawResponseContentSaved = rawCaptureCount > 0;
    evidence.runtime.privateRawFileCount = rawCaptureCount;
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  };
  const historyInvoke = async (input: Parameters<typeof invokeCozeAI>[0]) => {
    activeRoundCall += 1;
    const result = await invokeCozeAI(input);
    if (privateRawDir) {
      const file = path.join(privateRawDir, `${caseKey}-round-${String(activeRound).padStart(2, '0')}-call-${String(activeRoundCall).padStart(2, '0')}.txt`);
      writeFileSync(file, result.content, { encoding: 'utf8', mode: 0o600 });
      rawCaptureCount += 1;
    }
    return result;
  };
  save();

  try {
    for (let round = 1; round <= 20; round += 1) {
      activeRound = round;
      activeRoundCall = 0;
      const topic = topics[(round - 1) % topics.length];
      const followUp = round > topics.length;
      const baseQuestion = TOPIC_QUESTIONS[topic.label] ?? `请具体说说${topic.label}。`;
      const question = followUp ? `${baseQuestion}请接着刚才的情况说，后来还有什么变化？` : baseQuestion;
      const contextMessagesProvided = session.messages.filter((item) => ['student', 'child', 'parent'].includes(item.actor)).slice(-12).length;
      const result = await runAgentTurn(
        session,
        { type: 'ASK_QUESTION', data: { text: question } },
        `offline-model-${caseKey}-${round}`,
        { historyInvoke },
      );
      const runtime = result.runtime;
      if (!runtime) throw new Error(`第 ${round} 轮未返回角色模型执行证据`);
      if (privateRawDir && activeRoundCall === 0) throw new Error(`第 ${round} 轮模型原文私有捕获失败`);
      const responses = result.newMessages.filter((item) => item.actor === 'child' || item.actor === 'parent');
      const dialogueText = responses.map((item) => item.content).join('\n');
      const modelDialogueText = runtime.execution === 'model' ? dialogueText : '';
      const event = session.events.at(-1);
      const codes = event?.clientEventId === `offline-model-${caseKey}-${round}` ? event.evidenceCodes : [];

      evidence.rounds.push({
        round,
        topic: topic.label,
        followUp,
        contextMessagesProvided,
        execution: runtime.execution,
        model: runtime.model,
        attempts: runtime.attempts ?? 0,
        modelCalls: activeRoundCall,
        durationMs: runtime.durationMs,
        errorKind: runtime.errorKind ?? null,
        modelDialoguePresent: Boolean(modelDialogueText),
        modelDialogueHash: modelDialogueText ? sha256(modelDialogueText) : null,
        dialogueLength: dialogueText.length,
        dialogueActors: responses.map((item) => item.actor),
        utteranceCount: responses.length,
        citedFactCount: codes.filter((code) => code !== 'COMMUNICATION').length,
        fallbackContentUsed: runtime.execution !== 'model',
        exactQuestionEcho: dialogueText.trim() === question.trim(),
        validationReasons: runtime.validationReasons ?? [],
      });
      save();
      console.log(`ROUND ${caseKey} ${round}/20 execution=${runtime.execution} model=${runtime.model ?? 'null'} attempts=${runtime.attempts ?? 0} modelCalls=${activeRoundCall} durationMs=${runtime.durationMs} context=${contextMessagesProvided} validation=${(runtime.validationReasons ?? []).join(',') || 'none'}`);
    }

    const durations = evidence.rounds.map((item) => item.durationMs).sort((a, b) => a - b);
    const executions = evidence.rounds.reduce<Record<string, number>>((acc, item) => {
      acc[item.execution] = (acc[item.execution] ?? 0) + 1;
      return acc;
    }, {});
    const validationReasons = evidence.rounds.flatMap((item) => item.validationReasons).reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
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
      validationIssueRounds: evidence.rounds.filter((item) => item.validationReasons.length > 0).length,
      validationReasons,
      totalAttempts: evidence.rounds.reduce((sum, item) => sum + item.attempts, 0),
      totalModelCalls: evidence.rounds.reduce((sum, item) => sum + item.modelCalls, 0),
      correctedModelCalls: evidence.rounds.filter((item) => item.modelCalls > 1).length,
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
    const expectedRawCount = evidence.rounds.reduce((sum, item) => sum + item.modelCalls, 0);
    if (evidence.rounds.length !== 20 || (executions.model ?? 0) === 0 || (privateRawDir && rawCaptureCount !== expectedRawCount)) process.exitCode = 1;
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
