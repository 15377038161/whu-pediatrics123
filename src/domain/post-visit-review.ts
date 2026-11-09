import {z} from 'zod';

export const REVIEW_STAGES=['history','exam','tests','diagnosis','plan','note','communication'] as const;
const stage=z.enum(REVIEW_STAGES);
const citation=z.object({evidenceId:z.string().max(150),quote:z.string().min(1).max(600)}).strict();
export const postVisitReviewSchema=z.object({
  summary:z.string().min(1).max(2400),
  priorities:z.array(z.object({stage,title:z.string().min(1).max(120),reason:z.string().min(1).max(1200),action:z.string().min(1).max(1200),citations:z.array(citation).max(6)}).strict()).min(1).max(5),
  stages:z.array(z.object({stage,strengths:z.array(z.string().max(1000)).max(8),gaps:z.array(z.string().max(1000)).max(8),nextSteps:z.array(z.string().max(1000)).min(1).max(8),citations:z.array(citation).max(12)}).strict()).length(7),
}).strict().superRefine((review,ctx)=>{
  if(new Set(review.stages.map(item=>item.stage)).size!==7)ctx.addIssue({code:'custom',message:'Seven unique stages required'});
});
export type PostVisitReview=z.infer<typeof postVisitReviewSchema>;
export interface SavedPostVisitReview {
  reportId:string;sourceVersion:string|null;teachingVersion:string|null;
  inputHash:string;promptVersion:string;model:string;generatedAt:string;content:PostVisitReview;
  attempts?:number;durationMs?:number;
}
