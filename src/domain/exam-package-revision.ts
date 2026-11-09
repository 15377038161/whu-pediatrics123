import {anatomyLabel} from './exam-anatomy';
import {composeExamFinding,hasAbnormalMarker,type SourceExamSnippet} from './exam-finding-composer';
import {sourceExamDefinitions} from './exam-methods';
import {examProtocol} from './exam-protocol';
import {hasAffirmedSourceMention,sourceHasSystemicExamConcernForSite} from './exam-source-context';
import type {TeachingPackage} from './teaching-package';

export function sourceGroupForSite(part:string):string{
  if(/lung|chest$/.test(part))return 'chest-lung';
  if(/area$|chest-heart/.test(part))return 'chest-heart';
  if(/abdomen-|umbilicus/.test(part))return 'abdomen';
  if(/kidney|back/.test(part))return 'spine';
  if(/power|plantar/.test(part))return 'neuro';
  if(/hip|knee|ankle|foot|elbow|wrist|shoulder/.test(part))return 'joints';
  if(part==='scalp'||part==='fontanelle')return 'forehead';
  if(part==='thyroid')return 'neck';
  if(part==='cervical-nodes'||part==='axilla')return 'lymph-nodes';
  if(part==='lower-limb-edema'||part==='hands'||part==='finger')return 'limbs';
  if(part==='nails')return 'skin';
  if(part==='external-genitalia')return 'groin';
  return part;
}

/** Authoring only: revise missing non-numeric observations, preserving original findings and all scoring. */
export function reviseExamPackage(original:TeachingPackage,sourceExam:string,sourceDiagnosis=original.title,knownHistory=''):TeachingPackage{
  const pack=structuredClone(original);
  const rows=sourceExamDefinitions(sourceExam).filter((row):row is string[]=>Boolean(row[3])).map(row=>row.slice(0,4) as unknown as SourceExamSnippet);
  const known=`${sourceExam}\n${knownHistory}`;
  for(const exam of pack.exams){
    if(exam.origin==='source'||exam.bodyPartId==='growth')continue;
    const part=exam.bodyPartId,group=sourceGroupForSite(part);
    const protocol=examProtocol(exam.toolId,part);
    if(!protocol)continue;
    const terms=/general-state|neuro|power/.test(part)?['嗜睡','昏迷','精神差','精神萎靡','反应差','反应迟钝','意识不清']
      :group==='chest-lung'?['喘息','呼吸困难','呼吸费力','呼吸急促']
      :exam.toolId==='otoscope'&&part==='ears'?['耳痛','耳漏','耳道流液','耳道流脓','听力下降','鼓膜穿孔','鼓膜充血','外耳道充血']
      :exam.toolId==='tongue-depressor'&&part==='mouth'?['咽痛','咽部充血','扁桃体肿大','口腔疼痛','口腔溃疡','咽部分泌物','口唇发绀','口唇青紫']
      :/skin|nails|eyes/.test(part)?['皮疹','紫癜','黄疸','苍白','出血点']
      :/limbs|joints/.test(group)?['肢体疼痛','关节疼痛','关节肿胀','不能行走']:[];
    const systemic=sourceHasSystemicExamConcernForSite(known,sourceDiagnosis,exam.toolId,part);
    const result=composeExamFinding({tool:exam.toolId,part,group,protocolNormal:protocol.normal,sourceExams:rows,
      siteConcern:systemic||hasAffirmedSourceMention(known,terms),groupAbnormal:rows.some(row=>(row[1]===group||row[1]===part)&&hasAbnormalMarker(row[3]))
        ||known.split(/[，,。；;\n]/).some(clause=>clause.includes(anatomyLabel(part))&&hasAbnormalMarker(clause)),
      partLabel:anatomyLabel(part),groupLabel:anatomyLabel(group)});
    // Source records already present remain authoritative. No new source/evidence mapping in this revision.
    if(result.origin==='source'||(result.origin==='reference'&&exam.origin!=='teaching-simulation'))continue;
    exam.result=result.result;
    exam.origin=result.origin;
    exam.scope=result.scope;
    exam.sourceLocator=result.origin==='teaching-simulation'?'固定教学补充：器材与部位正常所见；未医学审定；非原患者新增实测':'教学操作参考：已知病情或年龄/测量限制，不补正常患者结论';
  }
  return pack;
}
