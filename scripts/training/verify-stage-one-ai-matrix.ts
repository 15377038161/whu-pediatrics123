import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInitialSession, runAgentTurn } from '../../src/lib/agent-engine';
import { sessionTeachingCase } from '../../src/lib/session-teaching';
import { findSupplementalTest, TEACHING_SIMULATION_LABEL } from '../../src/lib/test-result-supplement';
import { classifyAIError, hasAICredentials, invokeCozeAIStream } from '../../src/lib/coze-ai';
import { matchRequestedTest } from '../../src/lib/test-name-matcher';
import type { SessionState } from '../../src/domain/agent';
import type { TeachingPackage } from '../../src/domain/teaching-package';
import { installLocalStageOne } from './install-local-stage-one';

const contentArchive = process.env.PEDIATRICS_STAGE_ONE_CONTENT;
const runtimeRoot = process.env.PEDIATRICS_STAGE_ONE_RUNTIME;
const outputRoot = process.env.PEDIATRICS_STAGE_ONE_OUTPUT ?? '/tmp/peds67-stage-one-acceptance';
if (!contentArchive || !runtimeRoot) throw new Error('PEDIATRICS_STAGE_ONE_CONTENT_AND_RUNTIME_REQUIRED');
if (process.env.ENABLE_AI_FIXTURE === 'true' || !hasAICredentials()) throw new Error('REAL_AI_CREDENTIALS_REQUIRED');
const mode = process.env.PEDIATRICS_AI_MATRIX_MODE ?? 'generate';
if (mode !== 'generate' && mode !== 'restore') throw new Error('PEDIATRICS_AI_MATRIX_MODE_MUST_BE_GENERATE_OR_RESTORE');
const caseOffset = Math.max(0, Number.parseInt(process.env.PEDIATRICS_STAGE_ONE_CASE_OFFSET ?? '0', 10) || 0);
const caseLimit = Math.max(1, Number.parseInt(process.env.PEDIATRICS_STAGE_ONE_CASE_LIMIT ?? '67', 10) || 67);
const runtime = installLocalStageOne(contentArchive, runtimeRoot);
const runtimeGeneration = path.basename(path.dirname(runtimeRoot));
const selectedPackages = runtime.packages.slice(caseOffset, caseOffset + caseLimit);
if (!selectedPackages.length) throw new Error('STAGE_ONE_CASE_RANGE_EMPTY');
const sessionRoot = path.join(outputRoot, 'ai-sessions');
const rawRoot = path.join(outputRoot, 'ai-raw');
mkdirSync(sessionRoot, { recursive: true });
mkdirSync(rawRoot, { recursive: true });

const general = ['血常规', 'C反应蛋白', '尿常规', '肝功能', '肾功能', '电解质', '血气分析'];
const candidatesFor = (pack: TeachingPackage): string[] => {
  const title = pack.title;
  if (/心律|心肌|川崎|中毒/.test(title)) return ['心电图', '超声心动图', '肌钙蛋白', ...general];
  if (/肾|泌尿|尿崩/.test(title)) return ['尿常规', '肾功能', '电解质', ...general];
  if (/肺炎|支气管|呼吸|喉炎|肺不张|异物|哮喘/.test(title)) return ['血常规', 'C反应蛋白', '血气分析', '胸部CT', ...general];
  if (/脑|癫痫|惊厥|肌无力|脱髓鞘/.test(title)) return ['脑电图', '血常规', '电解质', ...general];
  if (/肥胖|早熟|矮小|生长激素|糖原|糖尿病|肾上腺/.test(title)) return ['血糖', '肝功能', '尿常规', ...general];
  return general;
};

function selectUnpreset(pack: TeachingPackage, session: SessionState): string {
  const tests = sessionTeachingCase(session).tests;
  const candidates = [...candidatesFor(pack), '凝血功能', '血培养', '铁蛋白', '乳酸'];
  const selected = candidates.find(name => matchRequestedTest(name, tests).test === null);
  assert.ok(selected, `NO_UNPRESET_REASONABLE_TEST:${pack.caseId}`);
  return selected;
}

