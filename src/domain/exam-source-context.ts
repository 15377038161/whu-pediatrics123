/** Literal source context only. Denied findings must not become positive teaching risk flags. */
export function hasAffirmedSourceMention(text:string,terms:readonly string[]):boolean{
  for(const clause of text.split(/[，,。；;\n]/))for(const term of terms){
    let from=0,index:number;
    while((index=clause.indexOf(term,from))!==-1){
      from=index+term.length;
      const before=clause.slice(0,index),after=clause.slice(from);
      if(/^\s*[:：]?\s*(?:[（(]\s*[-－−]\s*[）)]|阴性)(?:\s|$|[、，。；])/.test(after))continue;
      const negative=[...before.matchAll(/未发现|未出现|未闻及|未触及|未扪及|未引出|未及|未见|否认|不伴有?|无/g)].at(-1);
      if(negative){
        const tail=before.slice(negative.index!+negative[0].length);
        if(tail.length<=24&&!/但|然而|而|却|出现|伴有|可见|存在/.test(tail))continue;
      }
      return true;
    }
  }
  return false;
}

export function sourceHasSystemicExamConcern(exam:string,diagnosis:string):boolean{
  return hasAffirmedSourceMention(`${exam}\n${diagnosis}`,['休克','低灌注','发绀','青紫','瘫痪','肌无力','水肿','脱水','危重','呼吸衰竭']);
}

/**
 * A systemic finding must not contradict the selected local observation.  Ear-canal/
 * tympanic-membrane and oropharyngeal morphology are independent of perfusion, oedema
 * and neuromuscular diagnoses; their own local-positive guards still apply separately.
 */
export function sourceHasSystemicExamConcernForSite(exam:string,diagnosis:string,tool:string,part:string):boolean{
  const known=`${exam}\n${diagnosis}`;
  if(hasAffirmedSourceMention(known,['危重']))return true;
  const independentLocalMorphology=(tool==='otoscope'&&part==='ears')||(tool==='tongue-depressor'&&part==='mouth');
  if(independentLocalMorphology)return false;
  return sourceHasSystemicExamConcern(exam,diagnosis);
}
