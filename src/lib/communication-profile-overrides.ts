// 服务端逐例审核覆盖表（独立项 D：角色知情范围结构化）。禁止客户端导入——
// key 含病种名（泄题面），客户端展示继续走 domain 保守年龄默认档（display-only）。
// 与 domain COMMUNICATION_PROFILE_OVERRIDES 的关系：domain 空表是客户端安全注入点
// （测试可注入语言能力覆盖，不含病种名）；本表承载含病种名的真实逐例审核结果。
import { resolveCommunicationProfile, type CommunicationProfile } from '@/domain/communication-profile';
import { resolveCaseId } from '@/lib/case-identity';

/**
 * 逐例审核覆盖表：key 为内部教师病例 ID（经 resolveCaseId 归一，公开 opaque ID/URL 编码均可命中）。
 * 每条覆盖必须注明审核日期与出处；只覆盖经审核确认的字段，未覆盖字段回退保守年龄默认档。
 */
export const AUDITED_COMMUNICATION_PROFILE_OVERRIDES: Record<string, Partial<CommunicationProfile>> = {
  // 特发性血小板减少性紫癜（2026-10-23 逐例审核）：
  // - 意识 alert：入院查体「神志清楚」（source-material-001）
  // - 痛苦 mild：入院查体「精神一般」；教师标准化模板角色资料「一个精神反应尚可的孩子」
  // - 患儿知情 partial：角色资料「患儿能够回答的内容：哪里痛/哪里不舒服」——仅自身感知，不知病史
  // - 家长知情 full：角色资料「主要由家长回答的内容」覆盖时间线/出血表现/一般状态/家族史/用药史
  // - 语言能力 3 岁 toddler 年龄默认档 limited 保留（与角色资料一致，不覆盖）
  // - 家长性别原资料未指定：caregiverGender 保持 unknown（不编造）
  'teacher-特发性血小板减少性紫癜': {
    consciousness: 'alert',
    distress: 'mild',
    caregiverKnowledge: 'full',
    childKnowledge: 'partial',
    developmentNotes: '生长发育史无异常，各项发育基本达标；母乳喂养（教师标准化模板 source-material-002）',
  },
};

/** 服务端角色能力解析：domain 保守默认（含 domain 空表注入）之上叠加逐例审核覆盖。 */
export function resolveAuditedCommunicationProfile(caseId: string, ageKnown: string): CommunicationProfile {
  const base = resolveCommunicationProfile(caseId, ageKnown);
  const audited = AUDITED_COMMUNICATION_PROFILE_OVERRIDES[resolveCaseId(caseId)];
  if (!audited) return base;
  return { ...base, ...audited, derivation: 'case_override' };
}
