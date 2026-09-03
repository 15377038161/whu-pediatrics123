import { KNOWLEDGE_SOURCES } from '@/domain/knowledge';

// 武汉大学儿科学（珞珈儿科智训）教学内容总览。
// 该数据集按四大方向组织：模拟病例训练、OSCE 模拟考站、专项能力训练、儿科专科资源库。
// status 为 online 表示系统内已可进入，planned 表示教学规划内容，需教师审核后升级为正式病例。

export type ContentType = 'case' | 'osce' | 'practice' | 'resource';
export type ContentStatus = 'online' | 'planned';

export interface PediatricContentItem {
  id: string;
  type: ContentType;
  category: string;
  title: string;
  summary: string;
  tags: string[];
  status: ContentStatus;
  href?: string;
  age?: string;
  sex?: '男' | '女' | '通用';
  difficulty?: string;
}

const CASE_CONTENT: PediatricContentItem[] = [
  {
    id: 'peds-respiratory-001',
    type: 'case',
    category: '呼吸系统',
    title: '3岁男童发热、咳嗽伴气促',
    summary: '旗舰病例。以肺炎为主线的完整临床动线：自主问诊、可视化肺部查体、辅助检查、诊断处置与家长沟通。',
    tags: ['发热', '咳嗽', '气促', '肺炎', '危险信号'],
    status: 'online',
    href: '/student/training?mode=guided&case=peds-respiratory-001',
    age: '3岁2个月',
    sex: '男',
    difficulty: '基础进阶',
  },
  {
    id: 'peds-wheeze-002',
    type: 'case',
    category: '呼吸系统',
    title: '5岁女童发热、咳嗽伴喘息',
    summary: '演示病例。喘息性疾病动线，练习哮鸣音识别、喘息与肺炎的鉴别思路。',
    tags: ['发热', '咳嗽', '喘息', '鉴别诊断'],
    status: 'online',
    href: '/student/training?mode=guided&case=peds-wheeze-002',
    age: '5岁4个月',
    sex: '女',
    difficulty: '基础进阶',
  },
  {
    id: 'peds-gi-003',
    type: 'case',
    category: '消化系统',
    title: '8月龄男婴呕吐、腹泻伴尿量减少',
    summary: '秋季腹泻（轮状病毒肠炎）主线，教学重点是脱水程度评估、口服补液与静脉补液指征判断。',
    tags: ['腹泻', '呕吐', '脱水评估', '液体疗法'],
    status: 'planned',
    age: '8个月',
    sex: '男',
    difficulty: '基础',
  },
  {
    id: 'peds-gi-004',
    type: 'case',
    category: '消化系统',
    title: '1岁男婴阵发性哭闹伴果酱样血便',
    summary: '肠套叠主线，教学重点是阵发性腹痛的病史还原、腹部包块查体与急症转诊时机。',
    tags: ['腹痛', '血便', '肠套叠', '急症识别'],
    status: 'planned',
    age: '1岁',
    sex: '男',
    difficulty: '进阶',
  },
  {
    id: 'peds-cardio-005',
    type: 'case',
    category: '循环系统',
    title: '3岁男童发热5天伴皮疹、球结膜充血',
    summary: '川崎病主线，教学重点是诊断标准拆解、不完全川崎病的识别与冠状动脉风险沟通。',
    tags: ['长期发热', '皮疹', '川崎病', '冠状动脉'],
    status: 'planned',
    age: '3岁',
    sex: '男',
    difficulty: '进阶',
  },
  {
    id: 'peds-cardio-006',
    type: 'case',
    category: '循环系统',
    title: '2月龄女婴体检发现心脏杂音',
    summary: '先天性心脏病（室间隔缺损）主线，教学重点是杂音听诊定位、喂养史与生长发育史采集。',
    tags: ['心脏杂音', '先天性心脏病', '生长发育史'],
    status: 'planned',
    age: '2个月',
    sex: '女',
    difficulty: '进阶',
  },
  {
    id: 'peds-hema-007',
    type: 'case',
    category: '血液系统',
    title: '2岁男童面色苍白、食欲差2个月',
    summary: '营养性缺铁性贫血主线，教学重点是喂养史追问、血常规解读与铁剂治疗的家长宣教。',
    tags: ['贫血', '喂养史', '血常规', '营养'],
    status: 'planned',
    age: '2岁',
    sex: '男',
    difficulty: '基础',
  },
  {
    id: 'peds-neuro-008',
    type: 'case',
    category: '神经系统',
    title: '2岁女童发热伴突发全身抽搐',
    summary: '热性惊厥主线，教学重点是惊厥现场处置顺序、复发风险评估与安抚性沟通。',
    tags: ['惊厥', '抽搐', '发热', '应急处置'],
    status: 'planned',
    age: '2岁',
    sex: '女',
    difficulty: '基础进阶',
  },
  {
    id: 'peds-nephro-009',
    type: 'case',
    category: '泌尿系统',
    title: '5岁男童眼睑水肿伴泡沫尿',
    summary: '肾病综合征主线，教学重点是水肿问诊、尿蛋白结果解读与激素治疗的长期管理沟通。',
    tags: ['水肿', '蛋白尿', '肾病综合征', '慢病沟通'],
    status: 'planned',
    age: '5岁',
    sex: '男',
    difficulty: '进阶',
  },
  {
    id: 'peds-infect-010',
    type: 'case',
    category: '感染与传染病',
    title: '2岁女童发热伴口腔疱疹、手足皮疹',
    summary: '手足口病主线，教学重点是皮疹分布观察、重症预警信号识别与隔离宣教。',
    tags: ['手足口病', '皮疹', '传染病', '重症预警'],
    status: 'planned',
    age: '2岁',
    sex: '女',
    difficulty: '基础',
  },
  {
    id: 'peds-neonate-011',
    type: 'case',
    category: '新生儿',
    title: '出生3天新生儿皮肤黄染进行性加重',
    summary: '新生儿黄疸主线，教学重点是生理性与病理性黄疸鉴别、胆红素水平评估与光疗指征。',
    tags: ['黄疸', '新生儿', '胆红素', '光疗'],
    status: 'planned',
    age: '出生3天',
    sex: '通用',
    difficulty: '进阶',
  },
  {
    id: 'peds-er-012',
    type: 'case',
    category: '急危重症',
    title: '6岁男童高热、精神萎靡伴皮肤花斑',
    summary: '脓毒性休克主线，教学重点是儿童危重快速识别、初步液体复苏思路与紧急沟通。',
    tags: ['休克', '脓毒症', '危重识别', '急救'],
    status: 'planned',
    age: '6岁',
    sex: '男',
    difficulty: '高阶',
  },
];

