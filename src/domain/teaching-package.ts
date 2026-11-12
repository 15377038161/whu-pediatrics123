import {NOTE_SECTION_KEYS, type NoteSectionKey} from './medical-note';
import {notePrimaryErrors} from './note-primary-contract';
import {labReportSchema} from './lab-report';
import { z } from 'zod';
import { sourceExamRuleSchema } from './source-exam-contract';
import { caseIntakeSchema } from './case-intake';
import { fixedVitalMeasurementSchema } from './vital-measurement';
import { measurementContractSchema } from './structured-measurement';

export const teachingOriginSchema = z.enum(['source','teaching-simulation','reference']);
export const historyFactSchema = z.object({
  id:z.string(), text:z.string().min(1), topics:z.array(z.string()), sourceLocator:z.string(),
  origin:teachingOriginSchema, actor:z.enum(['parent','child','mixed']), childText:z.string().optional(),
  timeContext:z.string().optional(),values:z.array(z.object({value:z.string(),unit:z.string()})).optional(),negativeTerms:z.array(z.string()).optional(),
  availableFromStage:z.enum(['triage','history','exam','tests','assessment','plan','communication','report']).optional(),
});
export type HistoryFact = z.infer<typeof historyFactSchema>;
const mediaSchema=z.object({fileId:z.string(),kind:z.literal('image'),caption:z.string()});
export const examLocalSupplementSchema=z.object({
  result:z.string().trim().min(15).max(5000),
  rationale:z.string().trim().min(10).max(1000),
  state:z.enum(['normal','abnormal','mixed']),
  origin:z.literal('teaching-simulation'),scope:z.literal('local'),
  sourceLocator:z.string().trim().min(1).max(300),reviewStatus:z.literal('automated-unreviewed'),
}).strict();
export const teachingExamApplicabilitySchema=z.object({status:z.enum(['applicable','conditional','not_applicable']),reason:z.string().optional()}).optional();
export const teachingExamSchema=sourceExamRuleSchema.extend({
  id:z.string(), evidenceCode:z.string(), origin:teachingOriginSchema,
  technique:z.string(), reaction:z.string(), interpretation:z.string(),
  allowedPositions:z.array(z.enum(['standing','supine','sitting','lateral','prone'])).optional(),
  scope:z.enum(['local','whole-region','reference']), aspect:z.enum(['front','back']).optional(),
  /** 固定病例测量定义；实际 measuredAt 只在学生成功操作时写入会话事件。 */
  measurements:z.array(fixedVitalMeasurementSchema).max(4).optional(),
  applicability:teachingExamApplicabilitySchema,
  /** Author-side numeric parameters remain bound to the exact exam, never inferred from prose. */
  fixedParameters:z.record(z.string(),z.unknown()).optional(),
  media:z.array(mediaSchema).default([]),localSupplement:examLocalSupplementSchema.optional(),
}).superRefine((exam,ctx)=>{
  if(exam.localSupplement&&(exam.origin!=='source'||exam.scope!=='whole-region'))ctx.addIssue({
    code:z.ZodIssueCode.custom,path:['localSupplement'],message:'LOCAL_SUPPLEMENT_REQUIRES_WHOLE_SOURCE',
  });
  const metrics=new Set<string>();
  for(const [index,measurement] of (exam.measurements??[]).entries()){
    if(measurement.origin!==exam.origin)ctx.addIssue({code:'custom',path:['measurements',index,'origin'],message:'MEASUREMENT_ORIGIN_MUST_MATCH_EXAM'});
    if(metrics.has(measurement.metric))ctx.addIssue({code:'custom',path:['measurements',index,'metric'],message:'DUPLICATE_MEASUREMENT_METRIC'});
    metrics.add(measurement.metric);
  }
});
export const teachingTestSchema=z.object({
  report:labReportSchema.optional(),
  id:z.string(),label:z.string(),aliases:z.array(z.string()).default([]),result:z.string(),
  origin:teachingOriginSchema, objective:z.string(),reference:z.string(),
  necessity:z.enum(['essential','optional','not-routine','context-dependent']),rationale:z.string(),
  sourceLocator:z.string(),media:z.array(mediaSchema).default([]),
});
export const rubricSectionSchema=z.enum(['history','exam','tests','diagnosis','plan','note','communication']);
export const teachingRubricItemSchema=z.object({
  noteSection:z.enum(NOTE_SECTION_KEYS).optional(),noteComponent:z.enum(['diagnosis','basis']).optional(),
  /** Display grouping only. Scoring always uses section, so note-primary 60/40 cannot drift. */
  reportSection:rubricSectionSchema.optional(),
  id:z.string(),section:rubricSectionSchema,level:z.enum(['basic','advanced']),label:z.string(),maxScore:z.number().positive(),
  concepts:z.array(z.array(z.string()).min(1)).default([]),evidenceCodes:z.array(z.string()).default([]),
  fullAnswer:z.string(),partialAnswer:z.string(),incorrectAnswer:z.string(),
  safetyCritical:z.boolean().default(false),sourceLocator:z.string(),
  unsafePhrases:z.array(z.string()).default([]),
  partialConcepts:z.array(z.array(z.string())).optional(),
});
export const teachingPackageSchema=z.object({
  schemaVersion:z.literal(1),caseId:z.string(),sourceId:z.string(),sourceVersion:z.string(),version:z.string(),rubricVersion:z.literal('note-primary-60-v1').optional(),
  relation:z.enum(['independent','alias','subtype']),relationNote:z.string().optional(),title:z.string(),age:z.string(),sex:z.string(),
  reviewStatus:z.literal('automated-unreviewed'),complaint:z.string(),
  /** Optional only for historical packages. New generations bind the exact triage disclosure set. */
  intake:caseIntakeSchema.optional(),
  persona:z.object({appearance:z.string(),caregiver:z.string(),speaking:z.string(),cooperation:z.string(),knowledgeBoundary:z.string()}),
  roleState:z.object({childCanSpeak:z.boolean(),reason:z.string(),sourceLocator:z.string()}).optional(),
  appearanceAssets:z.array(z.object({assetId:z.string(),posture:z.enum(['standing','supine']),publicPath:z.string()})).optional(),
  historyFacts:z.array(historyFactSchema),exams:z.array(teachingExamSchema),tests:z.array(teachingTestSchema),
  /** Version-pinned author measurement contracts; absent only on historical packages. */
  measurementContracts:z.array(measurementContractSchema).max(16).optional(),
  questions:z.array(z.object({topic:z.string(),prompt:z.string(),variants:z.array(z.string()),followups:z.array(z.string()),factIds:z.array(z.string()),parentAnswer:z.string(),childAnswer:z.string(),unavailable:z.string()})).default([]),
  management:z.array(z.object({title:z.string(),detail:z.string(),origin:teachingOriginSchema,sourceLocator:z.string()})),
  referenceNote:z.record(z.string(),z.string()),rubric:z.array(teachingRubricItemSchema),
  references:z.array(z.object({title:z.string(),url:z.string(),accessedAt:z.string()})),
}).superRefine((pack,ctx)=>{if(pack.rubricVersion==='note-primary-60-v1')for(const message of notePrimaryErrors(pack.rubric))ctx.addIssue({code:'custom',path:['rubric'],message});});
export type TeachingPackage=z.infer<typeof teachingPackageSchema>;
export type TeachingExam=z.infer<typeof teachingExamSchema>;
export type TeachingTest=z.infer<typeof teachingTestSchema>;
export type TeachingRubricItem=z.infer<typeof teachingRubricItemSchema>;
export interface TeachingFeedback {
  packageVersion:string;totalScore:number;basicScore:number;advancedScore:number;assessableMaxScore:number;
  basicMaxScore?:number;advancedMaxScore?:number;
  rubricVersion?:'note-primary-60-v1';normalizedScore?:number|null;
  noteProcessBreakdown?:{noteScore:number;noteMax:number;processScore:number;processMax:number};
  items:Array<{id:string;section:string;reportSection?:TeachingRubricItem['section'];level:string;label:string;noteSection?:NoteSectionKey;noteComponent?:'diagnosis'|'basis';score:number;maxScore:number;status:'achieved'|'partial'|'missing'|'incorrect'|'not_assessable';explanation:string;example:string}>;
  tests:Array<{label:string;requested:boolean;requestCount?:number;purposes?:string[];necessity:TeachingTest['necessity'];rationale:string;origin:TeachingTest['origin']}>;
  materialSummary:{source:number;simulated:number;reference:number};
  disclaimer:string;
}
