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
  respiratory: 'teacher-肺炎支原体肺炎',
};

// Continuous clinic conversations, including short references and clarification;
// cycling independent topic questions cannot validate dialogue continuity.
const NATURAL_QUESTIONS: Record<CaseKey, string[]> = {
  dka: ['孩子主要哪里不舒服？','最早什么时候开始的？','后来呢？','喝水和小便有什么变化？','比之前明显吗？','吃东西和体重呢？','小朋友，你觉得哪里不舒服？','还是那个地方难受吗？','就诊前做过什么处理或者用过什么药？','吃了以后呢？','现在精神怎么样？有没有呕吐？','以前有过类似情况吗？','出生和生长发育怎么样？','家里有没有类似疾病？','您现在最担心什么？','我会先了解清楚，再向您解释检查安排。','那个变化一直都有吗？','我指的是前面说的小便变化。','有过敏或者长期用药吗？','还有什么刚才没问到、您想补充的吗？'],
  newborn: ['宝宝出生多久了？这次因为什么来就诊？','最早发现什么变化？','后来呢？','吃奶和精神怎么样？','比平时少多少？您有记录吗？','小便和大便有什么变化？','哭声和活动呢？','有没有量过体温？最高或最低是多少？','出生时情况怎么样？','孕期和分娩有什么特别情况？','来就诊前做过什么处理？','做完以后呢？','以前查过什么？您记得哪些结果？','家里有过类似情况吗？','您最担心什么？','我先轻轻检查宝宝，同时向您解释每一步。','刚才说的那个是什么意思？','我是问吃奶情况有没有变化。','宝宝现在能自己说哪里不舒服吗？','还有什么没有问到的变化？'],
  respiratory: ['孩子主要哪里不舒服？','最早什么时候开始？','后来呢？','咳嗽是什么样子的？','晚上和白天有区别吗？','有没有发烧？量过多少？','已经用过什么药？','吃了以后呢？','现在呼吸费力吗？','小朋友，你觉得哪里疼或者不舒服？','还是那个地方吗？','这几天精神和吃饭怎么样？','小便呢？','以前有类似的病吗？','有过敏或接触类似病人吗？','家长现在最担心什么？','我会轻轻检查，不舒服可以告诉我。','这个情况是一直这样，还是后来才有？','我是问咳嗽的变化。','还有需要补充的吗？'],
};

