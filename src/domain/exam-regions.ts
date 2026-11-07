import { EXAM_LOCATIONS, type ExamLocationId } from '@/domain/source-exam-contract';

export { ANATOMY_REGIONS } from '@/domain/exam-anatomy';

/**
 * 查体部位两级结构：患儿图上常驻 6 个大区按钮，点开后在图框底部弹出紧凑的部位选择面板。
 *
 * 早期把 24 个部位直接平铺会互相重叠；后来改成绕大区按钮放射的扇形，但 7 个部位沿大弧散开，
 * 在真实病例图上会横跨头、胸、腹（例如「鼻」落到躯干中部），学生反馈「太散」。现在只保留
 * 两级选位语义，第二级用网格面板渲染：位置固定、按钮等宽、滚动可控，不再依赖弧线几何。
 *
 * 大区 id 带 rg- 前缀与部位 id 分属两个命名空间，只用于 UI，永不进入 EXAM_ACTION。
 */
export interface ExamRegion {
  id: string;
  label: string;
  /** 贴左还是贴右边缘，决定大区触发器所在侧。 */
  side: 'left' | 'right';
  /** 大区按钮的纵向锚点百分比，[站姿, 仰卧]；横向一律贴边。 */
  anchorTop: readonly [number, number];
  parts: readonly ExamLocationId[];
}

/** 患儿图边缘到大区按钮外沿的横向留白百分比。 */
export const REGION_EDGE_INSET = 3;
/** 大区触发器宽度（px），与 .exam-region 的内联 width 同源。 */
export const REGION_TRIGGER_WIDTH = 76;

export const EXAM_REGIONS: readonly ExamRegion[] = [
  { id: 'rg-head-neck', label: '头面颈部', side: 'left', anchorTop: [20, 22], parts: ['forehead', 'eyes', 'ears', 'nose', 'mouth', 'neck', 'lymph-nodes'] },
  { id: 'rg-chest', label: '胸部', side: 'right', anchorTop: [30, 32], parts: ['chest', 'chest-lung', 'chest-heart', 'breast'] },
  { id: 'rg-abdomen', label: '腹部', side: 'right', anchorTop: [52, 54], parts: ['abdomen', 'liver-spleen', 'groin'] },
  { id: 'rg-vitals-prep', label: '生命体征', side: 'left', anchorTop: [48, 48], parts: ['upper-arm', 'finger', 'hands'] },
  { id: 'rg-skin-general', label: '皮肤与一般状态', side: 'left', anchorTop: [76, 74], parts: ['skin', 'general-state', 'nails'] },
  { id: 'rg-limbs-neuro', label: '四肢神经', side: 'right', anchorTop: [76, 76], parts: ['limbs', 'joints', 'spine', 'neuro'] },
] as const;

const LOCATION_LABELS = new Map<string, string>(EXAM_LOCATIONS.map(([id, label]) => [id, label]));

/** 子部位显示名；未收录的 id 原样返回，不用空串掩盖数据缺口。 */
export function partLabel(partId: string): string {
  return LOCATION_LABELS.get(partId) ?? partId;
}

export function regionForPart(partId: string): ExamRegion | null {
  return EXAM_REGIONS.find((region) => region.parts.includes(partId as ExamLocationId)) ?? null;
}

/** 仰卧位才能做的部位：站姿下点击要拦住并提示改体位，不能静默给结果。 */
export const SUPINE_ONLY_PARTS: ReadonlySet<string> = new Set([
  'abdomen', 'liver-spleen', 'groin', 'umbilicus', 'external-genitalia',
  'abdomen-right-upper', 'abdomen-left-upper', 'abdomen-right-lower', 'abdomen-left-lower',
]);
