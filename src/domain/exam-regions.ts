import { EXAM_LOCATIONS } from '@/domain/source-exam-contract';

export { ANATOMY_REGIONS } from '@/domain/exam-anatomy';

const LOCATION_LABELS = new Map<string, string>(EXAM_LOCATIONS.map(([id, label]) => [id, label]));

/** 子部位显示名；未收录的 id 原样返回，不用空串掩盖数据缺口。 */
export function partLabel(partId: string): string {
  return LOCATION_LABELS.get(partId) ?? partId;
}

/** 仰卧位才能做的部位：站姿下点击要拦住并提示改体位，不能静默给结果。 */
export const SUPINE_ONLY_PARTS: ReadonlySet<string> = new Set([
  'abdomen', 'liver-spleen', 'groin', 'umbilicus', 'external-genitalia',
  'abdomen-right-upper', 'abdomen-left-upper', 'abdomen-right-lower', 'abdomen-left-lower',
]);
