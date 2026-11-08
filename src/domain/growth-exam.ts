/** Instrument purpose and verbatim measurement extraction; never infer a child's size from age. */
export const GROWTH_TOOLS = ['standing-scale','infant-scale','length-board','stadiometer'] as const;
export type GrowthTool = typeof GROWTH_TOOLS[number];
export function growthPosition(tool:string):'standing'|'supine'|null {
  return tool==='standing-scale'||tool==='stadiometer'?'standing':tool==='infant-scale'||tool==='length-board'?'supine':null;
}
export function growthMeasurement(tool:string,text:string):string[] {
  const field=tool==='standing-scale'||tool==='infant-scale'?'体重':tool==='length-board'?'身长':tool==='stadiometer'?'身高':tool==='measuring-tape'?'头围':null;
  if(!field)return [];
  const unit=field==='体重'?'(?:kg|公斤|千克|g|克)':'(?:cm|厘米|mm|毫米|m|米)';
  // Only a labelled, exact value with a unit. Changes, doses and birth values
  // cannot silently become a current physical measurement.
  const pattern=new RegExp(`${field}\\s*[:：]?\\s*\\d+(?:\\.\\d+)?\\s*${unit}(?![a-zA-Z/／])`,'gi');
  return [...new Set([...text.matchAll(pattern)].filter(match=>{
    const before=text.slice(Math.max(0,match.index!-12),match.index);
    return !/(?:出生|出生时|生时|出生后|出生当时|妈妈|母亲|父亲|爸爸)[：:\s]*$/.test(before);
  }).map(match=>match[0]))];
}
export function growthProtocol(tool:string):{technique:string;normal:string;reaction:string}|null {
  const common='记录数值及单位（体重kg或g，身长/身高及头围cm）、测量时点和条件；结合准确年龄、性别及适用生长曲线评价，不按单次数值直接判正常。';
  const normal='正常生长的评价需结合适龄、同性别生长曲线与历次趋势；本项未提供独立测量值时，不用年龄推算值或参考范围冒充患者读数。';
  const reaction='模拟操作：解释测量目的，照护者协助保暖与安全；按患儿原有意识及运动能力配合，不强行摆位，不新增哭闹、疼痛或疾病表现。';
  if(tool==='standing-scale')return {technique:'核对站台式体重秤的承重、校准及归零；仅在患儿可安全独立站立时实施，脱鞋、减去厚重衣物，双脚居中站稳，不倚靠外物，稳定后读数。不能安全站立者改用合适婴儿秤或另行安排有支持的称重方法。'+common,normal,reaction};
  if(tool==='infant-scale')return {technique:'核对婴儿秤承重与托盘尺寸，平稳放置、归零并扣除垫巾重量；患儿仰卧于托盘中央，照护者在旁防坠，读数时避免额外接触压力，稳定后读数，不让婴儿独留在秤上。'+common,normal,reaction};
  if(tool==='length-board')return {technique:'使用水平身长板测仰卧身长，先核对身长板量程；脱鞋及影响定位的头饰，由两人配合稳定头位使头顶贴固定头板，轻柔伸展双下肢，将活动足板贴双足跟，读数后及时保暖。不能把站立身高与仰卧身长混写。'+common,normal,reaction};
  if(tool==='stadiometer')return {technique:'使用竖直固定的身高尺测站立身高；患儿需能安全站立，脱鞋及头饰，足跟并拢、身体自然直立，调整头位，水平头板轻触头顶，平视读数；不能安全站立者选择适合的卧位身长测量，不把两种方法的结果直接等同。'+common,normal,reaction};
  if(tool==='measuring-tape')return {technique:'软尺用于头围等围度，不能测体重，也不代替身长板或身高尺。测头围时去除头饰，软尺经眉弓上方和枕部最突出点绕行，贴合而不压迫，复核最大头围并记录cm；胸围、上臂围须另注明相应定位。'+common,normal,reaction};
  return null;
}
