export interface PublicCaseProfile {
  id: string;
  version: number;
  title: string;
  subtitle: string;
  category: string;
  presentingSymptoms: string[];
  age: string;
  sex: '男' | '女';
  difficulty: string;
  expectedMinutes: number;
  patientName: string;
  patientImage: string;
  patientAlt: string;
  contentStatus: 'flagship-fixture' | 'demo-pending-review';
}

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
  },
];

export function getPublicCase(caseId: string): PublicCaseProfile {
  const caseProfile = CASE_CATALOG.find((item) => item.id === caseId);
  if (!caseProfile) throw new Error('CASE_NOT_FOUND');
  return caseProfile;
}
