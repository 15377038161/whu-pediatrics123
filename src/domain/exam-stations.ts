/**
 * 执业医师实践技能考试三站信息架构映射（临床类别）。
 *
 * 站点划分口径：国家医师资格考试临床类别实践技能三站式考试——
 * 第一站 病史采集与病例分析（纸笔/机考）；第二站 体格检查与基本操作技能（在模拟人或真人上操作，随机抽 1–2 项）；
 * 第三站 多媒体考试（辅助检查结果判读：心肺听诊、影像、心电图、实验室）并融入医德医风与沟通能力。
 *
 * 本文件只描述「考什么 → 本平台在哪里练」，并如实标注每项的实现状态与缺口，
 * 不把未实现的能力写成已完成（status='missing'/'partial' 必须在 gap 里写清缺什么）。
 */

export type EntryStatus = 'ready' | 'partial' | 'missing';

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  ready: '已可训练',
  partial: '部分实现',
  missing: '尚未实现',
};

export type StationEntry = {
  /** 平台内入口（只允许静态路由，可带 query；测试会校验路由文件存在）。 */
  href: string;
  label: string;
  status: EntryStatus;
  /** 该入口能练到什么程度；partial/missing 时必须写清缺口。 */
  detail: string;
};

export type ExamStation = {
  id: string;
  name: string;
  officialScope: string;
  officialMethod: string;
  entries: StationEntry[];
  gap: string;
};

export const EXAM_STATIONS: ExamStation[] = [
  {
    id: 'station-1',
    name: '第一站 · 病史采集与病例分析',
    officialScope: '围绕主诉询问现病史（诱因、起病与病情演变、主要症状特点、伴随症状、全身状态）与诊疗经过，并询问相关病史（既往史、个人史、家族史、药物过敏史与手术史）；病例分析要求写出初步诊断、诊断依据、鉴别诊断、进一步检查与治疗原则。',
    officialMethod: '纸笔或计算机作答，两题合计约 35 分，限时 22 分钟左右，由考官按评分点批阅。',
    entries: [
      { href: '/student', label: '接诊训练（问诊主流程）', status: 'ready', detail: '按病例与 SP 角色多轮问诊，问答原文全程留痕，可在报告中回溯。' },
      { href: '/student/practice?focus=history', label: '临床能力专项 · 病史采集', status: 'partial', detail: '现为自由追问 + 病史小结，按病史要点给反馈；考试要求的「书面问诊提纲 + 对标答逐项给分」尚未实现。' },
      { href: '/student/reports', label: '训练报告（诊断与依据）', status: 'partial', detail: '已含诊断依据与鉴别诊断；第一/第二/第三诊断分列与处理原则的结构化标答尚未接入。' },
    ],
    gap: '病史采集的结构化提纲表单与对标答评分、病例分析的多诊断分列与处理原则标答仍在建设中；目前只能用自由问诊训练问诊逻辑。',
  },
  {
    id: 'station-2',
    name: '第二站 · 体格检查与基本操作',
    officialScope: '系统性体格检查（全身查体顺序与手法、各系统重点检查：心肺听诊、腹部触诊、神经系统检查等）；基本操作随机抽 1–2 项，常见为心肺复苏、无菌操作与穿手术衣戴手套、消毒铺巾、换药、导尿、胃管插入、胸腔/腹腔/腰椎穿刺、缝合与拆线。',
    officialMethod: '在标准体检者、模拟人或穿刺模型上动手演示，考官按操作步骤逐项评分，同时观察是否向「患者」说明与人文关怀。',
    entries: [
      { href: '/student/practice?focus=exam', label: '临床能力专项 · 体格检查', status: 'ready', detail: '选择体位、视触叩听与器材，自主定位并按顺序操作；反馈准备、顺序与证据关联，观察原文供教师复核。' },
      { href: '/student/procedures', label: '技能操作要点（无菌准备 · 四大穿刺 · 婴儿心肺复苏）', status: 'ready', detail: '8 项操作正文：适应证、禁忌症、穿刺点与关键数值、分步操作、并发症、儿科差异，逐条标注教材与指南出处。' },
      { href: '/student/skills', label: '核心技能学习目录', status: 'partial', detail: '8 项儿科 OSCE 技能目录与完成标记可用；技能视频资源尚未全部上架绑定。' },
      { href: '/student/resources', label: '教学视频（操作演示）', status: 'partial', detail: '资源中心与断点续播已就绪，待把 Coze 对象存储中的操作视频登记为已发布资源。' },
      { href: '/student/osce', label: 'OSCE 模拟考站', status: 'ready', detail: '按考站流程串起问诊、查体与处置，给出参考评分与复盘。' },
    ],
    gap: '体格检查的实拍体征图与操作视频素材不足（当前以文字结果与教学示意为主）；技能操作以正文与评分为主，尚无分步操作的动作捕捉式判分。',
  },
  {
    id: 'station-3',
    name: '第三站 · 辅助检查判读与医德医风沟通',
    officialScope: '多媒体机考：辅助检查结果判读（心肺听诊音、X 线与 CT 等影像、心电图、实验室检验结果）；同时将医德医风与医患沟通能力融入考查。',
    officialMethod: '计算机呈现音视频与图像素材，考生判读作答，系统或考官按要点给分。',
    entries: [
      { href: '/student/practice?focus=communication', label: '临床能力专项 · 沟通能力', status: 'ready', detail: '围绕患儿情境与家长模拟沟通，解释风险、回应顾虑并确认理解；保留沟通原文与目标覆盖情况供教师复核。' },
      { href: '/student/quiz', label: '知识点回顾（辅助检查与安全题库）', status: 'partial', detail: '43 题安全题库覆盖辅助检查与处置知识；尚无按考试形式的心电图、影像判读题组。' },
      { href: '/student/resources', label: '教学视频（听诊音与影像讲解）', status: 'partial', detail: '查体真实音效（啰音、哮鸣音）已在训练内可用；独立的听诊音与影像判读素材库尚未建立。' },
    ],
    gap: '辅助检查判读题库（心电图、影像、听诊音判读）与医德医风情景题尚未实现；平台内的辅助检查环节只做「申请/不申请」并从绑定原始资料逐项摘录结果，资料未提供时如实提示「本病例资料未提供该项结果」，不编造数据。',
  },
];