function sessionFile(pack: TeachingPackage): string {
  return path.join(sessionRoot, `${pack.version}.json`);
}

async function repeatWithoutAI(session: SessionState, requested: string, eventId: string): Promise<void> {
  const before = session.supplementalTests?.map(test => ({ ...test })) ?? [];
  const orderedBefore = [...session.orderedTests];
  const result = await runAgentTurn(session, {
    type: 'ORDER_TEST', data: { requestedTests: requested, reason: '恢复后重复申请，必须复用原固定结果' },
  }, eventId, {
    testSupplementInvoke: async () => { throw new Error(`UNEXPECTED_AI_AFTER_RESTORE:${session.caseId}`); },
  });
  assert.deepEqual(session.supplementalTests ?? [], before, `RESTORE_CHANGED_RESULT:${session.caseId}`);
  assert.deepEqual(session.orderedTests, orderedBefore, `RESTORE_DUPLICATED_ORDER:${session.caseId}`);
  assert.equal(result.repeated, undefined, `UNEXPECTED_TRANSPORT_REPLAY:${session.caseId}`);
}

async function generate(pack: TeachingPackage): Promise<Record<string, unknown>> {
  const session = createInitialSession(`ai-matrix-${pack.version}`, 'guided', pack.caseId, undefined, pack.sourceVersion);
  const fixed = pack.tests[0];
  assert.ok(fixed, `FIXED_TEST_MISSING:${pack.caseId}`);
  await runAgentTurn(session, {
    type: 'ORDER_TEST', data: { requestedTests: fixed.label, reason: '预设结果优先复用' },
  }, `${pack.version}-fixed`, {
    testSupplementInvoke: async () => { throw new Error(`UNEXPECTED_AI_FOR_FIXED:${pack.caseId}`); },
  });
  assert.ok(session.orderedTests.includes(fixed.id), `FIXED_TEST_NOT_RELEASED:${pack.caseId}`);
  assert.equal(session.supplementalTests, undefined, `FIXED_TEST_BECAME_SUPPLEMENT:${pack.caseId}`);

  const requested = selectUnpreset(pack, session);
  let calls = 0;
  let attempts = 0;
  const rawHashes: string[] = [];
  const failureKinds: string[] = [];
  const startedAt = new Date().toISOString();
  for (let round = 1; round <= 2 && !findSupplementalTest(session, requested); round++) {
    let gatewayFailed = false;
    const result = await runAgentTurn(session, {
      type: 'ORDER_TEST', data: { requestedTests: requested, reason: '结合本例病情申请合理的未预设检查' },
    }, `${pack.version}-ai-${round}`, {
      testSupplementInvoke: async input => {
        calls++;
        try {
          const response = await invokeCozeAIStream({ ...input, timeoutMs: 90_000, maxAttempts: 2 });
          attempts += response.attempts;
          const raw = response.content;
          rawHashes.push(createHash('sha256').update(raw).digest('hex'));
          writeFileSync(path.join(rawRoot, `${pack.version}-${calls}.txt`), raw, { flag: 'w' });
          return { content: raw };
        } catch (error) {
          gatewayFailed = true;
          const info = classifyAIError(error);
          failureKinds.push(`${info.kind}:${info.statusCode ?? 'none'}:${info.detail.slice(0, 500)}`);
          throw error;
        }
      },
    });
    const generated = findSupplementalTest(session, requested);
    if (generated) {
      assert.ok(result.newMessages.some(message => message.content.includes(TEACHING_SIMULATION_LABEL)), `AI_LABEL_MISSING:${pack.caseId}`);
    }
    // The gateway already performed its bounded network retries. A second full turn is
    // reserved for a completed model response that failed JSON/clinical validation.
    if (gatewayFailed) break;
  }
  const generated = findSupplementalTest(session, requested);
  assert.ok(generated, `REAL_AI_NO_VALID_RESULT:${pack.caseId}:${requested}:failures=${failureKinds.join(',') || 'invalid_model_output'}`);
  assert.equal(generated.origin, 'teaching-simulation', `UNEXPECTED_ORIGIN:${pack.caseId}`);
  assert.equal(generated.sourceSnapshotVersion, pack.sourceVersion);
  assert.equal(generated.teachingPackageVersion, pack.version);
  assert.ok(generated.report, `STRUCTURED_REPORT_MISSING:${pack.caseId}`);
  assert.equal(generated.report.origin, 'teaching-simulation');
  assert.equal(generated.sourceTestIds.length, 0);
  assert.equal(generated.sourceQuotes.length, 0);
  assert.ok(generated.result.length >= 8);
  assert.doesNotMatch(generated.result, /原患者实测结果|原始报告(?:显示|结果)|真实患者报告|真实检验报告/);
  assert.ok(session.unlockedEvidence.includes(`TEACHING_SIMULATION_TEST_${generated.id}`));
  assert.equal(generated.model, process.env.COZE_AI_TEST_MODEL || 'deepseek-v4-flash');

  const serialized = JSON.stringify(session);
  const refreshed = JSON.parse(serialized) as SessionState;
  await repeatWithoutAI(refreshed, requested, `${pack.version}-refresh-repeat`);
  writeFileSync(sessionFile(pack), JSON.stringify(refreshed, null, 2), { flag: 'w' });
  return {
    caseId: pack.caseId, packageVersion: pack.version, sourceVersion: pack.sourceVersion,
    fixedTest: fixed.id, requested, generatedId: generated.id, origin: generated.origin,
    reportRows: generated.report.rows.length, result: generated.result, report: generated.report,
    realModelCalls: calls, gatewayAttempts: attempts, rawSha256: rawHashes,
    startedAt, completedAt: new Date().toISOString(), refreshReuse: true,
  };
}

