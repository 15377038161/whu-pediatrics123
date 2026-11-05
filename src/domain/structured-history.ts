/**
 * 第一站「病史采集」的结构化提纲与判分（执业医师实践技能，临床类别）。
 *
 * 与 SP 角色扮演的区别：这里是**书面结构化采集**——学生按分区逐项填写问诊提纲，
 * 系统按教师可核验的要点清单判分并提示漏问项；不是与虚拟患儿多轮对话。
 *
 * 边界：
 * - 要点清单来自儿科问诊的通用要素（主诉、现病史六要素、既往史、个人史、家族史、社会史），
 *   不含任何病例特异结论，也不生成医学判断。
 * - 判分是「关键词覆盖」的确定性规则，只作教学练习反馈，不计入临床成绩、不替代考官评分。
 * - 识别同义表述靠关键词集合，无法覆盖全部自然语言写法；漏判时以教师复核为准。
 */

export type HistoryPoint = {
  key: string;
  label: string;
  /** 界面上的追问提示：告诉学生这一项该问出什么。 */
  hint: string;
  required: boolean;
  keywords: string[];
};

export type HistorySection = { id: string; label: string; points: HistoryPoint[] };

export const HISTORY_SECTIONS: HistorySection[] = [
  {
    id: 'chief',
    label: '主诉',
    points: [
      { key: 'chief-symptom', label: '主要症状', hint: '用家长的话写出最主要的 1–2 个症状', required: true, keywords: ['发热', '咳嗽', '气促', '喘息', '呕吐', '腹泻', '腹痛', '抽搐', '皮疹', '黄疸', '血便', '水肿', '苍白', '头痛', '少尿'] },
      { key: 'chief-duration', label: '病程时长', hint: '症状持续了多久（小时/天/周/月）', required: true, keywords: ['小时', '天', '周', '月', '年', '余'] },
    ],
  },
  {
    id: 'present',
    label: '现病史',
    points: [
      { key: 'present-onset', label: '起病时间与起病方式', hint: '什么时候开始，突然还是逐渐', required: true, keywords: ['起病', '突然', '急起', '缓起', '凌晨', '夜间', '晨起', '就诊前'] },
      { key: 'present-trigger', label: '诱因', hint: '有无受凉、饮食不洁、外伤、接触史、接种', required: false, keywords: ['受凉', '饮食', '不洁', '外伤', '接触', '接种', '进食', '喂养', '呛奶'] },
      { key: 'present-character', label: '主要症状特点', hint: '部位、性质、程度、频率、加重或缓解因素', required: true, keywords: ['阵发', '持续', '加重', '缓解', '夜间', '程度', '频率', '性质', '每次', '反复'] },
      { key: 'present-associated', label: '伴随症状', hint: '同时有没有其他不适（精神、食欲、呕吐、皮疹等）', required: true, keywords: ['伴', '伴随', '同时', '还有', '并'] },
      { key: 'present-course', label: '诊疗经过', hint: '在哪里看过、做过什么检查、用过什么药、效果如何', required: true, keywords: ['就诊', '医院', '门诊', '用药', '服药', '输液', '退热', '抗生素', '雾化', '住院', '检查'] },
      { key: 'present-general', label: '一般情况', hint: '精神、食欲、睡眠、大小便、体重变化', required: true, keywords: ['精神', '食欲', '睡眠', '大便', '小便', '尿量', '体重', '吃奶'] },
    ],
  },
  {
    id: 'past',
    label: '既往史',
    points: [
      { key: 'past-illness', label: '既往疾病与住院史', hint: '以前生过什么病、住过院吗', required: true, keywords: ['既往', '以前', '住院', '疾病', '患过', '反复'] },
      { key: 'past-surgery', label: '手术与外伤史', hint: '做过手术或受过外伤吗', required: false, keywords: ['手术', '外伤', '骨折', '缝合'] },
      { key: 'past-allergy', label: '药物与食物过敏史', hint: '对什么药或食物过敏', required: true, keywords: ['过敏', '药物过敏', '食物过敏', '皮试'] },
      { key: 'past-transfusion', label: '输血史', hint: '有没有输过血或血制品', required: false, keywords: ['输血', '血制品', '输血史'] },
    ],
  },
  {
    id: 'personal',
    label: '个人史（含出生、喂养、生长发育、预防接种）',
    points: [
      { key: 'personal-birth', label: '出生史', hint: '第几胎第几产、孕周、分娩方式、出生体重、有无窒息抢救', required: true, keywords: ['胎', '产', '孕周', '顺产', '剖宫产', '出生体重', '窒息', '抢救', '羊水'] },
      { key: 'personal-feeding', label: '喂养史', hint: '母乳还是配方奶、何时添加辅食、目前饮食', required: true, keywords: ['母乳', '配方奶', '奶粉', '辅食', '喂养', '饮食', '断奶'] },
      { key: 'personal-growth', label: '生长发育史', hint: '抬头、坐、爬、走、说话的时间，与同龄人比', required: false, keywords: ['发育', '抬头', '会坐', '会走', '说话', '出牙', '同龄'] },
      { key: 'personal-vaccine', label: '预防接种史', hint: '卡介苗、乙肝、脊灰等接种情况', required: true, keywords: ['接种', '疫苗', '卡介苗', '乙肝', '脊灰', '预防针'] },
    ],
  },
  {
    id: 'family',
    label: '家族史',
    points: [
      { key: 'family-similar', label: '家族中类似疾病', hint: '家里人有没有类似症状或同样疾病', required: true, keywords: ['家族', '家人', '父母', '兄弟姐妹', '类似', '遗传'] },
      { key: 'family-infectious', label: '传染病接触史', hint: '家里或周围有无结核、肝炎、手足口等', required: false, keywords: ['结核', '肝炎', '手足口', '传染', '接触史', '隔离'] },
    ],
  },
  {
    id: 'social',
    label: '社会史',
    points: [
      { key: 'social-env', label: '居住与托幼情况', hint: '住哪里、上幼儿园或学校吗、环境如何', required: false, keywords: ['居住', '农村', '城市', '幼儿园', '学校', '托幼', '环境'] },
      { key: 'social-contacts', label: '流行病学接触史', hint: '近期有无外出、聚集、接触生病的人或动物', required: false, keywords: ['外出', '旅游', '聚集', '接触', '宠物', '动物', '流行'] },
    ],
  },
];

