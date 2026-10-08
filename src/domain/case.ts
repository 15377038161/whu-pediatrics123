import type { Emotion, Stage, VitalSigns } from '@/domain/agent';
import { getPublicCase } from '@/domain/case-catalog';
import { readTeacherCaseData, type TeacherCaseData } from '@/lib/teacher-case-data';

export interface HistoryIntent {
  id: string;
  label: string;
  keywords: string[];
  childAnswer: string;
  parentAnswer: string;
  preferredActor: 'child' | 'parent' | 'mixed';
  score: number;
  evidenceCode: string;
}

export interface ExamRule {
  id: string;
  toolId: string;
  bodyPartId: string;
  label: string;
  result: string;
  evidenceCode: string;
  requires: string[];
  risk: 'normal' | 'attention' | 'critical';
}

export interface AuxiliaryTest {
  id: string;
  label: string;
  indication: string;
  result: string;
  evidenceCode: string;
  appropriate: boolean | null;
}

export interface FlagshipCase {
  id: string;
  version: number;
  title: string;
  subtitle: string;
  age: string;
  sex: string;
  triage: string;
  difficulty: string;
  expectedMinutes: number;
  patientName: string;
  patientImage: string;
  patientAlt: string;
  contentStatus: 'flagship-fixture' | 'demo-pending-review' | 'teacher-materials-indexed' | 'teacher-catalog-only' | 'teacher-folder-only';
  openingParent: string;
  initialEmotion: Emotion;
  initialVitals: VitalSigns;
  stages: Array<{ id: Stage; label: string; shortLabel: string }>;
  history: HistoryIntent[];
  exams: ExamRule[];
  tests: AuxiliaryTest[];
  sourceFacts?: TeacherCaseData | null;
}

