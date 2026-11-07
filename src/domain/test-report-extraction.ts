export interface ReportMatcher {label:string;pattern:RegExp;fallbackFor?:string[]}

/** Split combined source reports before releasing a requested item.
 * Preserve objective continuations of one report; a new test heading ends its scope.
 * Ambiguous combined clauses are withheld, rather than releasing another test's values.
 */
export function extractObjectiveTestReport(text:string,target:string,matchers:ReportMatcher[]):string {
  let current:string|null=null;
  const selected:string[]=[];
  for(const raw of text.split(/[，,；;。\n]/)){
    const clause=raw.trim();if(!clause)continue;
    if(/^(?:提示|考虑|符合|诊断|影像诊断|印象|结论|入院诊断|出院诊断)[:：]/.test(clause)){current=null;continue;}
    const clean=clause.replace(/(?:提示|考虑|符合|诊断为|影像诊断|印象|结论)[:：]?.*$/,'').trim();
    if(!clean)continue;
    const matching=matchers.filter(m=>m.pattern.test(clean));
    const specific=matching.filter(m=>!m.fallbackFor);
    const matches=(specific.length?specific:matching).map(m=>m.label);
    // A generic lung-description marker must not steal the continuation of an explicit CT/X-ray report.
    if(!specific.length&&current&&matching.some(m=>m.fallbackFor?.includes(current!))){if(current===target)selected.push(clean);continue;}
    if(matches.length===1){current=matches[0];if(current===target)selected.push(clean);}
    else if(matches.length>1){current=null;}
    else if(current===target)selected.push(clean);
  }
  return selected.join('；');
}
