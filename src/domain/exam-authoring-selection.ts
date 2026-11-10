/** 制作期显式选值编译，不是运行时推测或第二查体引擎。 */
import {z} from 'zod';
import {instrumentApplicability} from './exam-authoring-standard';
import {ageMonths} from './exam-authoring-standard';
import {teachingPackageSchema,type TeachingPackage} from './teaching-package';
export const examSelectionItemSchema=z.object({
 id:z.string(),state:z.enum(['normal','abnormal','mixed']),
 result:z.string().trim().min(15).max(5000),
 rationale:z.string().trim().min(10),
 origin:z.literal('teaching-simulation'),
});
export type ExamSelectionItem=z.infer<typeof examSelectionItemSchema>;
export const examSelectionSchema=z.object({
 caseId:z.string(),sourceVersion:z.string(),inputTeachingVersion:z.string(),
 selections:z.array(examSelectionItemSchema).min(1),
}).strict();
export type ExamSelection=z.infer<typeof examSelectionSchema>;
export function applyExamSelections(input:TeachingPackage,value:unknown):TeachingPackage{
 const selections=examSelectionSchema.parse(value);
 if(selections.caseId!==input.caseId||selections.sourceVersion!==input.sourceVersion||selections.inputTeachingVersion!==input.version)throw Error('AUTHORING_BINDING_MISMATCH');
 const output=structuredClone(input),seen=new Set<string>();
 for(const selection of selections.selections){
  if(seen.has(selection.id))throw Error('DUPLICATE_SELECTION');seen.add(selection.id);
  const exam=output.exams.find(row=>row.id===selection.id);
  if(!exam)throw Error('UNKNOWN_SELECTION');
  if(exam.origin==='source')throw Error('SOURCE_ROW_IS_IMMUTABLE');
  if(exam.origin!=='reference')throw Error('EXISTING_TEACHING_RESULT_IS_IMMUTABLE');
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,ageMonths(input.age)).status==='not_applicable')throw Error('NOT_APPLICABLE_SELECTION');
  if(/资料未提供|未获得结果|仅供参考/.test(selection.result))throw Error('INDEPENDENT_RESULT_REQUIRED');
  exam.result=selection.result;exam.origin='teaching-simulation';exam.scope='local';
  exam.sourceLocator='固定教学模拟：经逐例显式选值；非原患者新增实测；未医学审定';
 }
 // 版本由既有teachingPackageVersion在制作脚本里重算，不能冒用输入版本。
 output.version='';return teachingPackageSchema.parse(output);
}

/** 整体原始记录只允许追加独立局部教学补充，原文及其来源关系保持逐字不变。 */
export function applyExamLocalSupplements(input:TeachingPackage,value:unknown):TeachingPackage{
 const selections=examSelectionSchema.parse(value);
 if(selections.caseId!==input.caseId||selections.sourceVersion!==input.sourceVersion||selections.inputTeachingVersion!==input.version)throw Error('AUTHORING_BINDING_MISMATCH');
 const output=structuredClone(input),seen=new Set<string>();
 for(const selection of selections.selections){
  if(seen.has(selection.id))throw Error('DUPLICATE_SELECTION');seen.add(selection.id);
  const exam=output.exams.find(row=>row.id===selection.id);
  if(!exam)throw Error('UNKNOWN_SELECTION');
  if(exam.origin!=='source'||exam.scope!=='whole-region')throw Error('LOCAL_SUPPLEMENT_REQUIRES_WHOLE_SOURCE');
  if(exam.localSupplement)throw Error('LOCAL_SUPPLEMENT_ALREADY_EXISTS');
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,ageMonths(input.age)).status==='not_applicable')throw Error('NOT_APPLICABLE_SELECTION');
  if(/资料未提供|未获得结果|仅供参考/.test(selection.result))throw Error('INDEPENDENT_RESULT_REQUIRED');
  exam.localSupplement={
   result:selection.result,rationale:selection.rationale,state:selection.state,
   origin:'teaching-simulation',scope:'local',reviewStatus:'automated-unreviewed',
   sourceLocator:'固定局部教学补充：经逐例显式选值；非原患者新增实测；未医学审定',
  };
 }
 output.version='';return teachingPackageSchema.parse(output);
}
