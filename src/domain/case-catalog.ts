// 学生侧公开病例目录（防透题收敛，2026-10-12 第一批任务1）：
// - 教师病例条目为客户端安全的中性目录（学科+序号），病种名/源病种名不进入本文件；
//   服务端按 id 解析原始事实（src/lib/teacher-case-data.ts），完成后经报告 caseTitle 释放病种名。
// - 本文件可被客户端组件引入（当前唯一目录来源：student 首页、病例库、训练台、报告列表），
//   禁止在此新增任何病种名、诊断、检查结果或患者事实。
// - 教师目录变更后运行 node scripts/gen-public-case-catalog.mjs 重新生成教师条目段。

export interface PublicCaseProfile {
  id: string;
  version: number;
  title: string;
  subtitle: string;
  category: string;
  presentingSymptoms: string[];
  age: string;
  sex: '男' | '女' | '待核验';
  difficulty: string;
  expectedMinutes: number;
  patientName: string;
  patientImage: string;
  patientAlt: string;
  contentStatus: 'flagship-fixture' | 'demo-pending-review' | 'teacher-materials-indexed' | 'teacher-catalog-only' | 'teacher-folder-only';
  /** 教师病例：与源病例的名称关系（alias 同名异拼 / subtype 具体亚型；null=无关联）。 */
  sourceRelation: 'alias' | 'subtype' | null;
  mediaCount?: number;
  documentCount?: number;
}

/** 教师条目精简结构（生成器产出，仅目录元数据）。 */
interface TeacherPublicEntry {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  sourceRelation: 'alias' | 'subtype' | null;
  contentStatus: PublicCaseProfile['contentStatus'];
  mediaCount: number;
  documentCount: number;
}