export const FLAGSHIP_CASE: FlagshipCase = {
  ...getPublicCase('peds-respiratory-001'),
  triage: '患儿由母亲抱入诊室，精神欠佳，呼吸较快。',
  openingParent: '医生您好，孩子前天开始发热咳嗽，今天呼吸看起来有些快。我担心他越来越严重。',
  initialEmotion: 'nervous',
  initialVitals: { temperature: 39.2, heartRate: 132, respiratoryRate: 42, spo2: 94 },
  stages: [
    { id: 'triage', label: '接诊与分诊', shortLabel: '接诊' },
    { id: 'history', label: '学生自主问诊', shortLabel: '问诊' },
    { id: 'exam', label: '可视化体格检查', shortLabel: '查体' },
    { id: 'tests', label: '辅助检查选择', shortLabel: '检查' },
    { id: 'assessment', label: '病情摘要与诊断', shortLabel: '诊断' },
    { id: 'plan', label: '治疗及处置计划', shortLabel: '处置' },
    { id: 'communication', label: '患儿与家长沟通', shortLabel: '沟通' },
    { id: 'report', label: '训练报告与补练', shortLabel: '报告' },
  ],
  history: [
    {
      id: 'onset', label: '起病与病程', keywords: ['什么时候', '多久', '几天', '开始', '病程'],
      childAnswer: '前天开始不舒服，昨天咳得更多了。',
      parentAnswer: '前天晚上开始发热和咳嗽，今天呼吸明显比平时快。',
      preferredActor: 'mixed', score: 4, evidenceCode: 'HX_ONSET',
    },
    {
      id: 'fever', label: '发热特点', keywords: ['体温', '发热', '发烧', '最高', '退烧'],
      childAnswer: '我觉得很热，吃药以后好一点。',
      parentAnswer: '最高39.4℃，退热后会短暂下降，几个小时后又升高。',
      preferredActor: 'parent', score: 4, evidenceCode: 'HX_FEVER',
    },
    {
      id: 'cough', label: '咳嗽与呼吸道症状', keywords: ['咳嗽', '咳', '咳痰', '痰', '干咳', '夜里咳'],
      childAnswer: '一直咳，晚上睡觉也会咳醒，没有咳出东西。',
      parentAnswer: '以阵发性干咳为主，夜间更明显，没有咯血或明显脓痰。',
      preferredActor: 'mixed', score: 3, evidenceCode: 'HX_COUGH',
    },
    {
      id: 'treatment', label: '院前用药与效果', keywords: ['吃药', '吃过', '什么药', '用药', '药物', '治疗', '退热药', '抗生素'],
      childAnswer: '妈妈给我喝过退烧药，后来没那么热了。',
      parentAnswer: '在家按说明用过一次退热药，体温短暂下降；未自行使用抗生素。',
      preferredActor: 'parent', score: 2, evidenceCode: 'HX_TREATMENT',
    },
    {
      id: 'danger', label: '呼吸危险信号', keywords: ['喘', '憋', '呼吸困难', '青紫', '嘴唇', '胸口', '气促'],
      childAnswer: '跑一下就喘，胸口有点难受。',
      parentAnswer: '今天安静坐着也呼吸快，睡觉时胸口起伏明显，没有抽搐。',
      preferredActor: 'mixed', score: 8, evidenceCode: 'HX_DANGER',
    },
    {
      id: 'general', label: '一般状态', keywords: ['精神', '吃饭', '饮食', '尿', '喝水', '睡眠', '大便'],
      childAnswer: '不太想吃饭，只想躺着。',
      parentAnswer: '精神和食欲都比平时差，能喝少量水，今天小便两次。',
      preferredActor: 'mixed', score: 4, evidenceCode: 'HX_GENERAL',
    },
    {
      id: 'exposure', label: '接触史', keywords: ['接触', '同学', '幼儿园', '传染', '流行'],
      childAnswer: '班里好像有人咳嗽。',
      parentAnswer: '幼儿园本周有几名孩子因发热咳嗽请假，家里没有类似患者。',
      preferredActor: 'parent', score: 3, evidenceCode: 'HX_EXPOSURE',
    },
    {
      id: 'vaccination', label: '预防接种史', keywords: ['接种', '疫苗', '预防针'],
      childAnswer: '打针我会哭。',
      parentAnswer: '按儿童免疫规划完成了现阶段接种，没有漏种记录。',
      preferredActor: 'parent', score: 3, evidenceCode: 'HX_VACCINATION',
    },
    {
      id: 'birth', label: '出生与发育史', keywords: ['出生', '早产', '喂养', '发育', '生长'],
      childAnswer: '我不知道，妈妈知道。',
      parentAnswer: '足月顺产，出生体重3.2公斤，生长发育与同龄儿童相近。',
      preferredActor: 'parent', score: 2, evidenceCode: 'HX_BIRTH',
    },
    {
      id: 'allergy', label: '过敏及既往史', keywords: ['过敏', '以前', '既往', '住院', '哮喘', '药物'],
      childAnswer: '以前感冒过，没有住过院。',
      parentAnswer: '无明确药物和食物过敏史，无反复喘息或慢性心肺疾病。',
      preferredActor: 'parent', score: 3, evidenceCode: 'HX_ALLERGY',
    },
  ],
  exams: [
    { id: 'prep-hygiene', toolId: 'hand-hygiene', bodyPartId: 'hands', label: '手卫生', result: '已完成手卫生并向患儿及家长说明检查目的。', evidenceCode: 'EX_PREP', requires: [], risk: 'normal' },
    { id: 'temperature', toolId: 'thermometer', bodyPartId: 'forehead', label: '体温测量', result: '体温39.2℃。', evidenceCode: 'EX_TEMP', requires: ['EX_PREP'], risk: 'attention' },
    { id: 'mouth', toolId: 'tongue-depressor', bodyPartId: 'mouth', label: '口咽检查', result: '咽部轻度充血，未见明显疱疹或脓性分泌物。患儿在解释后能够配合张口、伸舌。', evidenceCode: 'EX_MOUTH', requires: ['EX_PREP'], risk: 'normal' },
    { id: 'respiratory', toolId: 'stethoscope', bodyPartId: 'chest', label: '肺部听诊', result: '双侧呼吸音粗，右下肺可闻及细湿啰音；呼气相无明显延长。', evidenceCode: 'EX_RESP', requires: ['EX_PREP'], risk: 'critical' },
    { id: 'oxygen', toolId: 'oximeter', bodyPartId: 'finger', label: '血氧监测', result: '静息状态SpO₂ 92%，脉搏132次/分。', evidenceCode: 'EX_SPO2', requires: ['EX_PREP'], risk: 'critical' },
    { id: 'blood-pressure', toolId: 'bp-cuff', bodyPartId: 'upper-arm', label: '血压测量', result: '选择儿童袖带后测得血压92/58 mmHg。', evidenceCode: 'EX_BP', requires: ['EX_PREP'], risk: 'normal' },
  ],
  tests: [
    { id: 'cbc-crp', label: '血常规与CRP', indication: '评估感染与炎症程度', result: '白细胞12.6×10⁹/L，中性粒细胞比例升高，CRP 32 mg/L。', evidenceCode: 'TEST_CBC', appropriate: true },
    { id: 'chest-image', label: '胸部影像', indication: '低氧且存在局灶肺部体征', result: '右下肺可见斑片状浸润影，未见明显胸腔积液。', evidenceCode: 'TEST_IMAGE', appropriate: true },
    { id: 'pathogen', label: '呼吸道病原学', indication: '结合流行病学和病程选择', result: '呼吸道病毒抗原筛查阴性；其他病原结果需结合病程解释。', evidenceCode: 'TEST_PATHOGEN', appropriate: true },
    { id: 'brain-mri', label: '头颅MRI', indication: '当前无神经系统指征', result: '当前病史和查体不支持常规选择该检查。', evidenceCode: 'TEST_LOW_VALUE', appropriate: false },
  ],
};

