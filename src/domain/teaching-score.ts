import type {NoteSectionKey} from './medical-note';
import {submittedSectionText} from './note-primary-contract';
import type { SessionState } from './agent';
import type { TeachingPackage, TeachingFeedback, TeachingRubricItem } from './teaching-package';
import {getCaseRecordEntries} from './case-record';

const clinicalAnchors=['pH','HCO3','WBC','PLT','Hb','GLU','SpO2','ALT','AST','CK','LDH','多饮','多尿','乏力','发热','咳嗽','喘息','呼吸音','呼吸困难','啰音','哮鸣','精神','黄疸','黄染','呕吐','腹泻','水肿','血尿','蛋白尿','出血','瘀点','皮疹','抽搐','惊厥','胸痛','腹痛','头痛','心律','心率','血糖','血钾','血气','白细胞','血小板','血红蛋白','胆红素','CRP','淋巴结','肝脾','反射','肌力','反跳痛','身高','体重','生长','骨龄','乳房','睾丸','性征','月经','毛发','肌酶','肝功能','肌酐','尿素','蛋白','腹胀','发绀','杂音','脉搏','超声','CT','MRI','脑电','骨髓','病毒','抗体'];
export function clinicalEvidenceRatio(text:string,records:ReadonlyArray<{area:string;text:string}>):number{
  const normalize=(s:string)=>s.toLowerCase().replace(/发烧/g,'发热').replace(/拉肚子/g,'腹泻').replace(/肚子疼/g,'腹痛').replace(/没力气/g,'乏力');
  const answer=normalize(text);const areas=new Set<string>();
  const polarity=(s:string,key:string)=>{
    const values=new Set<boolean>();let offset=s.indexOf(key);
    while(offset>=0){const prefix=s.slice(Math.max(0,offset-10),offset);values.add(/(?:无|没有|否认|未见|未诉)[^，。；;]{0,4}$/.test(prefix));offset=s.indexOf(key,offset+key.length);}
    return values;
  };
  for(const record of records){const source=normalize(record.text.split(/\n操作：|\n配合反应：/)[0]);
    if(clinicalAnchors.some(a=>{const key=normalize(a);return answer.includes(key)&&source.includes(key)&&[...polarity(source,key)].some(p=>polarity(answer,key).has(p));}))areas.add(record.area);
  }
  return areas.size>1?1:areas.size===1?.5:0;
}

function positiveMention(text:string,terms:string[]):boolean{
  text=text.toLowerCase();
  return terms.some(term=>{
    term=term.toLowerCase();
    let offset=text.indexOf(term);
    while(offset>=0){
      const prefix=text.slice(Math.max(0,offset-8),offset);
      if(!/(?:不|没有|无需|拒绝|停止|未|否认|避免|禁止|不得|勿|不宜|禁忌)(?:予|用|做|需要|应|要|进行|快速|常规|立即|继续|考虑|实施|使用|监测|观察|复查|建议|推荐){0,4}$/.test(prefix))return true;
      offset=text.indexOf(term,offset+term.length);
    }
    return false;
  });
}
export function gradeTeachingPoint(item:TeachingRubricItem,text:string,eventCodes:ReadonlySet<string>,purposeProvided=false):{ratio:number;status:TeachingFeedback['items'][number]['status'];explanation:string}{
  if(item.id==='exam-interpret')return {ratio:0,status:'not_assessable',explanation:'查体观察与解释的医学正确性需由教师结合本例证据复核，提交原文已保留；本项不自动判分，不计入当前可评价满分。'};
  // Template labels with placeholders are not clinical content; a concise factual entry still counts.
  if(item.section==='note')text=text.replace(/(?:主诉|现病史|查体|体格检查|初步诊断|诊断|诊疗计划|计划|治疗|处置)\s*[:：]\s*(?:略|同上|同前|见前|待补|暂无|无|不知道|不清楚|未填写)\s*(?=[；;]|$)/g,'');
  if(item.safetyCritical&&item.unsafePhrases?.length&&positiveMention(text,item.unsafePhrases))return {ratio:0,status:'incorrect',explanation:'本项出现明确不安全的处置表达，关键安全点不得分；其他独立正确要点仍分别计分。'};
  if(item.evidenceCodes.length){
    const obtained=item.evidenceCodes.some(code=>eventCodes.has(code));
    if(!obtained&&item.evidenceCodes.some(code=>eventCodes.has(code+'__partial')))return {ratio:.5,status:'partial',explanation:'已实际表达部分事实，但数值或必要限定尚未完整披露；只计本项一半分。'};
    if(!obtained)return {ratio:0,status:'missing',explanation:'本项尚无对应的实际提问或成功操作证据；不会因其他项目完成而代替计分。'};
    if(item.section==='tests'&&!purposeProvided)return {ratio:.5,status:'partial',explanation:'已申请检查，方向可识别；尚未说明用于诊断、鉴别、治疗评估或监测的具体目的。'};
    return {ratio:1,status:'achieved',explanation:'已有本项对应的实际采集或操作证据；不要求照抄标准答案。'};
  }
  if(!text.trim())return {ratio:0,status:'missing',explanation:'未发现本项提交内容。'};
  if(!item.concepts.length)return {ratio:0,status:'not_assessable',explanation:'本条缺少足以可靠自动判定的语义条件，保留原提交，不按错误扣分。'};
  const hits=item.concepts.filter(group=>positiveMention(text,group)).length;
  const partial=(item.partialConcepts??[]).some(group=>positiveMention(text,group));
  const ratio=hits===item.concepts.length?1:(hits>0||partial)?0.5:0;
  return {ratio,status:ratio===1?'achieved':ratio===.5?'partial':'missing',explanation:ratio===1?'核心含义已覆盖；简答、简称和合理同义表述均可。':ratio===.5?'方向正确，尚缺本项必要限定；仅本项得一半分。':'尚未识别本项的有效含义；只出现套话或否定应做事项不算答到。'};
}

