export interface KnowledgeSource {
  id: string;
  title: string;
  organization: string;
  publishedAt: string;
  url: string;
  status: 'temporary_public' | 'teacher_approved';
  ageRange: string;
  tags: string[];
  summary: string;
}

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: 'nhc-mpp-2025',
    title: '儿童肺炎支原体肺炎诊疗指南（2025年版）',
    organization: '国家卫生健康委员会、国家中医药局',
    publishedAt: '2025-09',
    url: 'https://www.nhc.gov.cn/yzygj/c100068/202509/19e7145436b049a68d4ba8c2060dfa56/files/%E5%84%BF%E7%AB%A5%E8%82%BA%E7%82%8E%E6%94%AF%E5%8E%9F%E4%BD%93%E8%82%BA%E7%82%8E%E8%AF%8A%E7%96%97%E6%8C%87%E5%8D%97%EF%BC%882025%E5%B9%B4%E7%89%88%EF%BC%89.pdf',
    status: 'temporary_public',
    ageRange: '儿童',
    tags: ['肺炎', '呼吸系统', '危险信号'],
    summary: '作为儿童肺炎相关病史、检查与病情评估的公开测试参考，不作为未经教师审核的处方依据。',
  },
  {
    id: 'who-pneumonia-diarrhoea-2024',
    title: 'Guideline on management of pneumonia and diarrhoea in children up to 10 years of age',
    organization: 'World Health Organization',
    publishedAt: '2024-12-31',
    url: 'https://www.who.int/publications/i/item/9789240103412',
    status: 'temporary_public',
    ageRange: '0—10岁',
    tags: ['肺炎', '低氧', '儿童危险信号'],
    summary: '用于验证儿童呼吸系统危险信号、低氧评估与转诊思路的公开测试资料。',
  },
  {
    id: 'who-imci-communication',
    title: 'Model IMCI handbook: Integrated management of childhood illness',
    organization: 'World Health Organization',
    publishedAt: '2005-01-01',
    url: 'https://www.who.int/publications/i/item/9241546441',
    status: 'temporary_public',
    ageRange: '婴幼儿',
    tags: ['问诊', '沟通', '危险信号'],
    summary: '用于儿童常见疾病评估、分类、沟通与随访结构的公开测试参考。',
  },
];

export function retrieveKnowledge(query: string, limit = 3): KnowledgeSource[] {
  const normalized = query.toLowerCase();
  return KNOWLEDGE_SOURCES
    .map((source) => ({
      source,
      score: source.tags.reduce((sum, tag) => sum + (normalized.includes(tag.toLowerCase()) ? 2 : 0), 0)
        + (normalized.includes('肺') && source.tags.includes('肺炎') ? 1 : 0)
        + (normalized.includes('呼吸') && source.tags.includes('危险信号') ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ source }) => source);
}