export const FEMALE_WHEEZE_CASE: FlagshipCase = {
  ...getPublicCase('peds-wheeze-002'),
  triage: '患儿由父亲陪同进入诊室，可自行步行，咳嗽间歇可闻喘鸣，呼吸稍快。',
  openingParent: '医生您好，孩子昨晚开始发热咳嗽，今天能听见呼吸有些呼呼响，她说胸口不太舒服。',
  initialEmotion: 'nervous',
  initialVitals: { temperature: 38.1, heartRate: 124, respiratoryRate: 36, spo2: 95 },
  stages: FLAGSHIP_CASE.stages,
  history: [
    { id: 'onset', label: '起病与病程', keywords: ['什么时候', '多久', '几天', '开始', '病程'], childAnswer: '昨天晚上开始咳嗽，今天呼吸会响。', parentAnswer: '昨晚开始低热和阵发性咳嗽，今天活动后喘息更明显。', preferredActor: 'mixed', score: 4, evidenceCode: 'HX_ONSET' },
    { id: 'fever', label: '发热特点', keywords: ['体温', '发热', '发烧', '最高', '退烧'], childAnswer: '我觉得有一点热。', parentAnswer: '最高38.3℃，没有寒战，退热后精神会好一些。', preferredActor: 'parent', score: 4, evidenceCode: 'HX_FEVER' },
    { id: 'cough', label: '咳嗽与喘息特点', keywords: ['咳嗽', '咳', '咳痰', '痰', '干咳', '夜里咳'], childAnswer: '会一阵一阵地咳，跑起来还会呼呼响。', parentAnswer: '主要是阵发性干咳，夜间和活动后明显，没有咯血或脓痰。', preferredActor: 'mixed', score: 3, evidenceCode: 'HX_COUGH' },
    { id: 'treatment', label: '院前用药与效果', keywords: ['吃药', '吃过', '什么药', '用药', '药物', '治疗', '退热药', '雾化'], childAnswer: '还没有做雾化，喝过一点退烧药。', parentAnswer: '只按说明使用过退热药，未自行雾化或使用抗生素。', preferredActor: 'parent', score: 2, evidenceCode: 'HX_TREATMENT' },
    { id: 'danger', label: '呼吸危险信号', keywords: ['喘', '憋', '呼吸困难', '青紫', '嘴唇', '胸口', '气促'], childAnswer: '跑起来会喘，胸口有点紧。', parentAnswer: '安静时也能听见喘息，但没有口唇青紫、意识异常或抽搐。', preferredActor: 'mixed', score: 8, evidenceCode: 'HX_DANGER' },
    { id: 'general', label: '一般状态', keywords: ['精神', '吃饭', '饮食', '尿', '喝水', '睡眠', '大便'], childAnswer: '能喝水，不太想吃饭。', parentAnswer: '精神稍差，饮水和小便基本正常，夜里因咳嗽睡得不好。', preferredActor: 'mixed', score: 4, evidenceCode: 'HX_GENERAL' },
    { id: 'exposure', label: '诱因与接触史', keywords: ['接触', '同学', '幼儿园', '传染', '流行', '诱因', '运动', '冷空气'], childAnswer: '这两天幼儿园有人感冒。', parentAnswer: '班里有同学感冒，降温后咳嗽加重，未接触烟雾和新宠物。', preferredActor: 'parent', score: 3, evidenceCode: 'HX_EXPOSURE' },
    { id: 'vaccination', label: '预防接种史', keywords: ['接种', '疫苗', '预防针'], childAnswer: '我打过预防针。', parentAnswer: '按儿童免疫规划完成现阶段接种。', preferredActor: 'parent', score: 3, evidenceCode: 'HX_VACCINATION' },
    { id: 'birth', label: '出生与发育史', keywords: ['出生', '早产', '喂养', '发育', '生长'], childAnswer: '我不知道，爸爸知道。', parentAnswer: '足月出生，生长发育与同龄儿童相近。', preferredActor: 'parent', score: 2, evidenceCode: 'HX_BIRTH' },
    { id: 'allergy', label: '过敏及既往喘息史', keywords: ['过敏', '以前', '既往', '住院', '哮喘', '药物', '喘息'], childAnswer: '以前感冒也有一次呼吸响。', parentAnswer: '两岁后有两次感冒后喘息，未住院；有过敏性鼻炎，无明确药物过敏。', preferredActor: 'parent', score: 3, evidenceCode: 'HX_ALLERGY' },
  ],
  exams: [
    { id: 'prep-hygiene', toolId: 'hand-hygiene', bodyPartId: 'hands', label: '手卫生', result: '已完成手卫生并向患儿及家长说明检查目的。', evidenceCode: 'EX_PREP', requires: [], risk: 'normal' },
    { id: 'temperature', toolId: 'thermometer', bodyPartId: 'forehead', label: '体温测量', result: '体温38.1℃。', evidenceCode: 'EX_TEMP', requires: ['EX_PREP'], risk: 'attention' },
    { id: 'mouth', toolId: 'tongue-depressor', bodyPartId: 'mouth', label: '口咽检查', result: '咽部轻度充血，无脓性分泌物；解释后患儿能配合张口。', evidenceCode: 'EX_MOUTH', requires: ['EX_PREP'], risk: 'normal' },
    { id: 'respiratory', toolId: 'stethoscope', bodyPartId: 'chest', label: '肺部听诊', result: '双肺可闻及弥漫性哮鸣音，呼气相延长，未闻及固定局灶湿啰音。', evidenceCode: 'EX_RESP', requires: ['EX_PREP'], risk: 'critical' },
    { id: 'oxygen', toolId: 'oximeter', bodyPartId: 'finger', label: '血氧监测', result: '静息状态SpO₂ 93%，脉搏124次/分。', evidenceCode: 'EX_SPO2', requires: ['EX_PREP'], risk: 'critical' },
    { id: 'blood-pressure', toolId: 'bp-cuff', bodyPartId: 'upper-arm', label: '血压测量', result: '选择儿童袖带后测得血压98/62 mmHg。', evidenceCode: 'EX_BP', requires: ['EX_PREP'], risk: 'normal' },
  ],
  tests: [
    { id: 'cbc-crp', label: '血常规与CRP', indication: '评估感染与炎症程度', result: '白细胞9.8×10⁹/L，CRP 8 mg/L，未见明显细菌感染证据。', evidenceCode: 'TEST_CBC', appropriate: true },
    { id: 'chest-image', label: '胸部影像', indication: '低氧或首次明显喘息时评估', result: '双肺纹理稍增多，未见固定局灶实变或胸腔积液。', evidenceCode: 'TEST_IMAGE', appropriate: true },
    { id: 'pathogen', label: '呼吸道病原学', indication: '结合流行病学和病程选择', result: '呼吸道病毒筛查提示鼻病毒阳性，需结合临床判断。', evidenceCode: 'TEST_PATHOGEN', appropriate: true },
    { id: 'brain-mri', label: '头颅MRI', indication: '当前无神经系统指征', result: '当前病史和查体不支持常规选择该检查。', evidenceCode: 'TEST_LOW_VALUE', appropriate: false },
  ],
};