/** 科室加练：不属于执医三站固定条目，但儿科教学与老师明确要求掌握的计算与评估能力。 */
export const PEDIATRIC_EXTRAS: { name: string; note: string; entries: StationEntry[] } = {
  name: '儿科科室加练（非执医三站固定条目）',
  note: '以下能力在临床类别执医技能考试中不作为独立考项，但儿科诊疗与本科教学必须掌握，平台以确定性计算工具提供训练。',
  entries: [
    { href: '/student/growth', label: '生长发育评估（双向）', status: 'ready', detail: '按月龄推算体重、身高、头围、胸围、乳牙与前囟的教材典型值并展示公式手算；也可按实测值反推月龄区间，超出教材范围直接拒绝。' },
    { href: '/student/dosing', label: '用药剂量计算', status: 'ready', detail: '9 种教学药品按实测体重与月龄给出单次与每日剂量、封顶核对与体积换算，未收录药品一律拒绝。' },
    { href: '/student/practice?focus=safety', label: '临床能力专项 · 安全处置', status: 'ready', detail: '按已提供的病史与初筛体征判断危险信号与处置优先级，反馈判断依据。' },
    { href: '/student/classes', label: '积分与排行榜', status: 'ready', detail: '训练积分累计与班级排行，用于激励重复训练。' },
  ],
};

/** 平台尚未覆盖、需要如实告知老师的考项（不写入口，避免假装能练）。 */
export const KNOWN_GAPS: string[] = [
  '病史采集的结构化书面提纲与对标答逐项评分（第一站）',
  '病例分析的第一/第二/第三诊断分列与处理原则结构化标答（第一站）',
  '心电图、影像与听诊音的判读题库（第三站）',
  '医德医风情景题与评分（第三站）',
  '体格检查实拍体征图与技能操作演示视频素材（第二站）',
];
