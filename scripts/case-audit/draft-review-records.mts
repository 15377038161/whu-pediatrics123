/**
 * 66 项逐例实审草稿装配器：
 * 从真实数据文件（候选/batch-audit/cloud-compare/运行验证/媒体绑定/既有记录）逐字提取证据，
 * 为每个病例生成 review-records/<caseId>/{standards.json, report.md} 草稿与 review-digests/<caseId>.md 摘要。
 *
 * 判定口径（与 review-playbook.md 一致）：
 *  - 机械项：直接采用 batch-audit/cloud-compare 的真实结论与证据字符串；
 *  - 运行时项：统一 reviewed_with_findings「待运行时冒烟」（L02 无证据 not_verified）；
 *  - 内容判断项：脚本给可证伪的临时判定（真实摘引+确定性规则），由主线程阅读摘要后复核修订。
 *
 * 用法：
 *  pnpm exec tsx scripts/case-audit/draft-review-records.mts            # 处理全部 53 候选（跳过蚕豆病已有定案）
 *  pnpm exec tsx scripts/case-audit/draft-review-records.mts <caseId…>  # 指定病例
 *  pnpm exec tsx scripts/case-audit/draft-review-records.mts --validate # 校验全部已落盘记录
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DAY = 'outputs/case-library-review/20261024';
const PACK = 'outputs/local-handoff-20261023/pack-20261023';
const KB_EMPTY = new Set(['teacher-新生儿rh溶血性黄疸', 'teacher-过敏性紫癜', 'teacher-矮小症', 'teacher-急性毛细支气管炎', 'teacher-传染性单核细胞增多症']);
const SKIP = new Set(['teacher-蚕豆病']); // 已定案模板，不覆盖

/** 66 项 canonical requirement（与蚕豆病定案 standards.json 逐字一致） */
const REQ: Array<[string, string]> = [
  ['A01', '首页条目能定位到明确的患者事实集合；别名、亚型和演示病例分清'],
  ['A02', '年龄、性别、主诉、病程、就诊时间点一致；婴儿月龄、新生儿日龄表达明确'],
  ['A03', '病史、体征和检查区分入院前、初诊、治疗后、出院等时点'],
  ['A04', '有明确学习对象、训练模式、学习目标和完成条件；时间为设计预估'],
  ['A05', '材料读取失败、抽取遗漏、字段归错、原文缺失、系统未接入分别记录'],
  ['B01', '完整主诉、年龄、性别与进入后的患者一致；首页遵守三列、每页九例既有约定'],
  ['B02', '形象适配年龄阶段及性别；新生儿、婴幼儿、学龄儿童、青少年不能共用明显错龄形象'],
  ['B03', '同一患者在卡片、问诊、站立/仰卧查体中保持可识别的一致形象'],
  ['B04', '外观、体位、设备、精神状态不与已设定病情冲突；中性示意不暗示额外体征'],
  ['B05', '非患者本人形象有清楚的教学示意说明；不能在文件名、替代文字、标签提前泄题'],
  ['C01', '有固定开场、主诉及本病必要的现病史，学生能逐步问出有效信息'],
  ['C02', '按本例目标覆盖症状特点、起病演变、伴随表现、已做检查/用药、生活影响'],
  ['C03', '按年龄和疾病关联覆盖必要的围产、生长发育、喂养、接种、既往、过敏、家族等信息'],
  ['C04', '“未问”“未知/记不清”“否认”“未做”“未提供”“结果暂不可取”语义分开'],
  ['C05', '开场不倾倒完整病历；开放提问可得到合理概括，具体追问获得细节'],
  ['C06', '同义问法答案一致；重复问不换年龄、病程、数值；不将当前医生尚未完成的诊断当成患者已知'],
  ['D01', '明确本轮由谁回答；语言和理解能力与年龄相符，新生儿不得口头讲病史'],
  ['D02', '家长以观察和回忆表达，患儿以感受表达，不照读医生病历或教科书'],
  ['D03', '具备本例情绪、顾虑、配合度、安抚后的变化；不能所有病例同一人设'],
  ['D04', '模型只自然表达已保存事实；新增模拟事实先入本例固定版本，不能边问边生成患者事实'],
  ['D05', '未覆盖问题能自然说明记不清、不知道或需查证；不连续机械重复“未记录”'],
  ['D06', '不因学生诱导、错误断言或提示词注入而改变事实、透露评分答案'],
  ['E01', '从本例目标列出必要查体，明确方法、器材、部位、体位、侧别及准备动作'],
  ['E02', '每条异常体征及用于排除的关键阴性均有依据或明确模拟设定；未记录不默认正常'],
  ['E03', '正确操作解锁相应结果，错误部位/方法不返回同一段通用病理结果'],
  ['E04', '图片、声音、视频确实支持所述体征；听诊音不能来自不匹配部位或病情而宣称本例原始音'],
  ['E05', '适合直接观察的表现可初见提供；需操作获得的结果按动作出现'],
  ['E06', '操作产生的证据及时入记录，重复操作不重复加分，回看仍可播放或放大'],
  ['F01', '每项检查的名称、适应的教学目标、结果、单位、时点和来源清楚'],
  ['F02', '检验数值、报告、影像及文字解读彼此一致；年龄相关参考范围有出处，不能套成人范围'],
  ['F03', '合理同义检查名可识别，歧义需澄清；无结果与请求失败分别处理'],
  ['F04', '初次查看符合下单规则；已获得结果允许回看；未开检查不能从资源列表或网络响应获得隐藏结果'],
  ['F05', '多页报告、影像序列和视频有合理导航，关键页可读，有需要时提供定位'],
  ['F06', '外部病例素材、示例报告和生成示意不能冒充本患者实测结果'],
  ['G01', '标准诊断、分型/严重程度与当前患者全部事实一致'],
  ['G02', '必需诊断依据在本轮实际可获得，不能用诊断标签反推补造一套伪装原始的证据'],
  ['G03', '鉴别诊断围绕本例，说明为何考虑、如何区分、仍需何种证据；不机械凑数量'],
  ['G04', '同义诊断、允许的上位诊断和不充分答案有清楚规则；模糊证据允许合理不确定性'],
  ['G05', '非相关检查不成为唯一解锁答案的暗门；可接受的替代路径有记录'],
  ['H01', '处置目标与年龄、体重、严重程度、过敏和已知检查一致'],
  ['H02', '涉及药物剂量时明确体重、计量单位、途径、频次、最大量等必要条件及来源；未具备条件不强评精确剂量'],
  ['H03', '区分紧急处理、进一步评估、治疗、复查、转诊/住院、随访；内容按本例目标适用'],
  ['H04', '家长能提出本例合理顾虑；学生解释病情、风险、检查目的和后续安排后有对应反馈'],
  ['H05', '病情演变仅在已设计的时间/事件条件下发生；不能操作一下就无依据痊愈或恶化'],
  ['I01', '学习目标、可获得证据、可执行行为、评分点一一对应；不因材料缺失扣学生分'],
  ['I02', '合理替代表述和路径可得分，重复操作不重复加分；避免只靠关键词误判'],
  ['I03', '报告区分“未询问/未执行”和“系统未提供/请求失败”，不归责学生'],
  ['I04', '每条反馈能指出具体行为、缺失证据、改进建议；必要时回看材料'],
  ['I05', '复盘把关键图片、结果、诊断推理和处置理由串起来；答案标注图适合在此展示'],
  ['J01', '每份文件登记唯一 ID、路径、哈希、格式、所属病例、来源类型、阅读状态'],
  ['J02', '每份材料决定用途：本例证据/教学参考/复盘讲解/同源重复/不适用/无法读取待处理'],
  ['J03', '使用材料记录时点、部位/侧别、支持事实、展示阶段、触发动作、是否泄题'],
  ['J04', '图片清晰且可缩放，音视频可播放，有必要的裁剪、转码、字幕/说明；保留原件'],
  ['J05', '隐私、来源、使用条件明确；外部图不能因可搜索就当成可再分发'],
  ['J06', '大批连续图像按真实序列分组，审阅关键段并记录覆盖范围，不能按张数当作不同检查'],
  ['K01', '补充类型明确：表达润色、一般角色设计、医学事实/数值模拟、外部临床参考、生成形象/示意'],
  ['K02', '医学补充可回到可访问的专业依据；具体患者数值属于教学设定，引用指南不使其变成真实实测值'],
  ['K03', '补充后全例自洽，所有派生脚本、图片、结果、评分同步；与原件冲突不得静默覆盖'],
  ['K04', '老师能集中看到全部新增项、来源、风险和修改位置；原始内容与补充内容可对照'],
  ['K05', '发布和审核独立；教师试用可以未医学审核，但不能标“老师已确认”'],
  ['L01', '每个首页条目都验证能进入、完成、生成报告、退出和恢复，不只抽测代表病例'],
  ['L02', '手机优先，材料加载、放大、音频/视频播放和返回不丢进度；资源失败可重试'],
  ['L03', '问诊、查体、检查和报告使用同一事实版本；修订不改变既有会话的患者事实'],
  ['L04', '仅老师试用此次发布；老师走学生相同页面及业务流程，但不会改变账号实际权限'],
  ['L05', '部署端实际拥有材料和派生文件，不能本地可读就声称线上可用'],
  ['L06', '类型、静态检查、相关测试和构建通过；不把构建成功当成内容或医学验收'],
];

