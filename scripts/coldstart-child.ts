/* eslint-disable no-console */
/**
 * 冷启动验证子进程驱动器：由 verify-coldstart-restore.ts 以独立进程 spawn，
 * 每条指令在新进程空缓存中执行（真实进程重启语义，不用同进程二次 restore 冒充），
 * 输出 JSON 摘要（不输出病例内容，仅结构性字段与指纹前缀）。
 *
 * 指令：bind（读本地版本指纹）/ restore（旧会话绑定版本冷启动恢复全链路）/
 *       v1v2（同源 V1/V2 缓存不串）/ missing（缺失绑定版本=资料不足）/
 *       resolve（新会话版本解析）/ newsession（引擎层新会话形态）/ alias（别名解析一致）/
 *       crosssessionAB / crosssessionBA（双会话交叉污染：A已解锁/B未解锁两种顺序，
 *        断言互不泄露、互不丢失、共享键不被学生投影态污染）/
 *       score（旧会话绑定 V1 的事实与评分链路）/ scoremissing（无有效事实会话走非生成式过程分口径）
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
// 双会话交叉污染场景：A=已解锁（RPC 返回完整投影），B=未解锁（RPC 剥离 exam/tests）
const SESSION_A_FULL = '55555555-5555-5555-5555-555555555555';
const SESSION_B_PROJ = '44444444-4444-4444-4444-444444444444';
// 父进程注入的 V1 结构标记与年龄（子进程不直接读 V1 夹具，仅作比对）
const V1_AGE = process.env.V1_AGE ?? '';
const V1_EXAM_MARK = process.env.V1_EXAM_MARK ?? '';
const V1_TESTS_MARK = process.env.V1_TESTS_MARK ?? '';

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
    // 学生投影态只写会话作用域键：读取必须带 sessionId 命中本人投影（生产链路 getCase 已透传 session.id）
    const after = readTeacherCaseData(CASE_ID, resolution.version, SESSION_ID);
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
    // 学生投影态只写会话作用域键：读取带 sessionId 命中本人投影（生产链路 getCase 已透传 session.id）
    const data = readTeacherCaseData(CASE_ID, V1, SESSION_ID);
    out.normalizedReadable = data !== null;
    out.examEmpty = data ? data.sections.exam === '' : null;
    out.testsEmpty = data ? data.sections.tests === '' : null;
    out.historyKept = data ? data.sections.history.length > 0 : false;
    out.ageKept = data ? data.age === (facts?.age ?? '') : false;
  } else if (cmd === 'crosssessionAB' || cmd === 'crosssessionBA') {
    // 双会话交叉污染（两种顺序对称执行）：
    // A=已解锁会话（RPC 返回完整投影，含 exam/tests），B=未解锁会话（RPC 剥离 exam/tests）。
    // 先后恢复两个会话，再各自读取——断言 A 不丢失已解锁内容、B 不泄露 A 的完整投影。
    const { restoreCaseSnapshotFacts } = await import('../src/lib/case-snapshot');
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    const first = cmd === 'crosssessionAB' ? SESSION_A_FULL : SESSION_B_PROJ;
    const second = cmd === 'crosssessionAB' ? SESSION_B_PROJ : SESSION_A_FULL;
    await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'student', first);
    await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'student', second);
    const dataA = readTeacherCaseData(CASE_ID, V1, SESSION_A_FULL);
    const dataB = readTeacherCaseData(CASE_ID, V1, SESSION_B_PROJ);
    // A：完整投影（exam/tests 非空且与 fixture 一致），不因 B 的恢复而丢失
    out.aNotLost = Boolean(dataA && dataA.sections.exam.length > 0 && dataA.sections.tests.length > 0);
    out.aExamKept = dataA ? dataA.sections.exam.includes(V1_EXAM_MARK) : false;
    out.aTestsKept = dataA ? dataA.sections.tests.includes(V1_TESTS_MARK) : false;
    // B：剥离态（exam/tests 空串），不因 A 的恢复而泄露完整查体/检查事实
    out.bNotLeaked = Boolean(dataB && dataB.sections.exam === '' && dataB.sections.tests === '');
    // 共享键不被学生投影态污染：无 sessionId 的版本键读取仅允许命中教师直读/召回产物——
    // 本场景只有学生恢复写入，共享键应无数据（null 或不包含会话投影内容）
    const shared = readTeacherCaseData(CASE_ID, V1);
    out.sharedClean = shared === null;
    // 顺序无关性：两种顺序结果一致
    out.order = cmd;
  } else if (cmd === 'score') {
    // 旧会话绑定 V1 的评分链路：事实与对照都来自 V1 版本行（本地已是 V2），不漂移
    const { restoreCaseSnapshotFacts, restoreCaseSnapshotReference } = await import('../src/lib/case-snapshot');
    const { buildReport } = await import('../src/lib/scoring');
    const facts = await restoreCaseSnapshotFacts(CASE_ID, V1, SYNTH_TOKEN, 'student', SESSION_ID);
    out.factsRestored = Boolean(facts);
    const reference = await restoreCaseSnapshotReference(CASE_ID, V1, SYNTH_TOKEN, 'student', SESSION_ID);
    out.referenceRestored = Boolean(reference?.diagnosis && reference?.plan);
    const { createHash } = await import('node:crypto');
    out.referenceDiagSha = reference ? createHash('sha256').update(reference.diagnosis).digest('hex').slice(0, 12) : null;
    out.referenceV1Match = out.referenceDiagSha !== null && out.referenceDiagSha === (process.env.V1_DIAG_SHA ?? '');
    // 构造绑定 V1 的会话并评分：过程分口径，对照为 V1（非生成式评分兜底语义）
    const session = {
      id: SESSION_ID,
      userId: 'user-coldstart',
      caseId: CASE_ID,
      caseVersion: 2,
      mode: 'guided',
      sourceSnapshotVersion: V1,
      stage: 'report',
      status: 'completed',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
      practiceFocus: null,
      messages: [],
      events: [],
      askedIntents: ['SOURCE_HX_0'],
      preparationActions: [],
      unlockedEvidence: ['EX_PREP', 'SOURCE_EX_all'],
      orderedTests: [],
      decision: { diagnosis: '合成诊断', summary: '合成摘要', differentials: '合成鉴别' },
      plan: { priority: '监测', detail: '进一步评估' },
      communication: '我理解您担心。',
      childEmotion: 'neutral',
      parentInterruption: 'active',
      behavior: { childResponseStyle: 'cooperative', parentResponseStyle: 'supportive', hiddenExposureRevealed: false, cooperation: 80 },
      vitals: { temperature: 36.5, heartRate: null, respiratoryRate: null, spo2: null },
      reportId: null,
    } as Parameters<typeof buildReport>[0];
    const report = buildReport(session, `report-${SESSION_ID}`, reference ?? undefined);
    out.scoreBasis = report.scoreBasis;
    out.status = report.status;
    // 事实来自 V1（评分前按绑定版本+会话作用域可读）
    const { readTeacherCaseData } = await import('../src/lib/teacher-case-data');
    const data = readTeacherCaseData(CASE_ID, V1, SESSION_ID);
    out.factsAge = data?.age ?? null;
    out.factsIsV1 = data ? data.age === V1_AGE : false;
  } else if (cmd === 'scoremissing') {
    // 无有效事实会话（版本解析失败/无绑定版本）：teacher- 前缀但事实缺失 →
    // buildReport 走 buildSourceReport（非生成式过程分口径），不用漂移数据补造诊断对照
    const { buildReport } = await import('../src/lib/scoring');
    const session = {
      id: '99999999-9999-9999-9999-999999999999',
      userId: 'user-coldstart',
      caseId: CASE_ID,
      caseVersion: 2,
      mode: 'guided',
      sourceSnapshotVersion: null,
      stage: 'report',
      status: 'completed',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
      practiceFocus: null,
      messages: [],
      events: [],
      askedIntents: [],
      preparationActions: [],
      unlockedEvidence: [],
      orderedTests: [],
      decision: null,
      plan: null,
      communication: null,
      childEmotion: 'neutral',
      parentInterruption: 'active',
      behavior: { childResponseStyle: 'cooperative', parentResponseStyle: 'supportive', hiddenExposureRevealed: false, cooperation: 80 },
      vitals: { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
      reportId: null,
    } as Parameters<typeof buildReport>[0];
    const report = buildReport(session, `report-missing`, undefined);
    out.scoreBasis = report.scoreBasis;
    out.status = report.status;
    out.totalScore = report.totalScore;
    // 无任何过程证据：六维全 0（仅过程分，不生成事实评分）
    const sum = Object.values(report.abilities).reduce((acc: number, v: unknown) => acc + Number(v ?? 0), 0);
    out.allZero = out.totalScore === 0 && sum === 0;
    // 无诊断对照回填（不补造）
    out.noReference = !report.evidence.some((item) => item.code === 'SOURCE_DIAGNOSIS_REFERENCE' || item.code === 'SOURCE_PLAN_REFERENCE');
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
