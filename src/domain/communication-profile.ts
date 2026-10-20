/**
 * 病例角色能力域（方案 8.1：角色能力是明确数据，不是让模型猜年龄）。
 *
 * 职责与边界：
 * - `speechCapability` 由年龄、原资料和具体病情共同确定；本域提供**保守的年龄默认推导**，
 *   并支持逐例审核覆盖（`COMMUNICATION_PROFILE_OVERRIDES`）。不把单一年龄阈值当医学
 *   发育诊断标准——推导结果标注 `derivation: 'age_default'`，仅是产品行为约束的默认值。
 * - 未知不猜：年龄解析失败或原资料缺失时 capability='unknown'，患儿一律不输出语义台词，
 *   由家长/照护者代述（安全默认，宁可保守也不虚构会说话的婴儿）。
 * - 意识状态、痛苦程度、家长知情范围等维度当前保持 unknown：原资料尚未逐例整理
 *   （阶段 G 逐例补全），不在本域凭空填值；逐例审核后经覆盖表注入。
 * - 时间解析为近似换算（岁=365 天、月=30 天），仅用于产品行为分档，
 *   非医学发育判定；"8岁27天"等源文异常保持 ageKnown 原样并按保守档处理。
 *
 * 方案依据：《自主训练平台整体改造方案》8.1（communicationProfile 字段）、
 * 8.2（角色调度要求：新生儿/不能言语患儿不输出语义台词）、
 * 9.2（家长头像不默认"妈妈"——本域 caregiverRelation 保持中性"家长"）。
 */

export type SpeechCapability = 'nonverbal' | 'limited' | 'conversational' | 'impaired' | 'unknown';

export type AgeBand = 'newborn' | 'infant' | 'toddler' | 'preschool' | 'school' | 'adolescent' | 'unknown';

export interface CommunicationProfile {
  /** 病例原文年龄表述（保持原样，不修正源文异常）。 */
  ageKnown: string;
  ageBand: AgeBand;
  /** 主数值与单位（如 "6岁" → {6, '岁'}）；解析失败为 null。 */
  ageValue: number | null;
  ageUnit: '岁' | '月' | '天' | '小时' | '分钟' | null;
  /**
   * 患儿语言表达能力：
   * - nonverbal：完全不能语言表达（新生儿、婴儿、明确不能言语）；不输出语义台词。
   * - limited：表达能力有限；仅回答自身能感知、能表达的问题（短句/词语），家长补时间线等。
   * - conversational：能正常交流；可独立回答主观感受，不知道的病史由家长补充。
   * - impaired：意识受损/严重不适等导致的交流受限（经审核的病情事件覆盖）。
   * - unknown：原资料缺失或解析失败；安全默认按不可语言表达处理。
   */
  speechCapability: SpeechCapability;
  /** 意识状态：当前保持 unknown（待逐例审核覆盖），不凭空判定。 */
  consciousness: 'alert' | 'impaired' | 'unknown';
  /** 痛苦/不适程度：当前保持 unknown（待逐例审核覆盖）。 */
  distress: 'none' | 'mild' | 'severe' | 'unknown';
  /** 病史主要陈述人：能交流的儿童本人可答主观感受，其余由照护者代述。 */
  primaryHistorian: 'child' | 'caregiver';
  /** 照护者关系：保持中性"家长"，不默认妈妈/爸爸（逐例审核后可覆盖）。 */
  caregiverRelation: string;
  /** 家长知情范围：当前保持 unknown（待逐例整理），角色应答不得越界使用未告知信息。 */
  caregiverKnowledge: 'full' | 'partial' | 'unknown';
  /** 患儿知情范围：当前保持 unknown（待逐例整理）。 */
  childKnowledge: 'full' | 'partial' | 'none' | 'unknown';
  /** 发育备注（逐例审核后填写；默认 null 不编造）。 */
  developmentNotes: string | null;
  /** 非言语反馈候选（哭闹/安静等，通用保守候选；逐例审核后覆盖为贴合病情的清单）。 */
  nonverbalBehaviors: string[];
  /** 推导来源：年龄默认档 or 逐例审核覆盖。 */
  derivation: 'age_default' | 'case_override';
}

