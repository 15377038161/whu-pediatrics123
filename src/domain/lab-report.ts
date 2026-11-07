import {z} from 'zod';
export const labReportSchema=z.object({
  name:z.string(),specimen:z.string(),reference:z.string(),origin:z.enum(['source','teaching-simulation','reference']),
  rows:z.array(z.object({item:z.string(),value:z.string(),unit:z.string(),reportedAt:z.string()})).max(400),
});
export type LabReport=z.infer<typeof labReportSchema>;

/** Literal extraction only: no unit conversions, inferred values or patient reference intervals. */
export function extractLabRows(text:string,label:string):LabReport['rows']{
  if(/CT|MRI|超声|影像|X线|心电图|脑电图|骨髓|骨龄/i.test(label))return [];
  const names='尿蛋白|尿糖|尿酮|尿隐血|尿潜血|总胆红素|直接胆红素|间接胆红素|白蛋白|总蛋白|尿素氮|血糖|血钾|血钠|血氯|肌酐|乳酸|铁蛋白|雌二醇|睾酮|生长激素|肌红蛋白|肌钙蛋白|WBC|RBC|HGB|Hb|PLT|NEUT|LYMPH|HCT|MCV|MCHC|MCH|CRP|PCT|ESR|GLU|pCO2|pO2|pH|HCO3[-⁻]?|BE|AG|Lac|K\\+|Na\\+|Cl[-−]?|Ca2\\+|Mg2\\+|Scr|BUN|CREA|ALT|AST|ALB|TBIL|DBIL|IBIL|APTT|PT|INR|FIB|Ferritin|LDL|HDL|TG|TC|LH|FSH|CK-MB|CKMB|CK|LDH|cTnI|cTnT|TSH|FT3|FT4';
  const units='(?:[×x*]\\s*)?10\\s*\\^?\\s*[⁰¹²³⁴⁵⁶⁷⁸⁹0-9]+\\s*[/／]\\s*(?:L|uL|μL)|mmol\\s*[/／]\\s*L|[μµu]mol\\s*[/／]\\s*L|pmol\\s*[/／]\\s*L|mIU\\s*[/／]\\s*L|IU\\s*[/／]\\s*L|U\\s*[/／]\\s*L|mg\\s*[/／]\\s*dL|g\\s*[/／]\\s*dL|mg\\s*[/／]\\s*L|g\\s*[/／]\\s*L|ng\\s*[/／]\\s*mL|[μµu]g\\s*[/／]\\s*L|mmHg|kPa|fL|pg|%|秒|s';
  const pattern=new RegExp(`(${names})\\s*[:：=]?\\s*([<>＜＞≤≥]?\\s*[+−-]?\\d+(?:\\.\\d+)?|[+＋]{1,4}|阴性|阳性)\\s*(${units})?`,'gi');
  const dates=[...text.matchAll(/(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)(?:\s*\d{1,2}(?:[:：]\d{2}|点))?/g)];
  const rows:LabReport['rows']=[];const seen=new Set<string>();
  for(const m of text.matchAll(pattern)){
    const reportedAt=dates.filter(d=>(d.index??0)<=(m.index??0)).at(-1)?.[0]??'原文未单列时点';
    const row={item:m[1],value:m[2].trim(),unit:m[3]?.trim()??'原文未注明',reportedAt};const key=JSON.stringify(row);
    if(!seen.has(key)){rows.push(row);seen.add(key);}if(rows.length===400)break;
  }
  return rows;
}
