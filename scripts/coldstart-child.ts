/* eslint-disable no-console */
/**
 * 冷启动验证子进程驱动器：由 verify-coldstart-restore.ts 以独立进程 spawn，
 * 每条指令在新进程空缓存中执行（真实进程重启语义，不用同进程二次 restore 冒充），
 * 输出 JSON 摘要（不输出病例内容，仅结构性字段与指纹前缀）。
 *
 * 指令：bind（读本地版本指纹）/ restore（旧会话绑定版本冷启动恢复全链路）/
 *       v1v2（同源 V1/V2 缓存不串）/ missing（缺失绑定版本=资料不足）/
 *       resolve（新会话版本解析）/ newsession（引擎层新会话形态）/ alias（别名解析一致）
 */

process.env.PEDIATRICS_KNOWLEDGE_ROOT = process.env.FIXTURE_ROOT ?? '';

const cmd = process.argv[2];
const V1 = process.env.V1 ?? '';
const V2 = process.env.V2 ?? '';
const CASE_ID = 'teacher-肾病综合征';
// 合成令牌：仅发往本地合成 HTTP 上游（127.0.0.1），不触真实平台，非真实 JWT。
const SYNTH_TOKEN = 'synthetic-token';
// 会话归属校验用的合成会话 ID（由父脚本按场景注入：V1 绑定旧会话 / V2 绑定新会话）
const SESSION_ID = process.env.SESSION_ID ?? '11111111-1111-1111-1111-111111111111';
const WRONG_SESSION_ID = '22222222-2222-2222-2222-222222222222';

type Summary = Record<string, unknown>;
const out: Summary = { cmd };

