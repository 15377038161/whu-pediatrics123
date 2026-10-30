import { z } from 'zod';

/** Neutral anatomy is independent of the selected tool and of a case's answer matrix. */
export const EXAM_LOCATIONS = [
  ['forehead','头面'], ['mouth','口咽'], ['neck','颈部'], ['chest','胸部'],
  ['upper-arm','上臂'], ['skin','皮肤'], ['abdomen','腹部'], ['finger','手指'], ['hands','双手'], ['limbs','四肢'],
] as const;
export const SOURCE_EXAM_TOOL_IDS = ['stethoscope','thermometer','oximeter','bp-cuff','tongue-depressor','flashlight','inspection','palpation','percussion','reflex-hammer'] as const;
export const sourceExamRuleSchema = z.object({
  toolId: z.enum(SOURCE_EXAM_TOOL_IDS),
  bodyPartId: z.enum(['forehead','mouth','neck','chest','upper-arm','skin','abdomen','finger','hands','limbs']),
  label: z.string().trim().min(1).max(80),
  result: z.string().trim().min(1).max(5000),
  postures: z.array(z.enum(['standing','supine'])).min(1).max(2),
  sourceLocator: z.string().trim().min(1).max(300),
}).strict();
export const sourceExamRulesSchema = z.array(sourceExamRuleSchema).max(64).superRefine((rules,ctx)=>{
  const keys=new Set<string>();
  rules.forEach((rule,index)=>{
    const key=`${rule.toolId}:${rule.bodyPartId}`;
    if(keys.has(key))ctx.addIssue({code:'custom',path:[index],message:'同一器材和部位只能定义一次，请在postures中合并适用体位'});
    if(new Set(rule.postures).size!==rule.postures.length)ctx.addIssue({code:'custom',path:[index,'postures'],message:'体位不能重复'});
    keys.add(key);
  });
});
export type SourceExamRule = z.infer<typeof sourceExamRuleSchema>;