async function restore(pack: TeachingPackage): Promise<Record<string, unknown>> {
  const file = sessionFile(pack);
  assert.ok(existsSync(file), `SAVED_SESSION_MISSING:${pack.caseId}`);
  const session = JSON.parse(readFileSync(file, 'utf8')) as SessionState;
  const generated = session.supplementalTests?.find(test => test.teachingPackageVersion === pack.version && test.origin === 'teaching-simulation');
  assert.ok(generated, `SAVED_AI_RESULT_MISSING:${pack.caseId}`);
  const fixed = pack.tests[0];
  assert.ok(fixed);
  await repeatWithoutAI(session, generated.requested, `${pack.version}-restart-repeat`);
  await repeatWithoutAI(session, fixed.label, `${pack.version}-restart-fixed-repeat`);
  return {
    caseId: pack.caseId, packageVersion: pack.version, requested: generated.requested,
    generatedId: generated.id, processRestartReuse: true, fixedRestartReuse: true,
    resultSha256: createHash('sha256').update(generated.result).digest('hex'),
  };
}

async function main(): Promise<void> {
  const details: Array<Record<string, unknown>> = [];
  for (const pack of selectedPackages) {
    const detail = mode === 'generate' ? await generate(pack) : await restore(pack);
    details.push(detail);
    console.log(`[ai-matrix:${mode}] ${details.length}/${selectedPackages.length} ${pack.caseId} ${String(detail.requested)} calls=${String(detail.realModelCalls ?? 0)}`);
  }
  const file = path.join(outputRoot, `ai-matrix-${mode}-${caseOffset}-${caseOffset + selectedPackages.length}.json`);
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1, mode, caseOffset, cases: details.length,
    runtimeGeneration, sourceArchiveSha256: runtime.sourceArchiveSha256,
    realModelCalls: details.reduce((sum, item) => sum + Number(item.realModelCalls ?? 0), 0),
    gatewayAttempts: details.reduce((sum, item) => sum + Number(item.gatewayAttempts ?? 0), 0), details,
  }, null, 2), { flag: 'w' });
  console.log(`AI_MATRIX_${mode.toUpperCase()}_PASS ${JSON.stringify({ cases: details.length, caseOffset, runtimeGeneration, file })}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
