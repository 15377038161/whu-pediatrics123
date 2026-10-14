import type { Stage } from '@/domain/agent';

/** 指定教材经页面核对的概括文案；编号对应 docs/教材文本来源表.md。不是患者事实或评分标准。
 * 2026-10-14 按老师批注：登录页标语发回「练一次，会接诊」（page.tsx 硬编码），
 * 原 T01 提炼标语/介绍/儿科特色段已从登录页移除，此处不再保留对应字段。 */
export const teachingCopy = {
  safetyTitle: '儿童危重症识别',
  historyPractice: '认真听、重点问，关注主要症状及病程，并记录有鉴别意义的阴性信息。',
  examPractice: '先取得患儿与家长的配合，再按检查方法和身体部位获取病例证据。',
  safetyPractice: '遇急诊或危重患儿先简要评估并处理，再完善病史采集与体格检查。',
  communicationPractice: '使用亲切、通俗的语言沟通，体察患儿与家长的心情，尊重隐私。',
} as const;

export const teachingHints: Record<Stage, string[]> = {
  triage: ['先观察患儿的一般状态；遇危重情况先简要评估和处理。', '结合年龄了解症状，不能把儿童当成成人的缩影。'],
  history: ['认真听、重点问，了解主要症状、病程与伴随表现。', '关注有鉴别意义的阴性信息，以及饮食、睡眠和大小便。', '根据年龄和疾病特点补充出生、喂养、生长发育及既往史。'],
  exam: ['先向患儿和家长说明检查，营造自然、轻松的氛围。', '检查方式要结合患儿年龄与配合程度；结果以本病例记录为准。'],
  tests: ['结合病史和体格检查提出需要完善的检查及其理由。', '实验室与影像检查不能替代准确的病史采集和体格检查。'],
  assessment: ['整合已采集的病史、体征和检查，说明诊断依据。', '分析阳性发现与关键阴性信息，不先入为主。'],
  plan: ['结合年龄与病情提出处置、观察和后续安排。', '危重情况下先简要评估和处理，稳定后再完善诊疗。'],
  communication: ['体察患儿和家长的心情，用通俗语言说明下一步。', '尊重患儿及家长隐私，避免暗示性提问。'],
  report: ['对照实际问答和检查记录复盘；临床正确性仍需教师审核。'],
};

export const textbookSources = [
  { id: 'T01', chapter: '第一章 绪论 第二节 儿科学的特点', printedPages: [1, 2], pdfPages: [28, 29], kind: '短原文与概括', targets: ['slogan', 'pediatricFeature', 'introduction', 'features'] },
  { id: 'T02', chapter: '第四章 儿科疾病诊治原则 第一节 儿科病史采集和体格检查', printedPages: [32, 33], pdfPages: [59, 60], kind: '概括', targets: ['historyPractice', 'examPractice', 'safetyPractice', 'communicationPractice', 'teachingHints'] },
] as const;