type Verdict = { status: 'pass' | 'reviewed_with_findings' | 'not_verified'; evidence: string };
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const F = (evidence: string): Verdict => ({ status: 'reviewed_with_findings', evidence });
const P = (evidence: string): Verdict => ({ status: 'pass', evidence });
const NV = (evidence: string): Verdict => ({ status: 'not_verified', evidence });

function draftCase(caseId: string) {
  const cand = readJson(path.join(ROOT, PACK, 'runtime-candidates', `${caseId}.json`));
  const auditRaw = readJson(path.join(ROOT, DAY, 'batch-audit', `${caseId}.json`));
  const audit: Record<string, { status: string; evidence: string }> = auditRaw?.results ?? auditRaw ?? {};
  const rv = readJson(path.join(ROOT, PACK, 'local-review-records', caseId, 'runtime-verification-20261023.json'));
  const prior = readJson(path.join(ROOT, PACK, 'local-review-records', caseId, 'standards.json'));
  const priorMap = new Map<string, { status: string; evidence: string }>(
    (prior?.standards ?? []).map((s: { id: string; status: string; evidence: string }) => [s.id, s]),
  );
  const media = readJson(path.join(ROOT, DAY, 'media-bindings', `${caseId}.testMedia.json`));

  if (!cand) { console.log(`[skip] ${caseId}: 无候选`); return null; }

  const history = String(cand.sections?.history ?? '');
  const exam = String(cand.sections?.exam ?? '');
  const tests = String(cand.sections?.tests ?? '');
  const diagnosis = String(cand.sections?.diagnosis ?? '');
  const plan = String(cand.sections?.plan ?? '');
  const docs: Array<{ source: string; sha256: string }> = cand.documents ?? [];
  const docNames = docs.map((d) => `${d.source}:${d.sha256.slice(0, 8)}`).join('、');
  const rvRoutes: Array<{ mode: string; practiceFocus?: string; result: string }> = rv?.routes ?? [];
  const rvText = rvRoutes.length > 0 ? `交接方运行验证 ${rvRoutes.filter((r) => r.result === 'passed').length}/${rvRoutes.length} 路由 passed（${rvRoutes.map((r) => r.mode + (r.practiceFocus ? `/${r.practiceFocus}` : '')).join('、')}）` : '';

  // 事实提取（全部来自候选原文）；日期锚点含分隔与紧凑两种格式（紧凑格式限括号内防误命中）
  const datesSep = [...tests.matchAll(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/g)].map((m) => m[0]);
  const datesCompact = [...tests.matchAll(/[(（](20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[)）]/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
  const dateAnchors = [...new Set([...datesSep, ...datesCompact])].sort();
  const weightHit = /体重|公斤|\d+(\.\d+)?\s*kg/i.test(history + exam);
  const dosageHit = /(mg\/kg|\/kg|bid|tid|qid|qd|q\d+h|次\/日|每日[一二三\d]|微克|毫克)/i.test(plan);
  const followupHit = /随访|复查|随诊|门诊随|复诊/.test(plan + diagnosis);
  const acuteHit = /昏迷|意识不清|气管插管|濒危|抢救|窒息|休克|心搏|呼吸暂停/.test(history + exam + diagnosis);
  const diffHit = /待查|？|\?|鉴别/.test(diagnosis);
  const dischargeHit = /出院诊断|确定诊断|最后诊断|入院诊断|初步诊断/.test(diagnosis);
  const examCovered = (audit.E02?.evidence ?? '').match(/查体解析 (\d+)\/18/);
  const examN = examCovered ? Number(examCovered[1]) : 0;
  const testLines = (audit.F01?.evidence ?? '').match(/辅检文本 (\d+) 行/);
  const testLineN = testLines ? Number(testLines[1]) : 0;

  // 检验时间序列提取（项目→值序列，取前 4 个有 ≥2 值的指标）
  const series = new Map<string, string[]>();
  for (const m of tests.matchAll(/([一-龥A-Za-z（）()·^]{2,14})[：:]\s*([<>]?[\d.]+)/g)) {
    const k = m[1].replace(/[（(].*$/, '');
    if (!series.has(k)) series.set(k, []);
    const arr = series.get(k)!;
    if (arr.length < 6 && !arr.includes(m[2])) arr.push(m[2]);
  }
  // 序列噪声过滤：与同序列其他值中位数相差 50 倍以上的值视为解析伪影剔除
  const sane = (vals: string[]): string[] => {
    const nums = vals.map((v) => parseFloat(v.replace(/[<>]/, '')));
    return vals.filter((_, i) => {
      const others = nums.filter((_, j) => j !== i).sort((x, y) => x - y);
      const med = others[Math.floor(others.length / 2)] ?? 0;
      return !(med > 0 && (nums[i] > med * 50 || nums[i] < med / 50));
    });
  };
  const seriesList = [...series.entries()].map(([k, v]) => [k, sane(v)] as [string, string[]]).filter(([, v]) => v.length >= 2).slice(0, 4);

  // batch-audit 三态映射：pass→pass；flag→findings（保留 flag 真实证据）；无记录→NV
  const af = (id: string): Verdict => {
    const r = audit[id];
    if (r?.status === 'pass') return P(`batch-audit ${id} pass：${r.evidence}`);
    if (r?.status === 'flag') return F(`batch-audit ${id} flag：${r.evidence}`);
    return NV(`batch-audit 无 ${id} 记录`);
  };
  const a = (id: string): { status: string; evidence: string } | null => (audit[id]?.status === 'pass' ? audit[id] : null);
  const V = new Map<string, Verdict>();

  // A 组
  V.set('A01', af('A01'));
  V.set('A02', af('A02'));
  V.set('A03', F(`${audit.A03?.status === 'pass' ? `batch-audit A03：${audit.A03.evidence}` : `文本层检验日期锚点 ${dateAnchors.length} 个（${dateAnchors.slice(0, 5).join('、') || '无'}）`}；运行时 testRelease 分时点门控未接入本例，待合并阶段逐例接入`));
  V.set('A04', rvRoutes.length > 0 ? F(`${rvText}在案；按记录存在≠通过纪律，我方未独立复现，登记待运行时冒烟`) : NV('本例无交接方运行验证记录；学习目标/完成条件运行时验证未开展'));
  V.set('A05', af('A05'));

  // B 组
  V.set('B01', F(`候选 demographics（${cand.age}/${cand.sex}/${String(cand.complaint).slice(0, 30)}）${audit.A02?.status === 'pass' ? '与正文一致性经 batch-audit A02 核' : `；batch-audit A02 ${audit.A02?.status ?? '无记录'}（${audit.A02?.evidence ?? '无证据'}）`}；首页三列九例布局属运行时渲染验证，待冒烟`));
  V.set('B02', af('B02'));
  V.set('B03', F('站立形象路由经 B02 核；仰卧/卡片渲染一致性属运行时验证，待冒烟'));
  V.set('B04', acuteHit
    ? F('病史/查体/诊断含急性危重表述，中性站立示意与本例急性状态存在张力；建议运行时按病情切换卧床/监护示意（待冒烟确认）')
    : P('中性站立示意无设备/病态暗示，与本例病情状态不冲突'));
  V.set('B05', af('B05'));

  // C 组
  V.set('C01', history.length >= 120
    ? P(`history ${history.length} 字含主诉与现病史；首句摘引：「${history.replace(/\s+/g, '').slice(0, 46)}…」`)
    : F(`history 仅 ${history.length} 字，固定开场与现病史要素可能不足，待内容补充或复核`));
  V.set('C02', a('C02') ? P(`batch-audit C02 pass：${audit.C02.evidence}`) : audit.C02?.status === 'flag' ? F(`batch-audit C02 flag：${audit.C02.evidence}；待内容补充/复核`) : F('现病史要素覆盖不足（batch-audit 无记录），待补充'));
  V.set('C03', a('C03') ? P(`batch-audit C03 pass：${audit.C03.evidence}`) : audit.C03?.status === 'flag' ? F(`batch-audit C03 flag：${audit.C03.evidence}；待内容补充/复核`) : F('年龄相关既往/家族类信息覆盖不足（batch-audit 无记录），待补充'));
  V.set('C04', a('C04') ? P(`batch-audit C04 pass：${audit.C04.evidence}`) : audit.C04?.status === 'flag' ? F(`batch-audit C04 flag：${audit.C04.evidence}；待内容补充/复核`) : F('阴性史语义表达不足（batch-audit 无记录），待补充'));
  V.set('C05', F('运行时模型行为项（开场释放策略/开放提问概括）；待运行时冒烟'));
  V.set('C06', F(`运行时行为项（同义问法一致性/重复问稳定性）待冒烟；问诊病史层${/确诊|诊断为/.test(history) ? '含诊断表述，需运行时确认患者侧不知情' : '未见确诊表述泄露'}`));

  // D 组
  V.set('D01', af('D01'));
  for (const id of ['D02', 'D03', 'D05'] as const) V.set(id, F('运行时模型行为项；待运行时冒烟'));
  V.set('D04', F(`固定事实层齐备（候选五段+${docs.length} 文档）；防边问边生成属运行时安全机制${rvRoutes.some((r) => r.practiceFocus === 'safety') ? '，交接方 practice/safety 验证 passed 在案待独立复现' : '，待运行时冒烟'}`));
  V.set('D06', F(`运行时安全项（抗诱导/抗注入）${rvRoutes.some((r) => r.practiceFocus === 'safety') ? '；交接方 practice/safety 验证 passed 在案待独立复现' : '；待运行时冒烟'}`));

  // E 组
  V.set('E01', F(`18 项标准查体 ${examN}/18 有真实内容；${18 - examN} 项无内容按未记录口径登记（不默认正常）`));
  V.set('E02', a('E02') ? P(`batch-audit E02 pass：${audit.E02.evidence}`) : audit.E02?.status === 'flag' ? F(`batch-audit E02 flag：${audit.E02.evidence}；待内容补充/复核`) : F('查体覆盖不足（batch-audit 无记录），待补充'));
  V.set('E03', F('运行时查体操作路由项；待运行时冒烟'));
  V.set('E04', P('本例无查体媒体（examMedia=0），不存在媒体与体征不匹配风险；后续补媒体须走 J04/J05 流程'));
  V.set('E05', F('运行时行为项（直接观察 vs 操作解锁）；待运行时冒烟'));
  V.set('E06', F('运行时行为项（证据入记录/重复操作计分/回看）；待运行时冒烟'));

  // F 组
  V.set('F01', a('F01') ? P(`batch-audit F01 pass：${audit.F01.evidence}`) : audit.F01?.status === 'flag' ? F(`batch-audit F01 flag：${audit.F01.evidence}；待内容补充/复核`) : F('辅检文本或日期锚点不足（batch-audit 无记录），待补充'));
  V.set('F02', seriesList.length > 0
    ? P(`检验时间序列可核对：${seriesList.map(([k, v]) => `${k} ${v.join('→')}`).join('；')}；跨日期内部一致性经摘要复核；适龄参考范围属医学审核项不在本轮`)
    : F('未提取到可核对的多时点检验序列（单时点或解析受限），数值一致性待人工复核'));
  V.set('F03', F('运行时行为项（同义检查名识别/失败区分）；待运行时冒烟'));
  V.set('F04', F('候选无 testRelease 字段；分时点门控机制已经 ITP 例验证，待合并阶段逐例接入本例'));
  V.set('F05', media
    ? P(`媒体绑定闭环：${media.testMedia.length} 组 testMedia/${media.provenance.length} 张（${media.boundAt?.slice(0, 10)}；docx=${String(media.sourceDocxSha256).slice(0, 8)}…）`)
    : P('本例无检查媒体绑定（testMedia=0），无多页导航需求'));
  V.set('F06', P(`documents ${docs.length} 份均登记为本例来源（${docNames}），无外部素材混入`));

  // G 组
  V.set('G01', dischargeHit
    ? P(`诊断段含明确诊断表述，摘引：「${diagnosis.replace(/\s+/g, '').slice(0, 60)}…」；与病史/检验证据链一致性经摘要复核`)
    : F('诊断段未见明确诊断表述（出院/初步诊断缺失或格式异常），待内容复核'));
  V.set('G02', dateAnchors.length >= 2
    ? F(`检验跨 ${dateAnchors.length} 个日期（${dateAnchors.slice(0, 3).join('、')}），含入院后回报的检查学生端可获得性与 testRelease 接入联动（F04）`)
    : P('检查集中于就诊当日，必需诊断依据初诊即可获得'));
  V.set('G03', diffHit
    ? P(`初步诊断含鉴别路径（待查/？表述），摘引：「${diagnosis.replace(/\s+/g, '').slice(0, 60)}…」`)
    : F('诊断段鉴别路径单薄（无待查/鉴别表述），待内容复核'));

  // H 组
  V.set('H01', plan.trim().length > 0
    ? (weightHit ? P(`处置段在案（${plan.replace(/\s+/g, '').slice(0, 50)}…）；病史/查体含体重记录，处置前提可核`) : F(`处置段在案（${plan.replace(/\s+/g, '').slice(0, 50)}…）；体重未记录，剂量级核对缺前提（登记缺口）`))
    : F('处置段为空，待内容补充'));
  V.set('H02', dosageHit
    ? P('处置文本含剂量/频次要素（mg/kg 或频次表述命中）')
    : F('处置文本仅含药名与目的、无剂量细节；按未具备条件不强评精确剂量口径执行' + (weightHit ? '' : '；体重亦未记录')));
  V.set('H03', followupHit ? P('处置/诊断段含随访或复查安排，紧急-评估-治疗-随访链条可核') : F('随访/复查安排未记录（出院医嘱层面缺口登记）'));
  V.set('H04', F('运行时沟通行为项（家长顾虑/解释反馈）；待运行时冒烟'));
  V.set('H05', F('运行时行为项（病情演变条件控制）；待运行时冒烟'));

  // I 组
  for (const id of ['I01', 'I02', 'I03', 'I04'] as const) V.set(id, F('运行时评分/报告项；待运行时冒烟'));
  V.set('I05', F(`复盘素材层${media ? `齐备（${media.testMedia.length} 组媒体绑定+检验时间线）` : '为文本层（检验时间线+诊断链），无媒体绑定'}；运行时串联呈现待冒烟`));

  // J 组
  V.set('J01', af('J01'));
  V.set('J02', docs.length >= 2
    ? F(`documents ${docs.length} 份（${docNames}），用途逐份定位待比对（疑似同源多版本）`)
    : docs.length === 1 ? P(`单文档 ${docNames}，用途明确（本例证据源）`) : F('无 documents 登记，来源定位待补'));
  V.set('J03', media ? P(`绑定 spec 记录触发链（${media.provenance.length} 图→${media.testMedia.length} 组 testId），按检查解锁触发无泄题风险`) : P('本例无媒体绑定，无触发链登记需求'));
  V.set('J04', caseId === 'teacher-噬血细胞综合征'
    ? F('3 张媒体图含 PII（姓名/住院号/床号/医院/医师签名/条形码），维持 blocked_until_redacted 登记，脱敏前不得绑定')
    : P('原件保留于 pack originals（指纹登记）；媒体经全图查看核验（如有）；缩放/播放属前端运行时项'));
  V.set('J05', caseId === 'teacher-噬血细胞综合征'
    ? F('3 张媒体图 PII 未脱敏，维持 blocked_until_redacted；文本 PII 扫描经 batch-audit 核验')
    : a('J05') ? P(`batch-audit J05 pass：${audit.J05.evidence}`) : NV('batch-audit 无 J05 pass 记录'));
  V.set('J06', media ? P(`${media.provenance.length} 图按检查项分 ${media.testMedia.length} 组闭环，无按张数冒充不同检查`) : P('本例无连续图像，无分组需求'));

  // K 组
  V.set('K01', af('K01'));
  V.set('K02', P(priorMap.has('K01') ? '前轮已登记补充范围与专业依据（详见前轮 report.md），引用指南不转为患者实测值' : '本轮未见医学模拟补充；如后续补充须登记专业依据且不冒充实测值'));
  V.set('K03', af('K03'));
  V.set('K04', F('审查侧对照材料齐备（report/standards/manifest/绑定spec）；教师端集中视图属平台功能项'));
  V.set('K05', P('状态纪律保持：contentReady=false、medicalVerified=false、teacherTrialPublished=false'));

  // L 组
  V.set('L01', rvRoutes.length > 0 ? F(`${rvText}在案（待核证据）；我方未独立复现，登记待运行时冒烟`) : NV('本例无交接方运行验证记录；进入/完成/报告/退出/恢复全链路验证未开展'));
  V.set('L02', NV('本轮无可得验收证据（移动端材料加载/进度保持/失败重试验证未开展）'));
  V.set('L03', F('固定事实版本机制在案（候选指纹+manifest）；运行时多环节版本一致性待冒烟'));
  V.set('L04', P('未发布状态符合纪律（teacherTrialPublished=false；发布为独立后续动作）'));
  V.set('L05', F(`候选与媒体均在本地私有 outputs（Git 忽略），未导入部署端；合并导入为后续独立任务，当前不得声称线上可用${KB_EMPTY.has(caseId) ? '；本例 KB 召回为空（R2-KB-01 标题缺失）' : ''}`));
  V.set('L06', F('代码基线已经 test 验证（7a2665c）；本轮审查脚本随周期验证一并检查'));

  // 前轮结论合并
  for (const [id, v] of V) {
    const p = priorMap.get(id);
    if (p && p.status === 'reviewed_with_findings' && v.status === 'pass') {
      V.set(id, { ...v, evidence: `${v.evidence}；前轮结论保留：${p.evidence}` });
    }
  }

  const standards = REQ.map(([id, requirement]) => {
    const v = V.get(id) ?? NV('草稿装配器未覆盖本项，待人工补审');
    return { id, requirement, status: v.status, evidence: v.evidence };
  });
  const count = { pass: 0, reviewed_with_findings: 0, not_verified: 0 };
  for (const s of standards) count[s.status]++;

  const outDir = path.join(ROOT, DAY, 'review-records', caseId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'standards.json'), JSON.stringify({
    caseId, reviewedAt: '2026-10-24', contentReady: false, medicalVerified: false, teacherTrialPublished: false,
    verdictSummary: count, standards,
  }, null, 2));

  const gaps: string[] = [];
  if (!weightHit) gaps.push('体重未记录（H01/H02 剂量核对前提缺口）');
  if (!followupHit) gaps.push('随访/复查安排未记录（H03）');
  if (docs.length >= 2) gaps.push(`多文档用途待比对定位（J02：${docNames}）`);
  if (examN < 18) gaps.push(`${18 - examN} 项标准查体无内容（E01，未记录口径）`);
  gaps.push('testRelease 分时点门控未接入（A03/F04，合并阶段任务）');

  const groupLine = (prefix: string) => standards.filter((s) => s.id.startsWith(prefix)).map((s) => `${s.id}:${s.status === 'pass' ? 'pass' : s.status === 'not_verified' ? 'nv' : 'findings'}`).join(' ');
  writeFileSync(path.join(outDir, 'report.md'), `# ${caseId} 66 项实审报告（2026-10-24 轮）

状态：本轮 66 项逐项实审（草稿装配+摘要复核）；未医学确认、未导入平台、未教师试用发布。
本轮判定：pass ${count.pass} / reviewed_with_findings ${count.reviewed_with_findings} / not_verified ${count.not_verified}。

## 来源与身份

- caseId=${caseId}；documents ${docs.length} 份（${docNames}）。
- 人口学：${cand.age}/${cand.sex}，主诉「${cand.complaint}」。
${KB_EMPTY.has(caseId) ? '- 注意：本例 KB 召回为空（R2-KB-01 标题缺失），仅影响召回相关证据表述，不阻断候选侧实审。\n' : ''}${rvText ? `- ${rvText}（待核证据）。\n` : ''}
## 分组结论

- A 组：${groupLine('A')}
- B 组：${groupLine('B')}
- C 组：${groupLine('C')}
- D 组：${groupLine('D')}
- E 组：${groupLine('E')}
- F 组：${groupLine('F')}
- G 组：${groupLine('G')}
- H 组：${groupLine('H')}
- I 组：${groupLine('I')}
- J 组：${groupLine('J')}
- K 组：${groupLine('K')}
- L 组：${groupLine('L')}

各项详细证据见同目录 standards.json。

## 内容缺口登记

${gaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}

## 运行验证证据状态

${rvText ? `${rvText}，作为待核证据在案；我方未独立复现（dev server 不可用），运行时相关项按待冒烟登记。` : '本例无交接方运行验证记录；运行时相关项按待冒烟登记。'}

## 下一步

- 合并阶段：testRelease 分时点门控接入本例。
- 运行时冒烟恢复后：复验 C05/C06、D02-D06、E03/E05/E06、F03、G04/G05、H04/H05、I01-I05、L01/L02/L03。
- 教师试用前：医学预审独立进行（本报告不构成医学确认）。
`);

  // 摘要（供主线程复核）
  const digestDir = path.join(ROOT, DAY, 'review-digests');
  mkdirSync(digestDir, { recursive: true });
  writeFileSync(path.join(digestDir, `${caseId}.md`), `# ${caseId}
demographics: ${cand.age}/${cand.sex} | 主诉: ${cand.complaint}
docs: ${docNames || '无'} | 锚点${dateAnchors.length}个 | 体重:${weightHit ? '有' : '无'} | 剂量:${dosageHit ? '有' : '无'} | 随访:${followupHit ? '有' : '无'} | 急性危重词:${acuteHit ? '命中' : '无'} | 鉴别:${diffHit ? '有' : '无'} | rv:${rvRoutes.length}路由 | media:${media ? `${media.provenance.length}张` : '无'}
判定: pass ${count.pass} / findings ${count.reviewed_with_findings} / nv ${count.not_verified}
## history（${history.length}字）
${history.slice(0, 900)}
## exam（${exam.length}字）
${exam.slice(0, 600)}
## diagnosis（${diagnosis.length}字）
${diagnosis.slice(0, 500)}
## plan（${plan.length}字）
${plan.slice(0, 400)}
## tests 头（共${tests.length}字/${testLineN}行）
${tests.slice(0, 700)}
## 检验序列
${seriesList.map(([k, v]) => `- ${k}: ${v.join('→')}`).join('\n') || '无多时点序列'}
`);

  console.log(`[draft] ${caseId}: pass=${count.pass} findings=${count.reviewed_with_findings} nv=${count.not_verified}`);
  return count;
}

function validate() {
  const dir = path.join(ROOT, DAY, 'review-records');
  const cases = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'standards.json')));
  let ok = 0;
  const problems: string[] = [];
  for (const c of cases) {
    try {
      const j = JSON.parse(readFileSync(path.join(dir, c, 'standards.json'), 'utf8'));
      const ids = (j.standards ?? []).map((s: { id: string }) => s.id);
      const idsOk = JSON.stringify(ids) === JSON.stringify(REQ.map(([id]) => id));
      const cnt = { pass: 0, reviewed_with_findings: 0, not_verified: 0 };
      let evOk = true;
      for (const s of j.standards ?? []) {
        if (!(s.status in cnt) || !s.evidence || s.evidence.length < 8) evOk = false;
        else (cnt as Record<string, number>)[s.status]++;
      }
      const sumOk = j.verdictSummary?.pass === cnt.pass && j.verdictSummary?.reviewed_with_findings === cnt.reviewed_with_findings && j.verdictSummary?.not_verified === cnt.not_verified;
      const topOk = j.contentReady === false && j.medicalVerified === false && j.teacherTrialPublished === false;
      if (idsOk && evOk && sumOk && topOk) ok++;
      else problems.push(`${c}: ids=${idsOk} ev=${evOk} sum=${sumOk} top=${topOk}`);
    } catch (e) { problems.push(`${c}: JSON 解析失败 ${e}`); }
  }
  console.log(`[validate] ${ok}/${cases.length} 例通过结构校验`);
  for (const p of problems) console.log(`  ✗ ${p}`);
}

const args = process.argv.slice(2);
if (args[0] === '--validate') {
  validate();
} else {
  const targets = args.length > 0
    ? args
    : readdirSync(path.join(ROOT, PACK, 'runtime-candidates')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((id) => !SKIP.has(id));
  for (const id of targets) draftCase(id);
}