// 本段由 scripts/gen-public-case-catalog.mjs 生成（教师目录变更后需重新生成）：
// 教师病例条目为客户端安全中性目录——病种名/源病种名不进入本文件（防透题），
// 服务端按 id 解析原始事实（teacher-case-data），完成后经报告 caseTitle 释放病种名。
export const TEACHER_PUBLIC_ENTRIES: TeacherPublicEntry[] = [
  { id: "teacher-单纯肥胖症", title: "营养性疾病 · 真实病例 01", subtitle: "关联真实亚型病例", category: "营养性疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-新生儿呼吸窘迫综合征", title: "新生儿与新生儿疾病 · 真实病例 01", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 85, documentCount: 1 },
  { id: "teacher-新生儿败血症", title: "新生儿与新生儿疾病 · 真实病例 02", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 4, documentCount: 3 },
  { id: "teacher-新生儿高胆红素血症", title: "新生儿与新生儿疾病 · 真实病例 03", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 81, documentCount: 1 },
  { id: "teacher-新生儿abo溶血性黄疸", title: "新生儿与新生儿疾病 · 真实病例 04", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 336, documentCount: 2 },
  { id: "teacher-新生儿rh溶血性黄疸", title: "新生儿与新生儿疾病 · 真实病例 05", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "teacher-新生儿肺炎", title: "新生儿与新生儿疾病 · 真实病例 06", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3, documentCount: 1 },
  { id: "teacher-新生儿胎粪吸入肺炎", title: "新生儿与新生儿疾病 · 真实病例 07", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-新生儿化脓性脑膜炎", title: "新生儿与新生儿疾病 · 真实病例 08", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "teacher-新生儿重度窒息", title: "新生儿与新生儿疾病 · 真实病例 09", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 163, documentCount: 1 },
  { id: "teacher-新生儿脑梗死", title: "新生儿与新生儿疾病 · 真实病例 10", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-先天性肾上腺皮质增生症", title: "新生儿与新生儿疾病 · 真实病例 11", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 475, documentCount: 5 },
  { id: "teacher-新生儿缺血缺氧性脑病", title: "新生儿与新生儿疾病 · 真实病例 12", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1333, documentCount: 4 },
  { id: "teacher-风湿热", title: "免疫性疾病 · 真实病例 01", subtitle: "教师病例学习", category: "免疫性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 10, documentCount: 6 },
  { id: "teacher-过敏性紫癜", title: "免疫性疾病 · 真实病例 02", subtitle: "教师病例学习", category: "免疫性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 1 },
  { id: "teacher-川崎病", title: "免疫性疾病 · 真实病例 03", subtitle: "教师病例学习", category: "免疫性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 5, documentCount: 4 },
  { id: "teacher-传染行单核细胞增多症", title: "感染性疾病 · 真实病例 01", subtitle: "教师病例学习", category: "感染性疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-轮状病毒性肠炎", title: "消化系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 3 },
  { id: "teacher-细菌性肠炎", title: "消化系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3, documentCount: 2 },
  { id: "teacher-婴儿胆汁淤积症-巨细胞病毒", title: "消化系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-急性喉炎", title: "呼吸系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 2 },
  { id: "teacher-异物吸入性窒息", title: "呼吸系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 517, documentCount: 3 },
  { id: "teacher-急性喘息性支气管炎", title: "呼吸系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1, documentCount: 3 },
  { id: "teacher-毛细支气管炎", title: "呼吸系统疾病 · 真实病例 04", subtitle: "关联真实亚型病例", category: "呼吸系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-支气管哮喘", title: "呼吸系统疾病 · 真实病例 05", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 2 },
  { id: "teacher-支气管肺炎", title: "呼吸系统疾病 · 真实病例 06", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-大叶性肺炎", title: "呼吸系统疾病 · 真实病例 07", subtitle: "关联真实亚型病例", category: "呼吸系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-肺炎支原体性肺炎", title: "呼吸系统疾病 · 真实病例 08", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-心律失常-阵发性室上性心动过速", title: "心血管系统疾病 · 真实病例 01", subtitle: "关联真实亚型病例", category: "心血管系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-暴发性心肌炎", title: "心血管系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "心血管系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 5971, documentCount: 5 },
  { id: "teacher-急性肾小球肾炎", title: "泌尿系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "teacher-肾病综合征", title: "泌尿系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 4, documentCount: 3 },
  { id: "teacher-泌尿道感染", title: "泌尿系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 2 },
  { id: "teacher-急性肾衰竭", title: "泌尿系统疾病 · 真实病例 04", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3692, documentCount: 7 },
  { id: "teacher-再生障碍性贫血", title: "造血系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 6, documentCount: 3 },
  { id: "teacher-蚕豆病", title: "造血系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "teacher-特发性血小板减少性紫癜", title: "造血系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 1 },
  { id: "teacher-急性白血病", title: "造血系统疾病 · 真实病例 04", subtitle: "关联真实亚型病例", category: "造血系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-噬血细胞综合征", title: "造血系统疾病 · 真实病例 05", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 9 },
  { id: "teacher-发热性惊厥", title: "神经系统 · 真实病例 01", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 87, documentCount: 4 },
  { id: "teacher-癫痫", title: "神经系统 · 真实病例 02", subtitle: "关联真实亚型病例", category: "神经系统", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-病毒性脑炎", title: "神经系统 · 真实病例 03", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1904, documentCount: 5 },
  { id: "teacher-化脓性脑膜炎", title: "神经系统 · 真实病例 04", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1094, documentCount: 4 },
  { id: "teacher-结核性脑炎", title: "神经系统 · 真实病例 05", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1088, documentCount: 6 },
  { id: "teacher-格林巴利综合征", title: "神经系统 · 真实病例 06", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-先天性肌无力综合征", title: "神经系统 · 真实病例 07", subtitle: "教师病例学习", category: "神经系统", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-生长激素缺乏症-矮小症", title: "内分泌疾病 · 真实病例 01", subtitle: "关联真实亚型病例", category: "内分泌疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-中枢性尿崩症", title: "内分泌疾病 · 真实病例 02", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1811, documentCount: 4 },
  { id: "teacher-外周性性早熟", title: "内分泌疾病 · 真实病例 03", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 5 },
  { id: "teacher-中枢性性早熟", title: "内分泌疾病 · 真实病例 04", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 3 },
  { id: "teacher-i型糖尿病伴有酮症酸中毒", title: "内分泌疾病 · 真实病例 05", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-肝豆状核变性", title: "遗传性疾病 · 真实病例 01", subtitle: "教师病例学习", category: "遗传性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2020, documentCount: 4 },
  { id: "teacher-糖原贮积病", title: "遗传性疾病 · 真实病例 02", subtitle: "关联真实亚型病例", category: "遗传性疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "teacher-急性百草枯中毒", title: "急性中毒 · 真实病例 01", subtitle: "教师病例学习", category: "急性中毒", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3687, documentCount: 8 },
  { id: "teacher-1型糖尿病伴有酮症酸中毒", title: "内分泌疾病 · 真实病例 06", subtitle: "教师病例学习", category: "内分泌系统", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1, documentCount: 3 },
  { id: "teacher-矮小症", title: "内分泌疾病 · 真实病例 07", subtitle: "教师病例学习", category: "内分泌系统", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 3, documentCount: 3 },
  { id: "teacher-急性毛细支气管炎", title: "呼吸系统疾病 · 真实病例 09", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1, documentCount: 2 },
  { id: "teacher-肺不张", title: "呼吸系统疾病 · 真实病例 10", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 480, documentCount: 2 },
  { id: "teacher-肺炎支原体肺炎", title: "呼吸系统疾病 · 真实病例 11", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 547, documentCount: 2 },
  { id: "teacher-重症肺炎", title: "呼吸系统疾病 · 真实病例 12", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 331, documentCount: 4 },
  { id: "teacher-心律失常-室上性心动过速", title: "心血管系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "心血管系统", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 6, documentCount: 2 },
  { id: "teacher-传染性单核细胞增多症", title: "感染性疾病 · 真实病例 02", subtitle: "教师病例学习", category: "感染性疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1, documentCount: 3 },
  { id: "teacher-新生儿胎粪吸入性肺炎", title: "新生儿与新生儿疾病 · 真实病例 13", subtitle: "教师病例学习", category: "新生儿疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 2, documentCount: 1 },
  { id: "teacher-婴儿胆汁淤积症-巨细胞病毒感染", title: "消化系统疾病 · 真实病例 04", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 305, documentCount: 4 },
  { id: "teacher-中枢神经系统脱髓鞘病", title: "神经系统 · 真实病例 08", subtitle: "教师病例学习", category: "神经系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 633, documentCount: 5 },
  { id: "teacher-先天性肌无力", title: "神经系统 · 真实病例 09", subtitle: "教师病例学习", category: "神经系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 869, documentCount: 8 },
  { id: "teacher-癫痫全面性发作阵挛性发作", title: "神经系统 · 真实病例 10", subtitle: "教师病例学习", category: "神经系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1441, documentCount: 3 },
  { id: "teacher-儿童-肥胖症", title: "营养性疾病 · 真实病例 02", subtitle: "教师病例学习", category: "营养性疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 124, documentCount: 4 },
  { id: "teacher-急性白血病-急性淋巴细胞白血病", title: "造血系统疾病 · 真实病例 06", subtitle: "教师病例学习", category: "血液系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 10, documentCount: 2 },
  { id: "teacher-糖原贮积病iv型", title: "遗传性疾病 · 真实病例 03", subtitle: "教师病例学习", category: "遗传性疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 167, documentCount: 5 },
];

export const CASE_CATALOG: PublicCaseProfile[] = [
  {
    id: 'peds-respiratory-001',
    version: 1,
    title: '3岁男童发热、咳嗽伴气促',
    subtitle: '儿童呼吸系统模拟病例',
    category: '呼吸系统',
    presentingSymptoms: ['发热', '咳嗽', '呼吸急促'],
    age: '3岁2个月',
    sex: '男',
    difficulty: '基础进阶',
    expectedMinutes: 12,
    patientName: '小宇',
    patientImage: '/media/clinical/virtual-child-front.png',
    patientAlt: '3岁虚拟男童正面站立于儿科诊室，精神欠佳、呼吸较快',
    contentStatus: 'flagship-fixture',
    sourceRelation: null,
  },
  {
    id: 'peds-wheeze-002',
    version: 1,
    title: '5岁女童发热、咳嗽伴喘息',
    subtitle: '儿童呼吸系统模拟病例',
    category: '呼吸系统',
    presentingSymptoms: ['发热', '咳嗽', '喘息'],
    age: '5岁4个月',
    sex: '女',
    difficulty: '基础进阶',
    expectedMinutes: 12,
    patientName: '小宁',
    patientImage: '/media/clinical/virtual-child-girl-front.png',
    patientAlt: '5岁虚拟女童正面站立于儿科诊室，轻度紧张并伴呼吸稍快',
    contentStatus: 'demo-pending-review',
    sourceRelation: null,
  },
  ...TEACHER_PUBLIC_ENTRIES.map((item): PublicCaseProfile => ({
    id: item.id,
    version: 1,
    title: item.title,
    subtitle: item.subtitle,
    category: item.category,
    presentingSymptoms: [],
    age: '待核验',
    sex: '待核验',
    difficulty: item.contentStatus === 'teacher-catalog-only' && item.sourceRelation === null ? '病种自主研习' : '真实案例学习',
    expectedMinutes: 0,
    patientName: '小朋友',
    patientImage: '/media/clinical/virtual-child-front.png',
    patientAlt: '用于检查部位定位的教学示意模型，不代表原病例患儿外貌',
    contentStatus: item.contentStatus,
    sourceRelation: item.sourceRelation,
    mediaCount: item.mediaCount,
    documentCount: item.documentCount,
  })),
];

export function getPublicCase(caseId: string): PublicCaseProfile {
  const caseProfile = CASE_CATALOG.find((item) => item.id === caseId);
  if (!caseProfile) throw new Error('CASE_NOT_FOUND');
  return caseProfile;
}

/**
 * 目录外 caseId 降级查询（历史报告/归档会话展示用）：
 * 返回 null 而非抛错，调用方降级展示病例 ID；训练核心链路仍走 getPublicCase 硬防线。
 */
export function findPublicCase(caseId: string): PublicCaseProfile | null {
  return CASE_CATALOG.find((item) => item.id === caseId) ?? null;
}

export function isTrainableCase(caseId: string): boolean {
  return CASE_CATALOG.some((item) => item.id === caseId);
}
