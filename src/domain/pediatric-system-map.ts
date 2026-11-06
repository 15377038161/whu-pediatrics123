export type PediatricSystemKey =
  | 'respiratory'
  | 'cardiovascular'
  | 'digestive'
  | 'neurological'
  | 'urinary'
  | 'hematologic'
  | 'endocrine'
  | 'neonatal'
  | 'child-health'
  | 'infectious'
  | 'rheumatology-immunology'
  | 'genetic-metabolic'
  | 'critical-care';

export interface PediatricSystemDefinition {
  key: PediatricSystemKey;
  label: string;
  category: string;
}

export interface PediatricSystemHotspot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 图片展示名称只映射到现有公开目录分类，不改写病例 ID 或原始分类。 */
export const PEDIATRIC_SYSTEMS: readonly PediatricSystemDefinition[] = [
  { key: 'respiratory', label: '呼吸系统', category: '呼吸系统疾病' },
  { key: 'cardiovascular', label: '心血管系统', category: '心血管系统疾病' },
  { key: 'digestive', label: '消化系统', category: '消化系统疾病' },
  { key: 'neurological', label: '神经系统', category: '神经系统' },
  { key: 'urinary', label: '泌尿系统', category: '泌尿系统疾病' },
  { key: 'hematologic', label: '血液系统', category: '造血系统疾病' },
  { key: 'endocrine', label: '内分泌', category: '内分泌疾病' },
  { key: 'neonatal', label: '新生儿', category: '新生儿与新生儿疾病' },
  { key: 'child-health', label: '儿童保健', category: '营养性疾病' },
  { key: 'infectious', label: '感染', category: '感染性疾病' },
  { key: 'rheumatology-immunology', label: '风湿免疫', category: '免疫性疾病' },
  { key: 'genetic-metabolic', label: '遗传代谢', category: '遗传性疾病' },
  { key: 'critical-care', label: '急危重症', category: '急性中毒' },
];

/** 1586×992 桌面原图内的相对中心坐标与热区尺寸，单位均为百分比。 */
export const DESKTOP_SYSTEM_HOTSPOTS: Record<PediatricSystemKey, PediatricSystemHotspot> = {
  respiratory: { x: 15.7, y: 22.8, w: 20, h: 20 },
  cardiovascular: { x: 38.8, y: 23.9, w: 20, h: 20 },
  digestive: { x: 63.5, y: 27.8, w: 20, h: 21 },
  neurological: { x: 85.9, y: 20.5, w: 20, h: 20 },
  urinary: { x: 13.5, y: 43.9, w: 20, h: 20 },
  hematologic: { x: 36.3, y: 45.2, w: 20, h: 20 },
  endocrine: { x: 58.3, y: 45.4, w: 20, h: 21 },
  neonatal: { x: 87.4, y: 42.8, w: 20, h: 21 },
  'child-health': { x: 11.5, y: 66.4, w: 20, h: 21 },
  infectious: { x: 31.9, y: 73.7, w: 20, h: 21 },
  'rheumatology-immunology': { x: 50.5, y: 69.4, w: 20, h: 21 },
  'genetic-metabolic': { x: 71.9, y: 62.8, w: 20, h: 21 },
  'critical-care': { x: 88.3, y: 75, w: 20, h: 21 },
};

/** 1086×1448 手机原图内的独立标定，不复用桌面坐标。 */
export const MOBILE_SYSTEM_HOTSPOTS: Record<PediatricSystemKey, PediatricSystemHotspot> = {
  respiratory: { x: 17.8, y: 20.4, w: 29, h: 16.5 },
  cardiovascular: { x: 49.5, y: 19.5, w: 29, h: 16.5 },
  digestive: { x: 82.9, y: 22.2, w: 29, h: 16.5 },
  neurological: { x: 30.9, y: 36, w: 29, h: 16.5 },
  urinary: { x: 65.7, y: 36.1, w: 29, h: 16.5 },
  hematologic: { x: 16.7, y: 51.6, w: 29, h: 16.5 },
  endocrine: { x: 49.9, y: 52.4, w: 29, h: 16.5 },
  neonatal: { x: 83.4, y: 52, w: 29, h: 16.5 },
  'child-health': { x: 30.2, y: 67.3, w: 29, h: 16.5 },
  infectious: { x: 69, y: 67.5, w: 29, h: 16.5 },
  'rheumatology-immunology': { x: 16.9, y: 83.7, w: 29, h: 16.5 },
  'genetic-metabolic': { x: 48.6, y: 84.6, w: 29, h: 16.5 },
  'critical-care': { x: 81.5, y: 85.1, w: 29, h: 16.5 },
};