/** 解析年龄表述为近似天数（解析辅助信息，非医学发育判定）。 */
export function parseAgeToDays(ageKnown: string): number | null {
  let days = 0;
  let matched = false;
  const re = /(\d+)\s*(岁|月|天|日|小时|分钟)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ageKnown)) !== null) {
    matched = true;
    const value = Number.parseInt(m[1], 10);
    const unit = m[2];
    if (unit === '岁') days += value * 365;
    else if (unit === '月') days += value * 30;
    else if (unit === '天' || unit === '日') days += value;
    else if (unit === '小时') days += value / 24;
    else if (unit === '分钟') days += value / 1440;
  }
  return matched ? days : null;
}

export function toAgeBand(days: number | null): AgeBand {
  if (days === null) return 'unknown';
  if (days <= 28) return 'newborn';
  if (days <= 365) return 'infant';
  if (days <= 365 * 3) return 'toddler';
  if (days <= 365 * 6) return 'preschool';
  if (days < 365 * 12) return 'school';
  return 'adolescent';
}

/**
 * 逐例审核覆盖表：key 为病例 ID（如 'teacher-新生儿呼吸窘迫综合征'）。
 * 仅接受经专业审核确认的字段覆盖（如意识受损 → speechCapability:'impaired'）；
 * 空对象是当前真实状态——没有任何病例完成角色能力专项审核，未知不伪装已审核。
 */
export const COMMUNICATION_PROFILE_OVERRIDES: Record<string, Partial<CommunicationProfile>> = {};

/** 保守的年龄默认档（产品行为约束，非医学发育诊断标准）。 */
function deriveDefaultProfile(ageKnown: string): CommunicationProfile {
  const days = parseAgeToDays(ageKnown);
  const band = toAgeBand(days);
  const primary = ageKnown.match(/(\d+)\s*(岁|月|天|日|小时|分钟)/);
  const speechCapability: SpeechCapability =
    band === 'unknown'
      ? 'unknown'
      : band === 'newborn' || band === 'infant'
        ? 'nonverbal'
        : band === 'toddler'
          ? 'limited'
          : 'conversational';
  return {
    ageKnown,
    ageBand: band,
    ageValue: primary ? Number.parseInt(primary[1], 10) : null,
    ageUnit: primary ? (primary[2] as CommunicationProfile['ageUnit']) : null,
    speechCapability,
    consciousness: 'unknown',
    distress: 'unknown',
    primaryHistorian: speechCapability === 'conversational' ? 'child' : 'caregiver',
    caregiverRelation: '家长',
    caregiverKnowledge: 'unknown',
    childKnowledge: 'unknown',
    developmentNotes: null,
    nonverbalBehaviors: ['哭闹', '安静'],
    derivation: 'age_default',
  };
}

/** 解析病例角色能力：逐例审核覆盖优先，其余走保守年龄默认档。 */
export function resolveCommunicationProfile(caseId: string, ageKnown: string): CommunicationProfile {
  const overrides = COMMUNICATION_PROFILE_OVERRIDES[caseId];
  if (!overrides) return deriveDefaultProfile(ageKnown);
  return { ...deriveDefaultProfile(ageKnown), ...overrides, derivation: 'case_override' };
}

/** 患儿是否可以输出语义台词：limited 可短句应答自身感知；nonverbal/impaired/unknown 一律不可。 */
export function canChildSpeak(profile: CommunicationProfile): boolean {
  return profile.speechCapability === 'conversational' || profile.speechCapability === 'limited';
}

/** 患儿台词是否必须保持极短（limited 档：短句/词语，不整段表达）。 */
export function childUsesShortUtterances(profile: CommunicationProfile): boolean {
  return profile.speechCapability === 'limited';
}

/** 患儿人设措辞档（供 role-agent 提示词选择，不强迫学龄儿童使用幼儿化措辞）。 */
export type ChildPersonaStyle = 'toddler_speak' | 'simple' | 'age_appropriate' | 'none';

export function childPersonaStyle(profile: CommunicationProfile): ChildPersonaStyle {
  if (!canChildSpeak(profile)) return 'none';
  if (profile.speechCapability === 'limited') return 'toddler_speak';
  return profile.ageBand === 'adolescent' || profile.ageBand === 'school' ? 'age_appropriate' : 'simple';
}
