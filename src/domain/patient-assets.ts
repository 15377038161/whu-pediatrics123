/**
 * 人物资产清单（方案 9.1：人物资产清单与病例绑定）。
 *
 * 职责与边界：
 * - 本域是**结构化元数据层**：把现有素材登记为带 assetId/ageBand/sexPresentation/
 *   postures/style/isSynthetic/reviewStatus/version 的清单，供人物背景 UI（方案 17.2 V09
 *   人物匹配）与资产治理使用；**不改 patient-appearance 的选择行为**（哈希选择与
 *   新生儿/婴儿固定素材逻辑保持原状，key 直接对齐）。
 * - 未知不猜、不伪装审核：全部素材为项目自制虚拟示教插画（isSynthetic=true）；
 *   **没有任何素材完成医学/形象专业审核**——reviewStatus 一律 'unaudited'，
 *   许可条款待确认（license='project_internal_unreviewed'），不声称已审核可用。
 * - 年龄段诚实标注：现有素材仅覆盖新生儿/婴儿（卧位）与学龄前（通用虚拟儿童）；
 *   幼儿/学龄/青少年**没有同龄素材**，当前复用学龄前通用角色（patient-appearance
 *   既有行为），此为已登记缺口（bindingGapNote），不假装已匹配。
 * - 家长/照护者头像：当前**没有**任何照护者素材（方案 9.2 家长头像配置的前置），
 *   caregiverAssets 一律空数组，缺口如实登记。
 * - 图像只表达外观和场景，不能替代真实体征；alt 文案统一携带「虚拟示教角色，
 *   非病例本人，不代表病例年龄或体征」口径（方案 9.2）。
 */

export type AssetAgeBand = 'newborn' | 'infant' | 'toddler' | 'preschool' | 'school' | 'adolescent';
export type SexPresentation = 'male' | 'female' | 'neutral';
export type Posture = 'standing' | 'supine';
export type AssetReviewStatus = 'unaudited' | 'reviewed';
export type AssetStyle = 'synthetic_illustration';

export interface PatientAsset {
  /** 稳定资产标识（与 patient-appearance 的 character key 对齐）。 */
  assetId: string;
  /** 适用年龄段（素材实际呈现，不是病例年龄）。 */
  ageBand: AssetAgeBand;
  sexPresentation: SexPresentation;
  /** 该素材提供的体位（新生儿/婴儿仅 supine——该月龄不能站立）。 */
  postures: Posture[];
  /** 体位 → 素材路径（public/ 内相对路径）。 */
  sources: Partial<Record<Posture, string>>;
  /** 素材风格：全部为合成虚拟示教插画。 */
  style: AssetStyle;
  /** 许可：项目自制素材，具体许可条款待确认，不声称已获外部授权。 */
  license: 'project_internal_unreviewed';
  isSynthetic: true;
  /** 专业审核状态：全部未审核，不伪装已审核。 */
  reviewStatus: AssetReviewStatus;
  version: string;
  /** 素材说明（人物背景 UI 展示用，含虚拟标注口径）。 */
  note: string;
}

/** 照护者素材：当前没有，如实登记（方案 9.2 家长头像配置的前置缺口）。 */
export interface CaregiverAsset {
  assetId: string;
  presentation: string;
  style: AssetStyle;
  isSynthetic: true;
  reviewStatus: AssetReviewStatus;
  sources: string[];
}

/**
 * 人物资产清单（基于 2026-10 现有 public/media/clinical 素材盘点）。
 * key 与 patient-appearance.ts 的 characters/newbornCharacters 完全对齐，
 * 保证人物背景 UI 展示的素材信息与实际渲染素材一致。
 */
