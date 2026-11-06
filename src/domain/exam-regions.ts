import { EXAM_LOCATIONS, type ExamLocationId } from '@/domain/source-exam-contract';

/**
 * 查体部位两级结构：常驻只显示 6 个大区按钮，点开后就地放射出该区的子部位。
 *
 * 部位一多就平铺必然互相重叠、手机上误触（24 个按钮挤在一张患儿图上，同栏相邻只差几个百分点）。
 * 所以把「选哪个部位」拆成两步：第一步 6 个，第二步最多 7 个。
 *
 * 扇形的全部几何量都放在这里而不是 CSS：锚点百分比、弧心角、张角、半径比例一起进单测，
 * 保证子部位按钮在任何患儿图尺寸下都不互相压住、不压自己那颗大区触发器、不出舞台可点范围
 * （.patient-figure 展开时 overflow:visible，但外层 .patient-stage 仍是 overflow:hidden，
 * 超出舞台内边距余量就等于点不到）。大区 id 带 rg- 前缀与部位 id 分属两个命名空间，
 * 只用于 UI，永不进入 EXAM_ACTION。
 */
export interface ExamRegion {
  id: string;
  label: string;
  /** 贴左还是贴右边缘，决定扇形朝哪边张开（一律朝患儿图中线一侧，否则被图框裁掉）。 */
  side: 'left' | 'right';
  /** 大区按钮的纵向锚点百分比，[站姿, 仰卧]；横向一律贴边 3%。 */
  anchorTop: readonly [number, number];
  /** 弧心角与张角，单位为度，沿用 CSS rotate 约定（0°=正右，顺时针为正，90°=正下）。 */
  arcCenter: number;
  arcSpan: number;
  /**
   * 扇形半径，单位为「图框宽度的比例」而非 px。
   * 固定 px 是改造前重叠的根因：同一 112px 在 360px 图框里只占 31%，在 240px 图框里占 47%，
   * 窄图框下子部位按钮会横穿中线压到对侧大区。按比例后落点与图框同比缩放，
   * CSS 侧用容器查询单位 cqw 表达（.patient-figure 是 inline-size 容器），两侧同源。
   */
  radiusBase: number;
  /** 奇偶错档半径（同为宽度比例）：不错开相邻按钮会在弧上压住，44px 点击目标就失效。 */
  radiusStagger: number;
  parts: readonly ExamLocationId[];
}

/** 患儿图边缘到大区按钮外沿的横向留白百分比。 */
export const REGION_EDGE_INSET = 3;
/**
 * 按钮尺寸（px），供几何校验复算落点：高度与 globals.css 的 --tap 同源，触发器宽度是
 * .exam-region 上写死的内联 width；扇形按钮不换行，实宽按「11px 中文字宽 × 字数 + 内边距 + 描边」
 * 从 globals.css 的 .exam-fan-item 反推。这三个数是 CSS 的镜像，改 CSS 必须同步改这里，
 * 否则单测校验的落点与浏览器真实落点就不是同一个东西。
 */
export const REGION_TRIGGER_WIDTH = 76;
export const BUTTON_HEIGHT = 44;
const FAN_ITEM_MIN_WIDTH = 48;
const FAN_ITEM_CHAR_WIDTH = 11;
const FAN_ITEM_PADDING = 20;
/** .exam-fan-item 的 1px 描边左右各一条；box-sizing:border-box 下它算进按钮实宽，漏掉会让重叠校验偏乐观 2px。 */
const FAN_ITEM_BORDER = 2;

/**
 * 子部位允许探出图框上/下沿的余量（px），取自 .patient-stage 的内边距：
 * 上 10–14px、下 60–78px。图框展开扇形时是 overflow:visible，但舞台仍是 overflow:hidden，
 * 超出舞台余量就等于按钮被裁掉点不到，所以几何校验按这个预算而不是按图框硬边界算。
 */
export const STAGE_TOP_SLACK = 12;
export const STAGE_BOTTOM_SLACK = 70;

/**
 * 子部位两两之间、以及子部位与自己那颗大区触发器之间的最小空隙下限（px）。
 * 几何校验的 overlaps 判定带 1px 容差，曾把 0.4px 的真重叠判成合法——真重叠意味着
 * 两个 44px 按钮边缘相咬、手机上容易点错，所以另设这条不吃容差的下限。
 */
export const MIN_BUTTON_SEPARATION = 4;

/**
 * 弧心角/张角/半径比例是一次性确定性求解的结果：在 240–360px 图框、957:1644 / 832:1216 / 1:1
 * 三种素材比例、站姿与仰卧的组合上，同时满足「子部位互不重叠、不压自己那颗大区触发器、
 * 不出舞台余量、点击目标不小于 44px」。求解脚本本身不入库，验收口径固化在
 * tests/exam-regions.test.ts —— 它按 9 档真实图框逐档复算。改这里任一数字都要重跑该测试。
 */
