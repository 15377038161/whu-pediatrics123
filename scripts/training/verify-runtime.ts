/** All 67 real local entries through the existing engine; no database or model calls. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {readTeachingPackage} from '../../src/lib/teaching-package-store';
import {buildReport} from '../../src/lib/scoring';
import {getCaseMediaLink} from '../../src/lib/case-media';
import {projectSessionForRole} from '../../src/lib/session-projection';
import {projectReportForRole} from '../../src/lib/report-projection';
import {ageMonths,instrumentApplicability} from '../../src/domain/exam-authoring-standard';
import {resolveDisplayedVitals} from '../../src/domain/vital-signs';
import {NOTE_TEMPLATE,normalizeNoteContent} from '../../src/domain/medical-note';
import type {AgentEvent,PracticeFocus,SessionState,TrainingReport} from '../../src/domain/agent';
import type {TeachingExam,TeachingPackage} from '../../src/domain/teaching-package';
import {
  decodeControlledTrainingContent,
  decodeControlledTrainingMediaArchiveSet,
  installRecoveredTrainingContent,
  type RecoveredTrainingMedia,
} from '../../src/lib/controlled-case-bundle';
import type {ControlledArchiveReference,ControlledTrainingContentReference} from '../../src/lib/controlled-case-registry';
process.env.ENABLE_AI_FIXTURE='true';

type ContentManifest={schemaVersion:number;entries:number;sources:number;media:number;files:Array<{path:string;archive:string}>};
type UploadManifest={archives:Array<{file:string;bytes:number;sha256:string}>};
type RuntimeContext={entries:Record<string,string>;recovered:boolean;mediaVerified:number;mediaCheck:'full'|'local-only'|'not-applicable';mediaIds:Set<string>|null};
type ExamAction=Extract<AgentEvent,{type:'EXAM_ACTION'}>['data'];
type WorkflowResult={session:SessionState;report:TrainingReport;exam:TeachingExam;examAction:ExamAction;mediaLinks:number};
const sevenSections=['history','exam','tests','diagnosis','plan','note','communication'];

function loadRecoveredRuntime():RuntimeContext|null{
  const recoveryRoot=process.env.PEDIATRICS_TRAINING_RECOVERY_ROOT;
  if(!recoveryRoot)return null;
  const archiveRoot=process.env.PEDIATRICS_TRAINING_ARCHIVE_ROOT;
  if(!archiveRoot)throw new Error('PEDIATRICS_TRAINING_ARCHIVE_REQUIRED');
  const manifest=JSON.parse(readFileSync(path.join(recoveryRoot,'content-manifest.json'),'utf8')) as ContentManifest;
  const upload=JSON.parse(readFileSync(path.join(archiveRoot,'peds-training-upload-manifest.json'),'utf8')) as UploadManifest;
  const archives=new Map(upload.archives.map(item=>[item.file,item]));
  const contentArchive=manifest.files.find(file=>file.path==='runtime/index.json')?.archive;
  if(!contentArchive)throw new Error('TRAINING_CONTENT_ARCHIVE_MISSING');
  const archiveReference=(file:string):ControlledArchiveReference=>{
    const item=archives.get(file);
    if(!item)throw new Error(`TRAINING_ARCHIVE_NOT_LISTED:${file}`);
    return {fileId:`local-recovery:${file}`,archive:file,bytes:item.bytes,sha256:item.sha256};
  };
  const mediaNames=[...new Set(manifest.files.filter(file=>file.path.startsWith('runtime/media/')).map(file=>file.archive))];
  const reference:ControlledTrainingContentReference={
    ...archiveReference(contentArchive),media:mediaNames.map(archiveReference),
    expected:{entries:manifest.entries,sources:manifest.sources,media:manifest.media},
  };
  const content=decodeControlledTrainingContent(readFileSync(path.join(archiveRoot,contentArchive)),reference);
  const groups=new Map<string,RecoveredTrainingMedia[]>();
  for(const descriptor of content.media.values()){
    const group=groups.get(descriptor.archive)??[];group.push(descriptor);groups.set(descriptor.archive,group);
  }
  const mediaCheck=process.env.PEDIATRICS_TRAINING_VERIFY_MEDIA==='local-only'?'local-only':'full';
  let mediaVerified=0;
  if(mediaCheck==='full'){
    for(const [archive,descriptors] of groups){
      const decoded=decodeControlledTrainingMediaArchiveSet(readFileSync(path.join(archiveRoot,archive)),archiveReference(archive),descriptors);
      mediaVerified+=decoded.size;
    }
    if(mediaVerified!==content.media.size||groups.size!==mediaNames.length)throw new Error('TRAINING_MEDIA_COUNT_INVALID');
  }
  installRecoveredTrainingContent(content,reference);
  process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=path.join(recoveryRoot,'runtime');
  process.env.PEDIATRICS_KNOWLEDGE_ROOT=recoveryRoot;
  return {entries:content.entries,recovered:true,mediaVerified,mediaCheck,mediaIds:new Set(content.media.keys())};
}

async function verifyReleasedMedia(session:{events:Array<{media?:Array<{fileId:string}>}>}):Promise<number>{
  let count=0;
  for(const event of session.events)for(const media of event.media??[]){
    const link=await getCaseMediaLink(media.fileId);assert.ok(link.url);count+=1;
  }
  return count;
}

function applicableExam(pack:TeachingPackage):{exam:TeachingExam;action:ExamAction}{
  const exam=pack.exams.find(item=>item.origin==='source'&&instrumentApplicability(item.toolId,item.bodyPartId,ageMonths(pack.age)).status!=='not_applicable')
    ??pack.exams.find(item=>instrumentApplicability(item.toolId,item.bodyPartId,ageMonths(pack.age)).status!=='not_applicable');
  assert.ok(exam,'APPLICABLE_EXAM_MISSING');
  const position=exam.allowedPositions?.[0]??exam.postures[0];
  return {exam,action:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:position==='standing'?'standing':'supine',position,location:{side:exam.bodyPartId.startsWith('left-')?'left':exam.bodyPartId.startsWith('right-')?'right':'both',aspect:exam.aspect??'front'}}};
}

function referenceSubmission(pack:TeachingPackage){
  const noteSections=normalizeNoteContent(pack.referenceNote);
  const noteText=NOTE_TEMPLATE.filter(section=>noteSections[section.key].trim()).map(section=>`${section.label}：${noteSections[section.key]}`).join('；');
  const diagnosis=noteSections.preliminaryDiagnosis.trim()||pack.title;
  const diagnosisBasis=[noteSections.presentIllness,noteSections.physicalExam,noteSections.auxiliaryTests].filter(Boolean).join('；')||`依据本例已取得的病史、查体及辅助检查记录，对${pack.complaint}进行综合分析。`;
  const plan=noteSections.treatmentPlan.trim()||pack.management.map(item=>`${item.title}：${item.detail}`).join('；')||'依据本例原始诊疗记录进行处置，并持续观察病情变化。';
  return {noteSections,noteText,decision:{diagnosis,diagnosisBasis,summary:`${pack.complaint}；${noteSections.presentIllness}`.slice(0,4000),differentials:noteSections.differentialDiagnosis},plan:{priority:plan.slice(0,500),detail:plan}};
}

async function navigate(session:SessionState,stage:Extract<AgentEvent,{type:'NAVIGATE_STAGE'}>['data']['stage'],id:string){
  await runAgentTurn(session,{type:'NAVIGATE_STAGE',data:{stage}},id);
}

async function performExam(session:SessionState,pack:TeachingPackage,prefix:string,checkWrongTool=true){
  if(checkWrongTool){
    await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'axillary-thermometer',bodyPartId:'forehead',posture:'supine',position:'supine'}},`${prefix}-wrong-tool`);
    assert.equal(session.events.at(-1)?.correct,false,'WRONG_TOOL_WAS_ACCEPTED');
  }
  await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands',posture:'supine',position:'supine'}},`${prefix}-prep`);
  const {exam,action}=applicableExam(pack);
  await runAgentTurn(session,{type:'EXAM_ACTION',data:action},`${prefix}-exam`);
  assert.equal(session.events.at(-1)?.correct,true,'EXAM_WAS_REJECTED');
  const measurementEvent=session.events.at(-1);
  assert.equal(measurementEvent?.type,'EXAM_ACTION');
  assert.deepEqual(measurementEvent?.measurements?.map(item=>item.metric)??[],exam.measurements?.map(item=>item.metric)??[],'STRUCTURED_MEASUREMENT_RELEASE_MISMATCH');
  const displayed=resolveDisplayedVitals(session);
  for(const measurement of measurementEvent?.measurements??[])assert.equal(displayed[measurement.metric].value,measurement.value,`MEASURED_VITAL_NOT_UPDATED:${measurement.metric}`);
  const eventCount=session.events.length;
  const repeated=await runAgentTurn(session,{type:'EXAM_ACTION',data:action},`${prefix}-repeat`);
  assert.equal(repeated.repeated,true,'REPEAT_EXAM_NOT_SUPPRESSED');
  assert.equal(session.events.length,eventCount,'REPEAT_EXAM_ADDED_EVENT');
  return {exam,action};
}

function assertTeachingReport(report:TrainingReport,pack:TeachingPackage,expectSevenSections:boolean){
  const feedback=report.teachingFeedback;assert.ok(feedback,'TEACHING_FEEDBACK_MISSING');
  assert.equal(feedback.packageVersion,pack.version,'REPORT_PACKAGE_VERSION_MISMATCH');
  assert.equal(feedback.rubricVersion,'note-primary-60-v1','RUBRIC_VERSION_MISMATCH');
  assert.ok(Math.abs(pack.rubric.filter(item=>item.level==='basic').reduce((sum,item)=>sum+item.maxScore,0)-80)<1e-8,'BASIC_RUBRIC_MAX_MISMATCH');
  assert.ok(Math.abs(pack.rubric.filter(item=>item.level==='advanced').reduce((sum,item)=>sum+item.maxScore,0)-20)<1e-8,'ADVANCED_RUBRIC_MAX_MISMATCH');
  assert.ok((feedback.basicMaxScore??0)<=80,'BASIC_ASSESSABLE_MAX_EXCEEDS_SCALE');
  assert.ok((feedback.advancedMaxScore??0)<=20,'ADVANCED_ASSESSABLE_MAX_EXCEEDS_SCALE');
  assert.ok((feedback.assessableMaxScore??0)<=100,'ASSESSABLE_MAX_EXCEEDS_SCALE');
  if(expectSevenSections){
    assert.deepEqual([...new Set(feedback.items.map(item=>item.reportSection??item.section))].sort(),[...sevenSections].sort(),'SEVEN_SECTION_REPORT_INCOMPLETE');
    const breakdown=feedback.noteProcessBreakdown;assert.ok(breakdown,'NOTE_PROCESS_BREAKDOWN_MISSING');
    assert.equal(breakdown.noteMax,60,'NOTE_MAX_MISMATCH');
    assert.ok(breakdown.processMax<=40,'PROCESS_MAX_MISMATCH');
    assert.ok(report.studentSubmissions?.decision?.diagnosis,'DECISION_SNAPSHOT_MISSING');
    assert.ok(report.studentSubmissions.plan?.detail,'PLAN_SNAPSHOT_MISSING');
  }
  return feedback;
}

async function runFullWorkflow(mode:'guided'|'osce',pack:TeachingPackage):Promise<WorkflowResult>{
  const session=createInitialSession(`local-${mode}-validation`,mode,pack.caseId,undefined,pack.sourceVersion);
  assert.equal(session.teachingPackageVersion,pack.version,'TEACHING_PACKAGE_VERSION_MISMATCH');
  const studentProjection=projectSessionForRole(session,'student');
  assert.equal(studentProjection.caseOptions?.tests.length,0,'STUDENT_TEST_CATALOG_LEAK');
  assert.equal(studentProjection.caseOptions?.exams.length,0,'STUDENT_EXAM_MAPPING_LEAK');
  const studentProjectionJson=JSON.stringify(studentProjection);
  for(const privateField of ['"rubric"','"referenceNote"','"fullAnswer"','"partialAnswer"'])assert.equal(studentProjectionJson.includes(privateField),false,`STUDENT_PRIVATE_FIELD_LEAK:${privateField}`);
  if(mode==='osce')await assert.rejects(()=>runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'osce-early-exam'),/OSCE_EVENT_STAGE_FORBIDDEN/);
  const question=pack.questions[0]?.prompt??'最早什么时候开始不舒服？';
  await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:question}},`${mode}-question`);
  if(mode==='osce')await navigate(session,'exam','osce-enter-exam');
  const {exam,action}=await performExam(session,pack,mode);
  if(mode==='osce')await navigate(session,'tests','osce-enter-tests');
  const check=pack.tests.find(item=>item.origin==='source')??pack.tests[0];assert.ok(check,'TEST_MISSING');
  await runAgentTurn(session,{type:'ORDER_TEST',data:{requestedTests:check.label,reason:'用于诊断、鉴别和病情评估，并结合已取得结果综合判断'}},`${mode}-test`);
  assert.ok(session.orderedTests.includes(check.id),'TEST_NOT_RELEASED');
  const mediaLinks=mode==='guided'?await verifyReleasedMedia(session):0;
  if(mode==='osce')await assert.rejects(()=>navigate(session,'history','osce-backtrack'),/OSCE_STAGE_BACKTRACK_FORBIDDEN/);
  if(mode==='osce')await navigate(session,'assessment','osce-enter-assessment');
  const submitted=referenceSubmission(pack);
  await runAgentTurn(session,{type:'SUBMIT_DECISION',data:submitted.decision},`${mode}-decision`);
  if(mode==='osce')await navigate(session,'plan','osce-enter-plan');
  await runAgentTurn(session,{type:'SUBMIT_PLAN',data:submitted.plan},`${mode}-plan`);
  if(mode==='osce')await navigate(session,'communication','osce-enter-communication');
  const communication='我理解您的担心，孩子的病情需要结合已经获得的病史和检查继续评估，可能出现危险变化。下一步先按诊疗计划处理并监测，有变化请及时告诉我。';
  await runAgentTurn(session,{type:'SEND_COMMUNICATION',data:{text:communication}},`${mode}-communication`);
  assert.ok(session.communication?.includes('下一步'),'COMMUNICATION_NOT_SAVED');
  const restored=JSON.parse(JSON.stringify(session)) as SessionState;
  const restoredCount=restored.events.length;
  const restoredRepeat=await runAgentTurn(restored,{type:'EXAM_ACTION',data:action},`${mode}-restored-repeat`);
  assert.equal(restoredRepeat.repeated,true,'RESTORED_REPEAT_EXAM_NOT_SUPPRESSED');
  assert.equal(restored.events.length,restoredCount,'RESTORED_REPEAT_EXAM_ADDED_EVENT');
  await runAgentTurn(restored,{type:'FINISH_SESSION',data:{}},`${mode}-finish`);
  assert.equal(restored.status,'completed');assert.equal(restored.stage,'report');
  const report=buildReport(restored,restored.id,{diagnosis:submitted.decision.diagnosis,plan:submitted.plan.detail,noteText:submitted.noteText,noteSections:submitted.noteSections});
  assertTeachingReport(report,pack,true);
  assert.equal(report.sourceSnapshotVersion,pack.sourceVersion,'REPORT_SOURCE_VERSION_MISMATCH');
  assert.equal(report.studentSubmissions?.communication,communication,'COMMUNICATION_SNAPSHOT_MISMATCH');
  const teacherReport=projectReportForRole(report,'teacher');
  const studentReport=projectReportForRole(report,'student');
  assert.ok(teacherReport.evidence.some(item=>item.code==='SOURCE_DIAGNOSIS_REFERENCE'),'TEACHER_REFERENCE_MISSING');
  assert.ok(studentReport.evidence.every(item=>item.code!=='SOURCE_DIAGNOSIS_REFERENCE'&&item.code!=='SOURCE_PLAN_REFERENCE'),'STUDENT_REFERENCE_LEAK');
  assert.deepEqual(studentReport.studentSubmissions,teacherReport.studentSubmissions,'ROLE_PROJECTION_MUTATED_SUBMISSIONS');
  assert.equal(studentReport.totalScore,teacherReport.totalScore,'ROLE_PROJECTION_CHANGED_SCORE');
  return {session:restored,report,exam,examAction:action,mediaLinks};
}

async function runPractice(focus:PracticeFocus,pack:TeachingPackage):Promise<TrainingReport>{
  const session=createInitialSession(`local-practice-${focus}`,'practice',pack.caseId,focus,pack.sourceVersion);
  const submitted=referenceSubmission(pack);
  if(focus==='history'){
    await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:pack.questions[0]?.prompt??'孩子什么时候开始出现不适？'}},'practice-history-question');
    await runAgentTurn(session,{type:'SUBMIT_HISTORY_SUMMARY',data:{summary:[submitted.noteSections.chiefComplaint,submitted.noteSections.presentIllness].filter(Boolean).join('；')||'已完成本例病史采集并保留原始问答。'}},'practice-history-summary');
  }else if(focus==='exam'){
    const {exam}=await performExam(session,pack,'practice-exam',false);
    await runAgentTurn(session,{type:'SUBMIT_EXAM_OBSERVATION',data:{findings:exam.result,interpretation:'结合本例已经取得的查体所见进行记录，医学解释留待教师复核。',linkedEvidence:[exam.evidenceCode]}},'practice-exam-observation');
  }else if(focus==='safety'){
    await runAgentTurn(session,{type:'SUBMIT_DECISION',data:submitted.decision},'practice-safety-decision');
    await runAgentTurn(session,{type:'SUBMIT_PLAN',data:submitted.plan},'practice-safety-plan');
  }else{
    await runAgentTurn(session,{type:'SEND_COMMUNICATION',data:{text:'我理解您的担心，目前需要结合病情评估可能的风险。下一步先按既定计划处理并观察，有变化及时复诊。'}},'practice-communication');
    assert.ok(session.communication,'PRACTICE_COMMUNICATION_NOT_SAVED');
  }
  await runAgentTurn(session,{type:'FINISH_SESSION',data:{}},`practice-${focus}-finish`);
  const report=buildReport(session,session.id);
  assert.equal(report.practiceFocus,focus,'PRACTICE_FOCUS_REPORT_MISMATCH');
  const feedback=assertTeachingReport(report,pack,false);
  const allowed:Record<PracticeFocus,string[]>={history:['history'],exam:['exam'],safety:['diagnosis','plan'],communication:['communication']};
  assert.ok(feedback.items.every(item=>allowed[focus].includes(item.section)),`PRACTICE_SECTION_LEAK:${focus}`);
  if(focus==='history')assert.ok(report.studentSubmissions?.historySummary,'HISTORY_SUMMARY_SNAPSHOT_MISSING');
  if(focus==='exam')assert.equal(report.studentSubmissions?.examObservation?.caseVersion,session.caseVersion,'EXAM_OBSERVATION_VERSION_MISSING');
  if(focus==='safety')assert.ok(report.studentSubmissions?.decision&&report.studentSubmissions.plan,'SAFETY_SNAPSHOT_MISSING');
  if(focus==='communication')assert.ok(report.studentSubmissions?.communication,'COMMUNICATION_PRACTICE_SNAPSHOT_MISSING');
  return report;
}

async function main(){
  const recovered=loadRecoveredRuntime();
  const index=recovered??{entries:(JSON.parse(readFileSync('knowledge/training-packages/index.json','utf8')) as {entries:Record<string,string>}).entries,recovered:false,mediaVerified:0,mediaCheck:'not-applicable' as const,mediaIds:null};
  const onlyCase=process.env.PEDIATRICS_TRAINING_VERIFY_CASE;
  const entries=Object.entries(index.entries).filter(([caseId])=>!onlyCase||caseId===onlyCase);
  if(onlyCase&&entries.length!==1)throw new Error('VERIFY_CASE_NOT_IN_RUNTIME_INDEX');
  const results:Array<Record<string,unknown>>=[];
  for(const [caseId,version] of entries){
    let sourceSnapshotVersion:string|null=null;
    try{
      const pack=readTeachingPackage(caseId,version);assert.ok(pack,'TEACHING_PACKAGE_MISSING');
      sourceSnapshotVersion=pack.sourceVersion;
      const packageMedia=[...pack.exams,...pack.tests].flatMap(item=>item.media??[]);
      const intakeSpo2=pack.intake?.initialVitals.find(item=>item.code==='spo2');
      const expectedSpo2Origin=intakeSpo2?.status==='recorded'?'source':'teaching-simulation';
      const oximeterExams=pack.exams.filter(item=>item.toolId==='oximeter');
      const spo2Measurements=oximeterExams.flatMap(item=>item.measurements??[]).filter(item=>item.metric==='spo2');
      assert.ok(oximeterExams.length>0,'OXIMETER_OPERATION_MISSING');
      assert.ok(spo2Measurements.length>0,'STRUCTURED_SPO2_MISSING');
      assert.ok(spo2Measurements.every(item=>item.origin===expectedSpo2Origin),`SPO2_ORIGIN_MISMATCH:${expectedSpo2Origin}`);
      if(index.mediaIds)for(const media of packageMedia)if(media.fileId.startsWith('training-media:'))assert.ok(index.mediaIds.has(media.fileId.slice('training-media:'.length)),'PACKAGE_MEDIA_NOT_IN_MANIFEST');
      if(process.env.PEDIATRICS_TRAINING_REQUIRE_INTAKE==='true')assert.ok(pack.intake,'INTAKE_REQUIRED');
      if(pack.intake){
        const projected=projectSessionForRole(createInitialSession('local-intake-validation','guided',caseId,undefined,pack.sourceVersion),'student');
        assert.deepEqual(projected.caseOptions?.intake,pack.intake,'STUDENT_INTAKE_PROJECTION');
        assert.equal(pack.intake.initialVitals.length,4,'INTAKE_VITAL_COUNT');
        assert.ok(pack.intake.initialVitals.every(vital=>vital.status==='recorded'?vital.value!==null:vital.value===null),'INTAKE_MISSING_VALUE_LEAK');
        assert.equal(pack.intake.initialVitals.filter(vital=>vital.status==='not-recorded-in-source').length,4-pack.intake.initialVitals.filter(vital=>vital.status==='recorded').length,'INTAKE_VITAL_BASELINE_DRIFT');
      }
      const guided=await runFullWorkflow('guided',pack);
      const osce=await runFullWorkflow('osce',pack);
      const practiceReports={history:await runPractice('history',pack),exam:await runPractice('exam',pack),safety:await runPractice('safety',pack),communication:await runPractice('communication',pack)};
      const feedback=guided.report.teachingFeedback!;
      results.push({caseId,title:pack.title,version,teachingPackageVersion:version,sourceSnapshotVersion:pack.sourceVersion,
        intake:pack.intake?{anonymousPatientId:pack.intake.patient.anonymousId.value,vitals:pack.intake.initialVitals.length,pending:pack.intake.additionalMeasurements.length}:null,
        flows:{guided:true,osce:true,historyPractice:practiceReports.history.practiceFocus==='history',examPractice:practiceReports.exam.practiceFocus==='exam',safetyPractice:practiceReports.safety.practiceFocus==='safety',communicationPractice:practiceReports.communication.practiceFocus==='communication'},
        submissions:{diagnosis:true,treatment:true,communication:true,medicalNote:true,immutableSnapshot:true},
        rubric:{version:feedback.rubricVersion,rawScore:feedback.totalScore,assessableMaxScore:feedback.assessableMaxScore,normalizedScore:feedback.normalizedScore,basicMaxScore:feedback.basicMaxScore,advancedMaxScore:feedback.advancedMaxScore,noteProcessBreakdown:feedback.noteProcessBreakdown,sevenSections:true},
        roleEvidence:{studentCatalogHidden:true,studentAnswerHidden:true,teacherReferenceVisible:true,studentReferenceHidden:true,scoreImmutableAcrossRoles:true},
        structuredMeasurements:{total:pack.exams.flatMap(item=>item.measurements??[]).length,spo2Values:spo2Measurements.map(item=>item.value),spo2Origin:expectedSpo2Origin,runtimeTextExtraction:false},
        mediaReferences:packageMedia.length,mediaLinks:guided.mediaLinks,passed:true,events:guided.session.events.length});
    }catch(error){results.push({caseId,version,teachingPackageVersion:version,sourceSnapshotVersion,passed:false,errorKind:error instanceof Error?error.name:'unknown',error:error instanceof Error?error.message:'unknown'});}
  }
  const output=process.env.PEDIATRICS_TRAINING_VERIFY_OUTPUT??(recovered?'outputs/training-20261107/runtime-validation-recovered.json':'outputs/training-20261107/runtime-validation.json');
  mkdirSync(path.dirname(output),{recursive:true});
  const summary={mode:recovered?'isolated-recovery':'local',entries:results.length,passed:results.filter(r=>r.passed).length,mediaVerified:index.mediaVerified,mediaCheck:index.mediaCheck,
    acceptanceBoundary:{databaseWrites:0,realModelCalls:0,realBrowserFlows:0,inputFixture:'installed-reference-note',scoresRepresentStudentPerformance:false,note:'本地确定性引擎、资料、评分和角色投影验收；不代表真实页面、真实模型或学生临床成绩。'},results};
  writeFileSync(output,JSON.stringify(summary,null,2));
  console.log(JSON.stringify({mode:summary.mode,entries:summary.entries,passed:summary.passed,mediaVerified:summary.mediaVerified,mediaCheck:summary.mediaCheck,output,failed:results.filter(r=>!r.passed).map(r=>({caseId:r.caseId,errorKind:r.errorKind,error:r.error}))}));
  if(results.some(r=>!r.passed))process.exitCode=1;
}
void main();