/** Pure local practice score. It never mutates totalScore, clinical marks or previously saved reports. */
export function buildTeachingFeedback(session:SessionState,pack:TeachingPackage,noteText?:string,noteSections?:Partial<Record<NoteSectionKey,string>>):TeachingFeedback{
  const eventCodes=new Set(session.events.filter(e=>e.correct!==false).flatMap(e=>e.evidenceCodes));
  const records=getCaseRecordEntries(session).filter(r=>r.category==='history'?r.event.evidenceCodes.some(c=>c.startsWith('SOURCE_HX_')):r.event.evidenceCodes.some(c=>c!=='EX_PREP')).filter(r=>!r.event.summary.includes('【检查参考说明】')&&!r.event.summary.includes('【操作与参考说明】')).map(r=>({area:r.category,text:r.category==='history'?r.answers.map(a=>a.content).join('；'):r.event.summary}));
  const diagnosis=[session.decision?.diagnosis,session.decision?.secondaryDiagnosis?.join('、'),session.decision?.summary,session.decision?.diagnosisBasis,session.decision?.differentials].filter(Boolean).join('；');
  const plan=[session.plan?.priority,session.plan?.detail].filter(Boolean).join('；');
  const bySection:Record<TeachingRubricItem['section'],string>={history:session.historySummary??session.messages.filter(m=>m.actor==='student').map(m=>m.content).join('；'),exam:[session.examObservation?.findings,session.examObservation?.interpretation,session.decision?.summary].filter(Boolean).join('；'),tests:[diagnosis,plan,...session.events.filter(e=>e.type==='ORDER_TEST').map(e=>e.summary.includes('申请目的：')?e.summary.split('申请目的：')[1]:'')].join('；'),diagnosis,plan,note:noteText??'',communication:session.communication??''};
  const focus=session.mode==='practice'?session.practiceFocus:null;
  const sections=focus?({history:['history'],exam:['exam'],safety:['diagnosis','plan'],communication:['communication']} as Record<string,string[]>)[focus]:null;
  const items=pack.rubric.filter(item=>!sections||sections.includes(item.section)).map(item=>{
    const purpose=session.events.some(e=>e.type==='ORDER_TEST'&&e.summary.includes('申请目的：')&&e.evidenceCodes.some(code=>item.evidenceCodes.includes(code)))||Boolean(session.testRequests?.some(r=>r.purpose&&item.evidenceCodes.includes(`TEACH_TEST_${r.testId}`)));
    const relatedTests=pack.tests.filter(t=>item.evidenceCodes.includes(`TEACH_TEST_${t.id}`));
    const unavailableCheck=item.section==='tests'&&item.evidenceCodes.length>0&&(relatedTests.every(t=>t.origin==='reference')||relatedTests.some(t=>t.origin==='reference'&&session.orderedTests.includes(t.id))&&!relatedTests.some(t=>t.origin!=='reference'&&session.orderedTests.includes(t.id)));
    const primaryNote=pack.rubricVersion==='note-primary-60-v1'&&item.section==='note';
    const selectedNote=primaryNote?submittedSectionText(item.noteSection,noteSections):noteText;
    let judgement=unavailableCheck?{ratio:0,status:'not_assessable' as const,explanation:'本项仅有参考说明，缺少可核验患者结果；不将材料缺失算作学生漏做。'}:item.section==='note'&&selectedNote===undefined?{ratio:0,status:'not_assessable' as const,explanation:'本次未取得可核验的病历提交，暂不计入可评价满分；不把读取失败当作学生漏写。'}:gradeTeachingPoint(primaryNote?{...item,evidenceCodes:[]}:item,primaryNote?selectedNote??'':bySection[item.section],eventCodes,purpose);
    if(item.id==='diagnosis-evidence'&&item.section==='diagnosis'){
      const ratio=clinicalEvidenceRatio(session.decision?.diagnosisBasis??'',records);
      judgement={ratio,status:ratio===1?'achieved':ratio===.5?'partial':'missing',explanation:ratio===1?'依据中有来自不同环节的已获得临床信息；简洁表达即可。':ratio===.5?'已联系一类实际临床信息，尚需补充其他环节证据或解释。':'尚未定位到与实际取得记录一致的临床内容；仅写“病史、查体、检查”不算具体依据。'};
    }
    return {id:item.id,section:item.section,level:item.level,label:item.label,score:item.maxScore*judgement.ratio,maxScore:item.maxScore,status:judgement.status,explanation:judgement.explanation,example:item.fullAnswer};
  });
  const round=(n:number)=>Math.round(n*100)/100;
  const rawTotal=items.reduce((n,i)=>n+i.score,0),assessable=items.filter(i=>i.status!=='not_assessable').reduce((n,i)=>n+i.maxScore,0);
  const primarySnapshot=pack.rubricVersion==='note-primary-60-v1'?{rubricVersion:pack.rubricVersion,normalizedScore:assessable>0?round(rawTotal*100/assessable):null,...(items.some(i=>i.section==='note')?{noteProcessBreakdown:{noteScore:round(items.filter(i=>i.section==='note').reduce((n,i)=>n+i.score,0)),noteMax:round(items.filter(i=>i.section==='note'&&i.status!=='not_assessable').reduce((n,i)=>n+i.maxScore,0)),processScore:round(items.filter(i=>i.section!=='note').reduce((n,i)=>n+i.score,0)),processMax:round(items.filter(i=>i.section!=='note'&&i.status!=='not_assessable').reduce((n,i)=>n+i.maxScore,0))}}:{})}:{};
  return {...primarySnapshot,packageVersion:pack.version,totalScore:round(items.reduce((s,i)=>s+i.score,0)),basicScore:round(items.filter(i=>i.level==='basic').reduce((s,i)=>s+i.score,0)),advancedScore:round(items.filter(i=>i.level==='advanced').reduce((s,i)=>s+i.score,0)),basicMaxScore:round(items.filter(i=>i.level==='basic'&&i.status!=='not_assessable').reduce((s,i)=>s+i.maxScore,0)),advancedMaxScore:round(items.filter(i=>i.level==='advanced'&&i.status!=='not_assessable').reduce((s,i)=>s+i.maxScore,0)),assessableMaxScore:round(items.filter(i=>i.status!=='not_assessable').reduce((s,i)=>s+i.maxScore,0)),items,tests:pack.tests.map(test=>({label:test.label,requested:session.orderedTests.includes(test.id),requestCount:session.testRequests?.filter(r=>r.testId===test.id).length??(session.orderedTests.includes(test.id)?1:0),purposes:[...new Set(session.testRequests?.filter(r=>r.testId===test.id&&r.purpose).map(r=>r.purpose!)??[])],necessity:test.necessity,rationale:test.rationale,origin:test.origin})),materialSummary:{source:pack.tests.filter(t=>t.origin==='source'&&session.orderedTests.includes(t.id)).length,simulated:pack.tests.filter(t=>t.origin==='teaching-simulation'&&session.orderedTests.includes(t.id)).length,reference:pack.tests.filter(t=>t.origin==='reference'&&session.orderedTests.includes(t.id)).length},disclaimer:'本地教学练习反馈；完整量表基础80分、提高20分，专项仅评价对应环节。自动整理内容未医学审定。本分数独立于既有过程分与正式成绩；不可评价项不视为学生错误。'};
}