const OSCE_CONTENT: PediatricContentItem[] = [
  {
    id: 'osce-station-01',
    type: 'osce',
    category: 'OSCE 考站',
    title: '考站01 · 儿童发热伴气促',
    summary: '8分钟限时、无提示、一次作答的呼吸系统考站，沿用旗舰病例，按证据化标准评分。',
    tags: ['限时考核', '呼吸系统', '证据评分'],
    status: 'online',
    href: '/student/osce',
    difficulty: '标准',
  },
  {
    id: 'osce-station-02',
    type: 'osce',
    category: 'OSCE 考站',
    title: '考站02 · 儿科病史采集与沟通',
    summary: '规划考站。限时完成低龄患儿与家长的双角色病史采集，考核问诊结构与共情表达。',
    tags: ['限时考核', '问诊', '沟通'],
    status: 'planned',
    difficulty: '标准',
  },
  {
    id: 'osce-station-03',
    type: 'osce',
    category: 'OSCE 考站',
    title: '考站03 · 儿童危重快速识别',
    summary: '规划考站。给定生命体征与情景线索，要求在限时内完成危重判断与处置优先级排序。',
    tags: ['限时考核', '危重识别', '处置优先级'],
    status: 'planned',
    difficulty: '标准',
  },
  {
    id: 'osce-station-04',
    type: 'osce',
    category: 'OSCE 考站',
    title: '考站04 · 婴幼儿体格检查',
    summary: '规划考站。考核婴幼儿查体的顺序、手法与爱伤意识，记录可验证的查体证据。',
    tags: ['限时考核', '体格检查', '婴幼儿'],
    status: 'planned',
    difficulty: '标准',
  },
];

