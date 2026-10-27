import { verifiedComplaint } from '@/lib/admission-complaint';
import { patientAppearance } from '@/domain/patient-appearance';
import { sourceExamDefinitions } from '@/domain/exam-methods';
import type { CaseMedia, Emotion, Stage, VitalSigns } from '@/domain/agent';
import { getPublicCase, resolveCaseId } from '@/lib/case-identity';
import { getSessionTestsCatalog } from '@/lib/case-snapshot';
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
  /** 分时点事实释放：该病史事实可告知学生的最早阶段；缺省不限制（任何阶段可问出，向后兼容）。 */
  availableFromStage?: Stage;
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
  /** 分时点事实释放：该查体项目可执行的最早阶段；缺省不限制（查体阶段即可执行，向后兼容）。 */
  availableFromStage?: Stage;
  /** 查体结果释放时随事件挂载的病例媒体（如体征照片）；缺省无媒体。 */
  media?: CaseMedia[];
}

export interface AuxiliaryTest {
  id: string;
  label: string;
  indication: string;
  result: string;
  evidenceCode: string;
  appropriate: boolean | null;
  /** 分时点事实释放：该检查可回报结果的最早阶段（如外送检查到后续阶段才回报）；缺省不限制（开单即回报，向后兼容）。 */
  availableFromStage?: Stage;
  /** 延迟回报说明（如「标本外送，24 小时后回报」）；仅在未到回报时点时向学生展示，不替代真实结果。 */
  resultDelayNote?: string;
  /** 检查结果释放时随事件挂载的病例媒体（如该检查的报告图片）；缺省无媒体。 */
  media?: CaseMedia[];
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
  contentStatus: 'flagship-fixture' | 'demo-pending-review' | 'teacher-materials-indexed' | 'teacher-catalog-only' | 'teacher-folder-only' | 'teaching-simulation';
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

/** version 提供时（会话已绑定快照版本）：teacher 病例仅使用该版本的教学事实，
 *  版本缺失/不一致时返回"资料不足"形态（sourceFacts 为 null），不回退漂移数据。
 *  sessionId 提供时（学生会话）：教学事实读取按会话作用域缓存键（sourceId@version#sessionId）
 *  优先命中本人会话的投影事实，避免读到其他会话/教师直读的完整事实（跨会话泄露）。 */
export function getCase(caseId: string, version?: string | null, sessionId?: string | null): FlagshipCase {
  caseId = resolveCaseId(caseId);
  const pediatricCase = PEDIATRIC_CASES.find((item) => item.id === caseId);
  if (pediatricCase) return pediatricCase;
  if (caseId.startsWith('teacher-')) {
    return createSourceCase(caseId, version, sessionId);
  }
  throw new Error('CASE_NOT_FOUND');
}

/** 可信检查项目名白名单（通用医学检查名，非患者数据）。
 *  与迁移 20261011160000（case_snapshot_list_tests / case_snapshot_get_test）中的 SQL 白名单
 *  保持完全同步——冒号前缀不保证无答案（「降钙素原 0.58 ng/mL：明显升高」会把数值带入目录），
 *  目录/结果 label 一律白名单最长前缀匹配，未匹配行用「检查记录 N」。 */
export const TRUSTED_TEST_NAMES: readonly string[] = [
  '血常规', '血常规五分类', 'C反应蛋白', '超敏C反应蛋白', 'CRP', '降钙素原', 'PCT', '血沉', '红细胞沉降率',
  '血生化', '肝功能', '肾功能', '电解质', '血糖', '血气分析', '血气', '心肌酶', '心肌酶谱', '肌钙蛋白', '脑钠肽', 'BNP',
  '铁蛋白', '维生素D', '微量元素', '甲状腺功能', '甲功', '皮质醇', '生长激素', '胰岛素样生长因子', '胰岛素',
  '免疫球蛋白', 'IgE', 'IgG', 'IgA', 'IgM', '补体', '淋巴细胞亚群', 'T细胞亚群', '自身抗体', '抗核抗体', '类风湿因子',
  '抗链球菌溶血素O', '结核菌素试验', 'PPD试验', 'T-SPOT', '痰培养', '血培养', '咽拭子培养', '尿常规', '便常规',
  '大便常规', '大便隐血', '脑脊液', '骨髓', '骨髓细胞学', '胸片', '胸部正位片', '胸部X线', 'X线片', '胸部CT', '头颅CT',
  'CT', '核磁共振', 'MRI', '头颅MRI', 'B超', '超声', '腹部超声', '泌尿系超声', '心脏彩超', '超声心动图', '心电图',
  'ECG', '脑电图', 'EEG', '动态心电图', '肺功能', '支气管镜', '胃镜', '肠镜', '过敏原', '食物过敏原', '吸入过敏原',
  '遗传代谢筛查', '基因检测', '染色体', '血氨', '乳酸', '血乳酸', '凝血功能', '凝血四项', 'D二聚体', '同型半胱氨酸',
];

/** 检查目录 label：剥离行首序号后取白名单内最长前缀；未匹配返回「检查记录 N」。
 *  规则与迁移 20261011160000 的 SQL 实现完全一致（数值/阳性结论前缀不进入目录）。 */
export function trustedTestLabel(line: string, index: number): string {
  const normalized = line.trim().replace(/^[一二三四五六七八九十\d]+[、.．]\s*/, '');
  let matched = '';
  for (const name of TRUSTED_TEST_NAMES) {
    if (normalized.startsWith(name) && name.length > matched.length) matched = name;
  }
  return matched || `检查记录 ${index + 1}`;
}

function createSourceCase(caseId: string, version?: string | null, sessionId?: string | null): FlagshipCase {
  const profile = getPublicCase(caseId);
  const source = readTeacherCaseData(caseId, version, sessionId);
  const unknown = { temperature: null, heartRate: null, respiratoryRate: null, spo2: null };
  const examText = source?.sections.exam ?? '';
  const definitions = sourceExamDefinitions(examText);
  const exams: ExamRule[] = [{ id: 'prep-hygiene', toolId: 'hand-hygiene', bodyPartId: 'hands', label: '手卫生与检查说明', result: '已完成手卫生，并向患儿及家长说明检查。', evidenceCode: 'EX_PREP', requires: [], risk: 'normal' }];
  // 查体媒体绑定（可选，按 examId 应用）：查体结果释放时随事件挂载（如体征照片），缺省无媒体。
  const mediaByExamId = new Map((source?.examMedia ?? []).map((item) => [item.examId, item.media]));
  definitions.forEach(([toolId, bodyPartId, label, result]) => {
    if (!result) return;
    const id = `source-exam-${toolId}-${bodyPartId}`;
    const media = mediaByExamId.get(id);
    exams.push({ id, toolId, bodyPartId, label, result: `病例记录：${result}。`, evidenceCode: `SOURCE_EX_${toolId}_${bodyPartId}`, requires: ['EX_PREP'], risk: 'normal', ...(media && media.length > 0 ? { media } : {}) });
  });
  const testLines = source?.sections.tests.split('\n').filter((line) => line.trim() && !/^(?:辅助检查|辅检|入院后辅检)[：:]?$/.test(line.trim())) ?? [];
  // 目录/结果分离：label 走白名单最长前缀匹配（trustedTestLabel，与 SQL 迁移 20261011160000 同规则）——
  // 冒号前缀不保证无答案（「降钙素原 0.58 ng/mL：明显升高」会把数值带入目录），
  // 未匹配行用「检查记录 N」，目录不透出检查数值与阳性结论（不以目录泄露答案）。
  // 分时点事实释放元数据（可选，按 testId 应用）：外送/分时段回报检查在到达回报阶段前只记单不回报，
  // 缺省不限制（开单即回报，向后兼容）。元数据来自教师病例 JSON 的 testRelease 字段（knowledge/ 私有，不入 Git）。
  const releaseByTestId = new Map((source?.testRelease ?? []).map((item) => [item.testId, item]));
  // 检查媒体绑定（可选，按 testId 应用）：结果释放时随事件挂载报告图片，缺省无媒体。
  // 元数据来自教师病例 JSON 的 testMedia 字段（knowledge/ 私有，不入 Git）。
  const mediaByTestId = new Map((source?.testMedia ?? []).map((item) => [item.testId, item.media]));
  const applyTestMetadata = (test: AuxiliaryTest): AuxiliaryTest => {
    const release = releaseByTestId.get(test.id);
    if (release) {
      if (release.availableFromStage) test.availableFromStage = release.availableFromStage;
      if (release.resultDelayNote) test.resultDelayNote = release.resultDelayNote;
    }
    const media = mediaByTestId.get(test.id);
    if (media && media.length > 0) test.media = media;
    return test;
  };
  const tests = testLines.map((line, index): AuxiliaryTest => {
    const label = trustedTestLabel(line, index);
    return applyTestMetadata({ id: `source-test-${index}`, label, indication: '选择后查看本病例提供的检查结果', result: line, evidenceCode: `SOURCE_TEST_${index}`, appropriate: null });
  });
  // 恢复态投影剥离（未开单 sections.tests 为空串）时，目录来自会话作用域目录缓存
  // （case_snapshot_list_tests 注入，无答案仅 id/label）：保证学生可见可下单目录（死锁修复）。
  // 目录项与全文行 id 同规则（source-test-N）；全文恢复后（首单触发投影刷新）自然替换，
  // 仅在缓存 tests 为空（剥离态）时合并，避免解析错位产生重复项。
  const catalog = getSessionTestsCatalog(caseId, version, sessionId);
  if (catalog && tests.length === 0) {
    for (const item of catalog) {
      const index = Number(item.id.replace(/^source-test-/, ''));
      tests.push(applyTestMetadata({ id: item.id, label: item.label, indication: '选择后查看本病例提供的检查结果', result: '', evidenceCode: Number.isFinite(index) ? `SOURCE_TEST_${index}` : `SOURCE_TEST_${item.id}`, appropriate: null }));
    }
  }
  return {
    ...profile, id: caseId, version: 2, age: source?.age ?? '年龄未记录', sex: source?.sex ?? '性别未记录', patientName: '小朋友',
    patientImage: patientAppearance(source?.sex ?? '性别未记录','standing',profile.id,source?.age).src ?? '/media/clinical/virtual-child-unclassified.svg',
    triage: source ? `${source.age}患儿就诊。${verifiedComplaint(source) ?? '主诉需进一步核实'}。` : '请先采集主诉、现病史和一般状态。本病种尚未加载独立病例正文，可记录自己的问诊与诊疗思路。',
    openingParent: source ? `医生，孩子这次主要是${verifiedComplaint(source) ?? '不舒服，具体情况还需核实'}，请您看看。` : '医生，具体病史还需要补充，请先告诉我您想了解什么。',
    initialEmotion: 'nervous', initialVitals: source?.vitals ?? unknown, stages: FLAGSHIP_CASE.stages,
    history: [], exams, tests, sourceFacts: source,
  };
}

export function identifyHistoryIntent(caseId: string, question: string, version?: string | null, sessionId?: string | null): HistoryIntent | null {
  return identifyHistoryIntents(caseId, question, version, sessionId)[0] ?? null;
}

export function identifyHistoryIntents(caseId: string, question: string, version?: string | null, sessionId?: string | null): HistoryIntent[] {
  const normalized = question.replace(/\s+/g, '');
  return getCase(caseId, version, sessionId).history.filter((item) => item.keywords.some((keyword) => normalized.includes(keyword)));
}

export function findExamRule(caseId: string, toolId: string, bodyPartId: string, version?: string | null, sessionId?: string | null): ExamRule | null {
  return getCase(caseId, version, sessionId).exams.find((item) => item.toolId === toolId && item.bodyPartId === bodyPartId) ?? null;
}

export function findTest(caseId: string, testId: string, version?: string | null, sessionId?: string | null): AuxiliaryTest | null {
  return getCase(caseId, version, sessionId).tests.find((item) => item.id === testId) ?? null;
}
