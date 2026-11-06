import { z } from 'zod';

/** Neutral anatomy is independent of the selected tool and of a case's answer matrix.
 *  旧部位 id 一律不改名：在飞会话的 unlockedEvidence 与已存报告快照按原证据码读取。 */
export const EXAM_LOCATIONS = [
  ['forehead','头面前囟'], ['eyes','眼与结膜'], ['ears','耳'], ['nose','鼻'], ['mouth','口咽'], ['neck','颈部'], ['lymph-nodes','浅表淋巴结'],
  ['chest','胸廓胸壁'], ['chest-lung','肺野'], ['chest-heart','心前区'], ['breast','乳房'],
  ['abdomen','腹部'], ['liver-spleen','肝脾'], ['groin','腹股沟'],
  ['limbs','四肢'], ['joints','关节'], ['spine','脊柱'], ['neuro','神经系统'],
  ['skin','皮肤'], ['general-state','一般状态'], ['nails','指甲'],
  ['upper-arm','上臂'], ['finger','手指'], ['hands','双手'],
] as const;
export type ExamLocationId = (typeof EXAM_LOCATIONS)[number][0];
const [firstLocation, ...restLocations] = EXAM_LOCATIONS.map(([id]) => id);
/** 由 EXAM_LOCATIONS 派生，避免再维护一份会漂移的部位字面量清单。 */
export const EXAM_LOCATION_IDS: [ExamLocationId, ...ExamLocationId[]] = [firstLocation, ...restLocations];
export const SOURCE_EXAM_TOOL_IDS = ['stethoscope','thermometer','oximeter','bp-cuff','tongue-depressor','flashlight','otoscope','measuring-tape','inspection','palpation','percussion','reflex-hammer'] as const;
export const sourceExamRuleSchema = z.object({
  toolId: z.enum(SOURCE_EXAM_TOOL_IDS),
  bodyPartId: z.enum(EXAM_LOCATION_IDS),
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