interface RoundEvidence {
  round: number;
  topic: string;
  followUp: boolean;
  coverageTags: string[];
  contextMessagesProvided: number;
  execution: string;
  model: string | null;
  attempts: number;
  modelCalls: number;
  capturedRawCalls: number;
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
  let session = createInitialSession('offline-model-verification-no-auth', 'guided', caseId, undefined, sourceVersion);
  assert.equal(session.sourceSnapshotVersion, sourceVersion);
  assert.equal(session.teachingPackageVersion, pack.version);
  const facts = allSourceFacts(session);
  const topics = SOURCE_HISTORY_TOPICS.filter((topic) => facts.some((fact) => fact.topics.includes(topic.label)));
  if (topics.length === 0) throw new Error(`${caseId} 未解析到可提问的病史主题`);
  const configuredModel = process.env.COZE_AI_ROLE_MODEL || 'doubao-seed-1-8-251228';
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const evidence = {
    schemaVersion: 6,
    status: 'running' as 'running' | 'completed' | 'failed',
    startedAt: new Date().toISOString(),
    completedAt: null as string | null,
    sourceCommit,
    workingTreeDirty,
    caseKey,
    caseId,
    requestedRounds: 20,
    conversationScenario: 'natural-clinic-v1',
    serializedRestoreAfterRound: null as number | null,
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
  let activeRoundCaptured = 0;
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
      activeRoundCaptured += 1;
      rawCaptureCount += 1;
    }
    return result;
  };
  save();

  try {
    for (let round = 1; round <= 20; round += 1) {
      activeRound = round;
      activeRoundCall = 0;
      activeRoundCaptured = 0;
      const question = NATURAL_QUESTIONS[caseKey][round-1];
      const followUp = /^(?:后来|吃了|做完|还是|比之前|比平时|那个|这个|我是|我指|小便呢)/.test(question);
      const coverageTags=[...(followUp?['context-reference']:[]),...(/小朋友|宝宝现在能自己/.test(question)?['child-capability']:[]),...(/担心/.test(question)?['caregiver-concern']:[]),...(/我会|我先/.test(question)?['reassurance']:[]),...(/什么意思|我指的是|我是问/.test(question)?['clarification']:[]),...(question.split(/[？?]/).filter(Boolean).length>1||/和|或者/.test(question)?['compound-question']:[])];
      const contextMessagesProvided = session.messages.filter((item) => ['student', 'child', 'parent'].includes(item.actor)).slice(-12).length;
      const result = await runAgentTurn(
        session,
        { type: 'ASK_QUESTION', data: { text: question } },
        `offline-model-${caseKey}-${round}`,
        { historyInvoke },
      );
      const runtime = result.runtime;
      session=result.session;
      if (!runtime) throw new Error(`第 ${round} 轮未返回角色模型执行证据`);
      if (privateRawDir && activeRoundCall === 0) throw new Error(`第 ${round} 轮模型原文私有捕获失败`);
      const responses = result.newMessages.filter((item) => item.actor === 'child' || item.actor === 'parent');
      const dialogueText = responses.map((item) => item.content).join('\n');
      const modelDialogueText = runtime.execution === 'model' ? dialogueText : '';
      const event = session.events.at(-1);
      const codes = event?.clientEventId === `offline-model-${caseKey}-${round}` ? event.evidenceCodes : [];

      evidence.rounds.push({
        round,
        topic: session.dialogueMemory?.topic??'当前不适',
        followUp,
        coverageTags,
        contextMessagesProvided,
        execution: runtime.execution,
        model: runtime.model,
        attempts: runtime.attempts ?? 0,
        modelCalls: activeRoundCall,
        capturedRawCalls: activeRoundCaptured,
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
      if(round===10){
        const serialized=JSON.stringify(session),before=sha256(serialized);
        session=JSON.parse(serialized) as SessionState;
        assert.equal(sha256(JSON.stringify(session)),before);
        assert.equal(session.teachingPackageVersion,pack.version);
        assert.equal(session.sourceSnapshotVersion,sourceVersion);
        evidence.serializedRestoreAfterRound=10;
      }
      save();
      console.log(`ROUND ${caseKey} ${round}/20 execution=${runtime.execution} model=${runtime.model ?? 'null'} attempts=${runtime.attempts ?? 0} modelCalls=${activeRoundCall} capturedRawCalls=${activeRoundCaptured} durationMs=${runtime.durationMs} context=${contextMessagesProvided} error=${runtime.errorKind ?? 'none'} validation=${(runtime.validationReasons ?? []).join(',') || 'none'}`);
      if(evidence.rounds.slice(-3).length===3&&evidence.rounds.slice(-3).every(item=>['rate_limited','auth','config','not_configured'].includes(item.errorKind??'')))break;
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
    const modelRounds = executions.model ?? 0;
    const validationFallbackRounds = evidence.rounds.filter((item) => item.execution === 'model_fallback' && item.errorKind === 'ungrounded_dialogue').length;
    const nonEvaluableRounds = evidence.rounds.filter((item) => item.execution !== 'model' && !(item.execution === 'model_fallback' && item.errorKind === 'ungrounded_dialogue'));
    const rateLimitedRounds = evidence.rounds.filter((item) => item.errorKind === 'rate_limited').length;
    const rawCaptureComplete = !privateRawDir || evidence.rounds.every((item) => item.capturedRawCalls === item.modelCalls);
    const evaluationValid = evidence.rounds.length === 20 && modelRounds > 0 && nonEvaluableRounds.length === 0 && rawCaptureComplete;
    const errorKinds = evidence.rounds.reduce<Record<string, number>>((acc, item) => {
      if (item.errorKind) acc[item.errorKind] = (acc[item.errorKind] ?? 0) + 1;
      return acc;
    }, {});
    evidence.summary = {
      evaluationValid,
      coverageTags:[...new Set(evidence.rounds.flatMap(item=>item.coverageTags))],
      serializedRestoreAfterRound:evidence.serializedRestoreAfterRound,
      completedRounds: evidence.rounds.length,
      stoppedEarly:evidence.rounds.length<20,
      remainingRounds:20-evidence.rounds.length,
      executions,
      modelRounds,
      fallbackRounds: executions.model_fallback ?? 0,
      validationFallbackRounds,
      transportFailureRounds: nonEvaluableRounds.length,
      nonEvaluableRoundNumbers: nonEvaluableRounds.map((item) => item.round),
      rateLimitedRounds,
      deterministicRounds: executions.deterministic ?? 0,
      errorKinds,
      uniqueModelDialogueHashes: new Set(modelHashes).size,
      exactQuestionEchoRounds: evidence.rounds.filter((item) => item.exactQuestionEcho).length,
      contextCarriedRounds: evidence.rounds.filter((item) => item.contextMessagesProvided > 0).length,
      validationIssueRounds: evidence.rounds.filter((item) => item.validationReasons.length > 0).length,
      validationReasons,
      totalAttempts: evidence.rounds.reduce((sum, item) => sum + item.attempts, 0),
      totalModelCalls: evidence.rounds.reduce((sum, item) => sum + item.modelCalls, 0),
      totalCapturedRawCalls: evidence.rounds.reduce((sum, item) => sum + item.capturedRawCalls, 0),
      rawCaptureComplete,
      correctedModelCalls: evidence.rounds.filter((item) => item.modelCalls > 1).length,
      latencyMs: {
        min: durations[0] ?? 0,
        p50: durations[Math.floor((durations.length - 1) * 0.5)] ?? 0,
        p95: durations[Math.floor((durations.length - 1) * 0.95)] ?? 0,
        max: durations.at(-1) ?? 0,
      },
    };
    evidence.status = evidence.rounds.length===20?'completed':'failed';
    evidence.completedAt = new Date().toISOString();
    save();
    console.log(`SUMMARY ${JSON.stringify(evidence.summary)}`);
    if (!evaluationValid) process.exitCode = 1;
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