export const EXAM_REGIONS: readonly ExamRegion[] = [
  { id: 'rg-head-neck', label: '头面颈部', side: 'left', anchorTop: [20, 22], arcCenter: 28.5, arcSpan: 124, radiusBase: 0.4225, radiusStagger: 0.245, parts: ['forehead', 'eyes', 'ears', 'nose', 'mouth', 'neck', 'lymph-nodes'] },
  { id: 'rg-chest', label: '胸部', side: 'right', anchorTop: [30, 32], arcCenter: 206, arcSpan: 134, radiusBase: 0.335, radiusStagger: 0, parts: ['chest', 'chest-lung', 'chest-heart', 'breast'] },
  { id: 'rg-abdomen', label: '腹部', side: 'right', anchorTop: [52, 54], arcCenter: 173, arcSpan: 74, radiusBase: 0.365, radiusStagger: 0, parts: ['abdomen', 'liver-spleen', 'groin'] },
  { id: 'rg-vitals-prep', label: '体征准备', side: 'left', anchorTop: [48, 48], arcCenter: -8.5, arcSpan: 75, radiusBase: 0.365, radiusStagger: 0, parts: ['upper-arm', 'finger', 'hands'] },
  { id: 'rg-skin-general', label: '皮肤全身', side: 'left', anchorTop: [76, 74], arcCenter: 5, arcSpan: 100, radiusBase: 0.295, radiusStagger: 0.03, parts: ['skin', 'general-state', 'nails'] },
  { id: 'rg-limbs-neuro', label: '四肢神经', side: 'right', anchorTop: [76, 76], arcCenter: 169, arcSpan: 88, radiusBase: 0.3091, radiusStagger: 0.1742, parts: ['limbs', 'joints', 'spine', 'neuro'] },
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
export const SUPINE_ONLY_PARTS: ReadonlySet<string> = new Set(['abdomen', 'liver-spleen', 'groin']);

/** 扇形里第 index 颗子部位的弧上角度；单颗时落在弧心，多颗在弧上等分（含两端）。 */
export function fanAngle(region: ExamRegion, index: number): number {
  const count = region.parts.length;
  if (count <= 1) return region.arcCenter;
  return region.arcCenter - region.arcSpan / 2 + (region.arcSpan * index) / (count - 1);
}

export function fanRadius(region: ExamRegion, index: number, figureWidth: number): number {
  // 由 fanRadiusPercent 反算，保证几何校验用的落点与浏览器按 cqw 算出的落点是同一个数。
  return (fanRadiusPercent(region, index) / 100) * figureWidth;
}

/** CSS 侧写进 --fan-r 的容器查询单位数值（1cqw = 图框宽度的 1%），与 fanRadius 同一比例。 */
export function fanRadiusPercent(region: ExamRegion, index: number): number {
  return Math.round(fanRadiusRatio(region, index) * 10000) / 100;
}

function fanRadiusRatio(region: ExamRegion, index: number): number {
  return index % 2 === 0 ? region.radiusBase : region.radiusBase + region.radiusStagger;
}

/** 大区按钮在患儿图上的锚点（按钮中心，px），原点为图框左上角。 */
export function regionAnchor(region: ExamRegion, figureWidth: number, figureHeight: number, posture: 'standing' | 'supine'): { x: number; y: number } {
  const inset = (figureWidth * REGION_EDGE_INSET) / 100;
  return {
    x: region.side === 'left' ? inset + REGION_TRIGGER_WIDTH / 2 : figureWidth - inset - REGION_TRIGGER_WIDTH / 2,
    y: (figureHeight * region.anchorTop[posture === 'supine' ? 1 : 0]) / 100 + BUTTON_HEIGHT / 2,
  };
}

export interface FanItemBox { centerX: number; centerY: number; width: number; height: number }

/** 两个按钮两轴里较松一轴的真实空隙（px）；<0 即真重叠，不吃任何容差。 */
export function buttonSeparation(a: FanItemBox, b: FanItemBox): number {
  return Math.max(
    Math.abs(a.centerX - b.centerX) - (a.width + b.width) / 2,
    Math.abs(a.centerY - b.centerY) - (a.height + b.height) / 2,
  );
}

/** 扇形里第 index 颗子部位按钮的落点与尺寸（px）；rotate(a) translate(r) 的净位移就是这里的圆心偏移。 */
export function fanItemBox(region: ExamRegion, index: number, figureWidth: number, figureHeight: number, posture: 'standing' | 'supine'): FanItemBox {
  const label = partLabel(region.parts[index]);
  const anchor = regionAnchor(region, figureWidth, figureHeight, posture);
  const angle = (fanAngle(region, index) * Math.PI) / 180;
  const radius = fanRadius(region, index, figureWidth);
  return {
    centerX: anchor.x + radius * Math.cos(angle),
    centerY: anchor.y + radius * Math.sin(angle),
    width: Math.max(FAN_ITEM_MIN_WIDTH, label.length * FAN_ITEM_CHAR_WIDTH + FAN_ITEM_PADDING + FAN_ITEM_BORDER),
    height: BUTTON_HEIGHT,
  };
}