async function main(): Promise<void> {
  if (cmd === 'bind') {
    const { getLocalImportVersion } = await import('../src/lib/teacher-case-import');
    out.version = getLocalImportVersion(CASE_ID);
  } else if (cmd === 'restore') {
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    const { restoreCaseSnapshotFacts, restoreCaseSnapshotReference } = await import('../src/lib/case-snapshot');
    // 1) 新进程空缓存 + 本地已修订为 V2：按 V1 绑定版本直接读取 = null（资料不足，不以新版代替）
    out.beforeNull = readTeacherCaseData(CASE_ID, V1) === null;
    // 2) 教师直读路径（合成 HTTP 上游 case_snapshot_facts）恢复 V1 事实 → 写入版本键缓存
    const teacherFacts = await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'teacher');
    out.teacherRestored = Boolean(teacherFacts);
    // 3) 恢复后 readTeacherCaseData 按 V1 绑定取回 V1 事实（文档指纹应为 V1 前缀）
    const after = readTeacherCaseData(CASE_ID, V1);
    out.afterRestored = after !== null;
    out.afterAge = after?.age ?? null;
    // 恢复态为 facts 子集：documents 恒为空（原文分片不进学生可见缓存），以结构字段断言
    out.afterDocsCount = after ? after.documents.length : null;
    out.afterHistoryLen = after ? after.sections.history.length : 0;
    // 4) 学生受控 RPC 路径（合成上游校验会话归属）同样恢复 V1
    const studentFacts = await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'student', SESSION_ID);
    out.studentRpcRestored = Boolean(studentFacts);
    // 5) 会话归属不匹配时 RPC 拒绝（返回 null，校验生效）
    const wrongSession = await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'student', WRONG_SESSION_ID);
    out.wrongSessionRejected = wrongSession === null;
    // 6) 评分对照（answers：诊断/处置，来自合成上游 V1 版本行）——仅输出指纹前缀，不输出病例内容
    const reference = await restoreCaseSnapshotReference(CASE_ID, V1, SYNTH_TOKEN, 'student', SESSION_ID);
    out.referenceRestored = Boolean(reference && reference.diagnosis && reference.plan);
    const { createHash } = await import('node:crypto');
    out.referenceDiagSha = reference ? createHash('sha256').update(reference.diagnosis).digest('hex').slice(0, 12) : null;
    out.referenceV1Match = out.referenceDiagSha !== null && out.referenceDiagSha === (process.env.V1_DIAG_SHA ?? '');
  } else if (cmd === 'v1v2') {
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    const { restoreCaseSnapshotFacts } = await import('../src/lib/case-snapshot');
    // 预热 V1 版本键缓存（模拟该版本已有会话命中）
    await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'teacher');
    const d1 = readTeacherCaseData(CASE_ID, V1); // 命中 V1 版本键缓存
    const d2 = readTeacherCaseData(CASE_ID, V2); // 本地当前权威版本 V2
    out.v1Age = d1?.age ?? null;
    out.v2Age = d2?.age ?? null;
    out.v1Docs = d1 ? d1.documents.length : null;
    out.v2Docs = d2 ? d2.documents.length : null;
    out.bothPresent = Boolean(d1 && d2);
    // V1 来自恢复缓存（facts 子集，documents 为空），V2 来自本地当前文件：以 age 与 history 指纹判定不串版本
    out.notCrossed = Boolean(d1 && d2 && d1.age !== d2.age && d1.sections.history !== d2.sections.history);
  } else if (cmd === 'missing') {
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    // 缺失绑定版本：明确资料不足，不回退当前新版数据代替
    out.missingNull = readTeacherCaseData(CASE_ID, 'nonexist000000000') === null;
  } else if (cmd === 'missinglocal') {
    // 部署冷启动形态：本地 teaching-cases 无该病例 JSON，getLocalImportVersion=null，
    // 版本解析走 DB（source=db, coldStart=true，绑定 DB 已装载版本而非召回兜底）
    const { getLocalImportVersion } = await import('../src/lib/teacher-case-import');
    const { resolveTeacherCaseVersion } = await import('../src/lib/case-version-select');
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    out.localVersionNull = getLocalImportVersion(CASE_ID) === null;
    const resolution = await resolveTeacherCaseVersion(CASE_ID, { accessToken: SYNTH_TOKEN, role: 'student', isPreview: false });
    out.version = resolution.version;
    out.source = resolution.source;
    out.coldStart = resolution.coldStart;
    out.isDb = resolution.source === 'db' && resolution.coldStart;
    // 恢复绑定版本事实后按绑定版本读取成功（本地缺失但版本键缓存可命中）
    const { restoreCaseSnapshotFacts } = await import('../src/lib/case-snapshot');
    const restored = await restoreCaseSnapshotFacts(CASE_ID, resolution.version ?? '', SYNTH_TOKEN, 'student', SESSION_ID);
    out.restored = Boolean(restored);
    const after = readTeacherCaseData(CASE_ID, resolution.version);
    out.afterRestored = after !== null && after.age === restored?.age;
  } else if (cmd === 'resolve') {
    const { resolveTeacherCaseVersion } = await import('../src/lib/case-version-select');
    const resolution = await resolveTeacherCaseVersion(CASE_ID, { accessToken: SYNTH_TOKEN, role: 'student', isPreview: false });
    out.version = resolution.version;
    out.source = resolution.source;
    out.isCurrent = resolution.version === V2;
  } else if (cmd === 'newsession') {
    const { createInitialSession } = await import('../src/lib/agent-engine');
    const session = createInitialSession('user-coldstart', 'guided', CASE_ID, undefined, null);
    out.caseId = session.caseId;
    out.triageOk = typeof session.messages[0]?.content === 'string' && session.messages[0].content.length > 0;
    // 引擎层不绑定版本（绑定发生在 repository 经 resolve 之后，另由 resolve 指令与真实平台验证）
    out.engineNoVersion = session.sourceSnapshotVersion === undefined || session.sourceSnapshotVersion === null;
  } else if (cmd === 'projected') {
    // 阶段化投影场景（真实迁移 20261010120000 语义）：学生未执行查体/开检查前，
    // RPC 返回的 sections.exam/tests 被安全剥离（键缺失）。恢复链必须规范化缺键为空串，
    // 保证 readTeacherCaseData 的 recordSchema 校验通过（修复前此场景降级"资料不足"）。
    const { restoreCaseSnapshotFacts } = await import('../src/lib/case-snapshot');
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    const facts = await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'student', SESSION_ID);
    out.rpcRestored = Boolean(facts);
    const data = readTeacherCaseData(CASE_ID, V1);
    out.normalizedReadable = data !== null;
    out.examEmpty = data ? data.sections.exam === '' : null;
    out.testsEmpty = data ? data.sections.tests === '' : null;
    out.historyKept = data ? data.sections.history.length > 0 : false;
    out.ageKept = data ? data.age === (facts?.age ?? '') : false;
  } else if (cmd === 'alias') {
    const { getTeacherSourceId } = await import('../src/lib/teacher-case-data');
    const direct = getTeacherSourceId(CASE_ID);
    const decoded = getTeacherSourceId(decodeURIComponent(CASE_ID));
    out.direct = direct;
    out.decoded = decoded;
    out.stable = direct === decoded;
  } else {
    out.error = 'unknown command';
  }
  out.ok = !out.error;
}

main()
  .then(() => console.log(JSON.stringify(out)))
  .catch((error: unknown) => {
    out.ok = false;
    out.error = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify(out));
  });