const PRACTICE_CONTENT: PediatricContentItem[] = [
  {
    id: 'practice-history',
    type: 'practice',
    category: '专项训练',
    title: '儿科病史采集',
    summary: '沿完整病例动线练习低龄患儿与家长的信息采集和危险信号追问。',
    tags: ['问诊', '病史采集', '危险信号'],
    status: 'online',
    href: '/student/training?mode=practice&focus=history',
  },
  {
    id: 'practice-exam',
    type: 'practice',
    category: '专项训练',
    title: '肺部规范查体',
    summary: '练习准备动作、器材与部位匹配，形成可验证的查体证据。',
    tags: ['查体', '肺部听诊', '器材操作'],
    status: 'online',
    href: '/student/training?mode=practice&focus=exam',
  },
  {
    id: 'practice-safety',
    type: 'practice',
    category: '专项训练',
    title: '感染与危重识别',
    summary: '整合血氧、呼吸频率和局灶体征，确定处置优先级。',
    tags: ['危重识别', '生命体征', '安全'],
    status: 'online',
    href: '/student/training?mode=practice&focus=safety',
  },
  {
    id: 'practice-communication',
    type: 'practice',
    category: '专项训练',
    title: '家长焦虑沟通',
    summary: '练习共情、风险解释和下一步安排。',
    tags: ['沟通', '共情', '家长宣教'],
    status: 'online',
    href: '/student/training?mode=practice&focus=communication',
  },
];

const RESOURCE_CONTENT: PediatricContentItem[] = [
  ...KNOWLEDGE_SOURCES.map((source): PediatricContentItem => ({
    id: `resource-${source.id}`,
    type: 'resource',
    category: '专科资源库',
    title: source.title,
    summary: source.summary,
    tags: source.tags,
    status: 'online',
    href: source.url,
  })),
  {
    id: 'resource-textbook-pediatrics-9',
    type: 'resource',
    category: '专科资源库',
    title: '《儿科学》第9版（人民卫生出版社）',
    summary: '武汉大学儿科学课程主干参考教材，病例主线与各系统知识点以此为准，具体章节由教师确认后导入。',
    tags: ['教材', '课程大纲', '各系统疾病'],
    status: 'planned',
  },
  {
    id: 'resource-vaccination-schedule',
    type: 'resource',
    category: '专科资源库',
    title: '国家免疫规划疫苗儿童免疫程序',
    summary: '用于预防接种史采集与疫苗相关疾病鉴别的公开参考资料，导入链接待教师审核。',
    tags: ['预防接种', '免疫规划', '病史采集'],
    status: 'planned',
  },
];

export const PEDIATRIC_CONTENT: PediatricContentItem[] = [
  ...CASE_CONTENT,
  ...OSCE_CONTENT,
  ...PRACTICE_CONTENT,
  ...RESOURCE_CONTENT,
];

export function listPediatricContent(type?: ContentType): PediatricContentItem[] {
  return type ? PEDIATRIC_CONTENT.filter((item) => item.type === type) : PEDIATRIC_CONTENT;
}

export function searchPediatricContent(query: string, limit = 8): PediatricContentItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return PEDIATRIC_CONTENT.map((item) => {
    const title = item.title.toLowerCase();
    const category = item.category.toLowerCase();
    const summary = item.summary.toLowerCase();
    let score = 0;
    if (title.includes(normalized)) score += 5;
    if (category.includes(normalized)) score += 2;
    if (summary.includes(normalized)) score += 1;
    for (const tag of item.tags) {
      if (tag.toLowerCase().includes(normalized) || normalized.includes(tag.toLowerCase())) score += 2;
    }
    return { item, score };
  })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