export const PEDIATRIC_CASES: FlagshipCase[] = [FLAGSHIP_CASE, FEMALE_WHEEZE_CASE];

export function getCase(caseId: string): FlagshipCase {
  const pediatricCase = PEDIATRIC_CASES.find((item) => item.id === caseId);
  if (pediatricCase) return pediatricCase;
  if (caseId.startsWith('teacher-')) {
    return createSourceCase(caseId);
  }
  throw new Error('CASE_NOT_FOUND');
}

function createSourceCase(caseId: string): FlagshipCase {
  const profile = getPublicCase(caseId);
  const source = readTeacherCaseData(caseId);
  const unknown = { temperature: null, heartRate: null, respiratoryRate: null, spo2: null };
  const examText = source?.sections.exam ?? '';
  const snippets = (pattern: RegExp) => examText.split(/[，,；;。\n]/).filter((part) => pattern.test(part)).join('，');
  const definitions = [
    ['thermometer', 'forehead', '体温测量', snippets(/体温|\bT\s*[:：]?\s*\d/i)],
    ['oximeter', 'finger', '血氧监测', snippets(/spo[₂2]|血氧|氧饱和度/i)],
    ['bp-cuff', 'upper-arm', '血压测量', snippets(/\bBP|血压/i)],
    ['stethoscope', 'chest', '心肺听诊', snippets(/肺|呼吸音|啰音|罗音|心音|心律|杂音/)],
    ['tongue-depressor', 'mouth', '口咽检查', snippets(/口|咽|扁桃体|舌/)],
    ['flashlight', 'forehead', '头面部与眼部检查', snippets(/前囟|瞳孔|眼|耳|鼻|面|头/)],
    ['inspection', 'skin', '皮肤与一般状态', snippets(/皮肤|黄染|皮疹|水肿|精神|神清|面色|青紫|反应/)],
    ['palpation', 'abdomen', '腹部检查', snippets(/腹|肝|脾|肠鸣音|肾区|压痛|反跳痛|移动浊音/)],
    ['reflex-hammer', 'limbs', '四肢与神经系统', snippets(/四肢|神经|肌张力|反射|颈|克氏|布氏|巴氏|双下肢/)],
  ];
  const exams: ExamRule[] = [{ id: 'prep-hygiene', toolId: 'hand-hygiene', bodyPartId: 'hands', label: '手卫生与检查说明', result: '已完成手卫生，并向患儿及家长说明检查。', evidenceCode: 'EX_PREP', requires: [], risk: 'normal' }];
  definitions.forEach(([toolId, bodyPartId, label, result]) => {
    if (result) exams.push({ id: `source-exam-${toolId}`, toolId, bodyPartId, label, result: `病例记录：${result}。`, evidenceCode: `SOURCE_EX_${toolId}_${bodyPartId}`, requires: ['EX_PREP'], risk: 'normal' });
  });
  if (examText && exams.length === 1) exams.push({ id: 'source-exam', toolId: 'inspection', bodyPartId: 'skin', label: '查看原始查体记录', result: examText, evidenceCode: 'SOURCE_EX_ALL', requires: ['EX_PREP'], risk: 'normal' });
  const testLines = source?.sections.tests.split('\n').filter((line) => line.trim() && !/^(?:辅助检查|辅检|入院后辅检)[：:]?$/.test(line.trim())) ?? [];
  const tests = testLines.map((line, index): AuxiliaryTest => ({ id: `source-test-${index}`, label: line.split(/[:：]/)[0].slice(0, 60) || `检查记录 ${index + 1}`, indication: '选择后查看本病例提供的检查结果', result: line, evidenceCode: `SOURCE_TEST_${index}`, appropriate: null }));
  return {
    ...profile, version: 2, age: source?.age ?? '年龄未记录', sex: source?.sex ?? '性别未记录', patientName: '小朋友',
    triage: source ? `${source.age}患儿就诊。${source.complaint}。` : '请先采集主诉、现病史和一般状态。本病种尚未加载独立病例正文，可记录自己的问诊与诊疗思路。',
    openingParent: source ? `医生，孩子这次主要是${source.complaint.replace(/^[：:\s]+/, '')}，请您看看。` : '医生，具体病史还需要补充，请先告诉我您想了解什么。',
    initialEmotion: 'nervous', initialVitals: source?.vitals ?? unknown, stages: FLAGSHIP_CASE.stages,
    history: [], exams, tests, sourceFacts: source,
  };
}

export function identifyHistoryIntent(caseId: string, question: string): HistoryIntent | null {
  return identifyHistoryIntents(caseId, question)[0] ?? null;
}

export function identifyHistoryIntents(caseId: string, question: string): HistoryIntent[] {
  const normalized = question.replace(/\s+/g, '');
  return getCase(caseId).history.filter((item) => item.keywords.some((keyword) => normalized.includes(keyword)));
}

export function findExamRule(caseId: string, toolId: string, bodyPartId: string): ExamRule | null {
  return getCase(caseId).exams.find((item) => item.toolId === toolId && item.bodyPartId === bodyPartId) ?? null;
}

export function findTest(caseId: string, testId: string): AuxiliaryTest | null {
  return getCase(caseId).tests.find((item) => item.id === testId) ?? null;
}