export const PATIENT_ASSETS: readonly PatientAsset[] = [
  {
    assetId: 'newborn-boy',
    ageBand: 'newborn',
    sexPresentation: 'male',
    postures: ['supine'],
    sources: { supine: '/media/clinical/virtual-newborn-boy-supine-v1.png' },
    style: 'synthetic_illustration',
    license: 'project_internal_unreviewed',
    isSynthetic: true,
    reviewStatus: 'unaudited',
    version: 'v1',
    note: '男婴仰卧虚拟示教角色（新生儿素材），非病例本人，不代表病例体征',
  },
  {
    assetId: 'newborn-girl',
    ageBand: 'newborn',
    sexPresentation: 'female',
    postures: ['supine'],
    sources: { supine: '/media/clinical/virtual-newborn-girl-supine-v1.png' },
    style: 'synthetic_illustration',
    license: 'project_internal_unreviewed',
    isSynthetic: true,
    reviewStatus: 'unaudited',
    version: 'v1',
    note: '女婴仰卧虚拟示教角色（新生儿素材），非病例本人，不代表病例体征',
  },
  {
    assetId: 'boy-a',
    ageBand: 'preschool',
    sexPresentation: 'male',
    postures: ['standing', 'supine'],
    sources: { standing: '/media/clinical/virtual-child-front.png', supine: '/media/clinical/virtual-child-boy-a-supine-v2.png' },
    style: 'synthetic_illustration',
    license: 'project_internal_unreviewed',
    isSynthetic: true,
    reviewStatus: 'unaudited',
    version: 'v1',
    note: '学龄前男孩虚拟示教角色 A（通用素材，跨病例复用），非病例本人',
  },
  {
    assetId: 'boy-b',
    ageBand: 'preschool',
    sexPresentation: 'male',
    postures: ['standing', 'supine'],
    sources: { standing: '/media/clinical/virtual-child-boy-b-standing-v1.png', supine: '/media/clinical/virtual-child-boy-b-supine-v1.png' },
    style: 'synthetic_illustration',
    license: 'project_internal_unreviewed',
    isSynthetic: true,
    reviewStatus: 'unaudited',
    version: 'v1',
    note: '学龄前男孩虚拟示教角色 B（通用素材，跨病例复用），非病例本人',
  },
  {
    assetId: 'girl-a',
    ageBand: 'preschool',
    sexPresentation: 'female',
    postures: ['standing', 'supine'],
    sources: { standing: '/media/clinical/virtual-child-girl-standing-v2.png', supine: '/media/clinical/virtual-child-girl-a-supine-v1.png' },
    style: 'synthetic_illustration',
    license: 'project_internal_unreviewed',
    isSynthetic: true,
    reviewStatus: 'unaudited',
    version: 'v1',
    note: '学龄前女孩虚拟示教角色 A（通用素材，跨病例复用），非病例本人',
  },
  {
    assetId: 'girl-b',
    ageBand: 'preschool',
    sexPresentation: 'female',
    postures: ['standing', 'supine'],
    sources: { standing: '/media/clinical/virtual-child-girl-b-standing-v1.png', supine: '/media/clinical/virtual-child-girl-b-supine-v1.png' },
    style: 'synthetic_illustration',
    license: 'project_internal_unreviewed',
    isSynthetic: true,
    reviewStatus: 'unaudited',
    version: 'v1',
    note: '学龄前女孩虚拟示教角色 B（通用素材，跨病例复用），非病例本人',
  },
];

/** 照护者素材清单：当前为空（无任何家长/照护者头像素材，缺口如实登记）。 */
export const CAREGIVER_ASSETS: readonly CaregiverAsset[] = [];

/** patient-appearance 返回的 character key → 结构化资产记录；'unspecified'（性别未知）无绑定。 */
export function patientAssetByKey(key: string): PatientAsset | null {
  return PATIENT_ASSETS.find((asset) => asset.assetId === key) ?? null;
}

/**
 * 年龄段素材缺口说明（方案 9.2「优先复用现有合法适龄资产」的差距面如实登记）：
 * - 幼儿/学龄/青少年：无同龄素材，复用学龄前通用角色（素材年龄与病例年龄不一致时 UI 明示）。
 * - 新生儿/婴儿素材仅卧位（该月龄不能站立）。
 * - 照护者素材缺失。
 */
export function bindingGapNote(ageBand: string): string | null {
  switch (ageBand) {
    case 'toddler':
      return '暂无幼儿同龄素材：当前使用学龄前通用虚拟角色，与病例年龄段不完全一致';
    case 'school':
      return '暂无学龄同龄素材：当前使用学龄前通用虚拟角色，与病例年龄段不完全一致';
    case 'adolescent':
      return '暂无青少年同龄素材：当前使用学龄前通用虚拟角色，与病例年龄段不完全一致';
    case 'newborn':
    case 'infant':
      return '新生儿/婴儿素材仅提供仰卧体位（该月龄不能站立）';
    default:
      return null;
  }
}

/** 人物背景 UI 展示用标签（中文口径，未知不猜）。 */
export function ageBandLabel(ageBand: string): string {
  const map: Record<string, string> = {
    newborn: '新生儿',
    infant: '婴儿',
    toddler: '幼儿',
    preschool: '学龄前',
    school: '学龄',
    adolescent: '青少年',
    unknown: '年龄未知',
  };
  return map[ageBand] ?? '年龄未知';
}

export function sexPresentationLabel(sex: string): string {
  if (sex === '男') return '男';
  if (sex === '女') return '女';
  return '性别未注明';
}