export type HistoryAnswerInput = Record<string, string | undefined>;

export type HistorySectionScore = {
  id: string;
  label: string;
  hits: string[];
  misses: string[];
  requiredMisses: string[];
  score: number;
  maxScore: number;
};

export type HistoryGrade = {
  totalScore: number;
  maxScore: number;
  percent: number;
  sections: HistorySectionScore[];
  /** 按「必问项优先」排序的漏问提示，可直接展示给学生。 */
  missingPoints: string[];
};

const MAX_ANSWER = 2000;

function normalize(value: string): string {
  return value.slice(0, MAX_ANSWER).replace(/\s/g, '').toLowerCase();
}

function pointHit(answer: string, point: HistoryPoint): boolean {
  const text = normalize(answer);
  if (text.length < 2) return false;
  return point.keywords.some((keyword) => text.includes(normalize(keyword)));
}

/**
 * 按分区逐点判分。未知分区键忽略；同一分区答案为空则整区计入漏问。
 * 每个要点等权（1 分），percent 为得分率，便于不同提纲长度横向比较。
 */
export function gradeStructuredHistory(input: HistoryAnswerInput): HistoryGrade {
  const sections: HistorySectionScore[] = [];
  let totalScore = 0;
  let maxScore = 0;
  const requiredMisses: string[] = [];
  const optionalMisses: string[] = [];

  for (const section of HISTORY_SECTIONS) {
    const answer = input[section.id] ?? '';
    const hits: string[] = [];
    const misses: string[] = [];
    const sectionRequiredMisses: string[] = [];
    for (const point of section.points) {
      if (pointHit(answer, point)) hits.push(point.label);
      else {
        misses.push(point.label);
        if (point.required) sectionRequiredMisses.push(`${section.label} · ${point.label}`);
      }
    }
    const score = hits.length;
    const sectionMax = section.points.length;
    totalScore += score;
    maxScore += sectionMax;
    sections.push({ id: section.id, label: section.label, hits, misses, requiredMisses: sectionRequiredMisses, score, maxScore: sectionMax });
    requiredMisses.push(...sectionRequiredMisses);
    for (const label of misses) if (!sectionRequiredMisses.some((item) => item.endsWith(label))) optionalMisses.push(`${section.label} · ${label}`);
  }

  const percent = maxScore === 0 ? 0 : Math.round((totalScore / maxScore) * 100);
  return {
    totalScore,
    maxScore,
    percent,
    sections,
    missingPoints: [...requiredMisses, ...optionalMisses].map((item) => `漏问：${item}`),
  };
}

/** 提纲为空（学生一项都没填）时用于界面提示，不参与判分。 */
export function isHistoryAnswerEmpty(input: HistoryAnswerInput): boolean {
  return HISTORY_SECTIONS.every((section) => normalize(input[section.id] ?? '').length < 2);
}

export const HISTORY_DISCLAIMER = '本页为结构化病史采集练习：要点清单为儿科问诊通用要素，判分只做关键词覆盖，无法覆盖全部自然语言写法；练习得分不计入临床成绩，漏判以教师复核为准。';