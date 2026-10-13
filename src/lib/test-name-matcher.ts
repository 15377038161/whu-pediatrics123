import type { AuxiliaryTest } from '@/domain/case';

/**
 * 辅助检查文本申请的服务端确定性别名匹配（2026-10-12 第一批任务2）：
 *
 * 学生自主输入检查名称（如「血常规/CBC」「胸片」），服务端按病例现有检查目录
 * （AuxiliaryTest.label）做确定性名称与别名匹配——不调用大模型、不生成结果、
 * 不向客户端下发完整候选列表（客户端只回显学生原文与匹配状态）。
 *
 * 匹配规则（纯函数、可单测）：
 * 1. 同义词组：输入与目录 label 归一到同一规范名（组内仅同一检查方式的真实同义词，
 *    如 胸片/胸部X线/胸部正位片；**不做跨方式映射**——胸片≠胸部CT、脑电图≠头颅MRI、
 *    肝功能≠肝脏超声，天然由分组隔离，未命中即未匹配，fail-closed）；
 * 2. 单向前缀：输入比目录 label 更具体（label 是输入的前缀，如「血常规（复查）」
 *    匹配「血常规」）；不允许反向（输入「血常规」不得匹配更具体的「血常规五分类」，
 *    合并/亚型项目不因模糊申请被默认扩展）。
 *
 * 别名表仅是匹配设计（含经核实的常见简称），不代表所有病例都有这些结果——
 * 匹配成功仍需病例目录中存在对应项才返回结果。
 */

/** 规范化：全角转半角、去所有空白、小写（英文缩写大小写不敏感）。 */
export function normalizeTestName(raw: string): string {
  return raw
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 中文常用分隔符切分：逗号/顿号/分号/换行（一次申请多项时分项处理）。 */
export function splitRequestedTests(raw: string): string[] {
  return raw
    .split(/[,，、;；\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 同义词组（组首为规范名；组内仅同一检查方式的真实同义词/缩写）。
 *  注意：解剖部位不同的同名检查（胸部CT / 头颅CT）分属不同组，不做互通；
 *  亚型/合并项目（血常规五分类）不并入基础项组，保持目录项独立可区分。 */
const TEST_SYNONYM_GROUPS: string[][] = [
  ['血常规', 'cbc', '血rt'],
  ['C反应蛋白', 'crp'],
  ['超敏C反应蛋白', '超敏crp', 'hs-crp'],
  ['降钙素原', 'pct'],
  ['血沉', 'esr', '红细胞沉降率'],
  ['胸片', '胸部x线', '胸部正位片'],
  ['胸部CT'],
  ['头颅CT', '颅脑ct'],
  ['MRI', '核磁共振', '核磁', 'mr'],
  ['头颅MRI', '头颅核磁'],
  ['B超', '彩超', '超声'],
  ['腹部超声', '腹部b超'],
  ['泌尿系超声', '泌尿系b超'],
  ['超声心动图', '心脏彩超', '心脏超声', 'echo'],
  ['心电图', 'ecg'],
  ['脑电图', 'eeg'],
  ['动态心电图', 'holter'],
  ['脑钠肽', 'bnp'],
  ['肌钙蛋白', 'tnt'],
  ['支气管镜', '气管镜'],
  ['过敏原', '过敏源'],
  ['大便隐血', '便隐血'],
];

/** 规范名（组首）与全部组内变体的规范化映射表（构建一次）。 */
const VARIANT_TO_CANONICAL = new Map<string, string>();
for (const group of TEST_SYNONYM_GROUPS) {
  const canonical = normalizeTestName(group[0]);
  for (const variant of group) VARIANT_TO_CANONICAL.set(normalizeTestName(variant), canonical);
}

/** 输入/label 归一：规范化后查同义词组得到规范名；不在组内则用自身规范化。 */
function canonicalOf(raw: string): string {
  const normalized = normalizeTestName(raw);
  return VARIANT_TO_CANONICAL.get(normalized) ?? normalized;
}

/** 单项申请的匹配结果。 */
export interface TestMatchResult {
  /** 学生的原始输入（原文回显，不修改）。 */
  requested: string;
  /** 匹配到的病例检查项（null=本病例目录无该项）；匹配仅代表目录中存在该检查。 */
  test: AuxiliaryTest | null;
  status?: 'matched' | 'ambiguous' | 'unmatched';
}

/** 匹配单个申请名到病例目录（确定性，无模型）。
 *  未匹配≠医学错误：仅在有明确规则依据时评价适宜性（由病例 appropriate 字段决定）。
 *  模糊输入（如裸「CT」「B超」未带部位）只与目录中同名项精确匹配，不做猜测扩展。 */
export function matchRequestedTest(requested: string, catalog: readonly AuxiliaryTest[]): TestMatchResult {
  const inputCanonical = canonicalOf(requested);
  const inputRaw = normalizeTestName(requested);
  if (inputRaw.length === 0) return { requested, test: null };

  const exact = catalog.filter(test => inputCanonical === canonicalOf(test.label));
  if (exact.length === 1) return { requested, test: exact[0], status: 'matched' };
  if (exact.length > 1) return { requested, test: null, status: 'ambiguous' };
  // 只允许明确复查后缀，不把CT增强/CTA/五分类/合并检查吞为基础检查。
  const qualified = catalog.filter(test => {
    const label = canonicalOf(test.label);
    return inputCanonical.startsWith(label) && /^(?:复查|检查|[（(]复查[）)])$/.test(inputCanonical.slice(label.length));
  });
  if (qualified.length === 1) return { requested, test: qualified[0], status: 'matched' };
  if (qualified.length > 1 || /^(?:ct|mri|核磁|b超|超声|影像|化验|检查)$/.test(inputRaw)) return { requested, test: null, status: 'ambiguous' };
  return { requested, test: null, status: 'unmatched' };
}

/** 批量匹配（保持输入顺序，重复输入各自返回相同结果）。 */
export function matchRequestedTests(requested: readonly string[], catalog: readonly AuxiliaryTest[]): TestMatchResult[] {
  return requested.map((item) => matchRequestedTest(item, catalog));
}
