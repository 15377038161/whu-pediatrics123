import { z } from 'zod';

/** Neutral anatomy is independent of the selected tool and of a case's answer matrix.
 *  旧部位 id 一律不改名：在飞会话的 unlockedEvidence 与已存报告快照按原证据码读取。 */
export const EXAM_LOCATIONS = [
  ['forehead','额部'], ['eyes','眼与结膜'], ['ears','耳'], ['nose','鼻'], ['mouth','口咽'], ['neck','颈部'], ['lymph-nodes','浅表淋巴结'],
  ['chest','胸廓胸壁'], ['chest-lung','肺野'], ['chest-heart','心前区'], ['breast','乳房'],
  ['abdomen','腹部'], ['liver-spleen','肝脾'], ['groin','腹股沟'],
  ['limbs','四肢'], ['joints','关节'], ['spine','脊柱'], ['neuro','神经系统'],
  ['skin','皮肤'], ['general-state','一般状态'], ['nails','指甲'],
  ['upper-arm','上臂'], ['finger','手指'], ['hands','双手'],
  ['scalp','头颅'], ['fontanelle','前囟'], ['thyroid','甲状腺'], ['cervical-nodes','颈部淋巴结'],
  ['right-lung-upper','右前上肺野'], ['left-lung-upper','左前上肺野'], ['right-lung-lower','右前下肺野'], ['left-lung-lower','左前下肺野'],
  ['right-lung-back','右后肺野'], ['left-lung-back','左后肺野'],
  ['aortic-area','主动脉瓣听诊区'], ['pulmonic-area','肺动脉瓣听诊区'], ['erb-area','主动脉瓣第二听诊区'], ['tricuspid-area','三尖瓣听诊区'], ['mitral-area','二尖瓣听诊区'],
  ['axilla','腋窝'], ['abdomen-right-upper','右上腹'], ['abdomen-left-upper','左上腹'], ['abdomen-right-lower','右下腹'], ['abdomen-left-lower','左下腹'], ['umbilicus','脐部'],
  ['back','背部'], ['right-kidney','右肾区'], ['left-kidney','左肾区'],
  ['shoulder','肩部'], ['elbow','肘部'], ['wrist','腕部'], ['upper-limb-power','上肢肌力'],
  ['hip','髋部'], ['knee','膝部'], ['ankle','踝部'], ['foot','足部'], ['lower-limb-edema','下肢水肿'], ['lower-limb-power','下肢肌力'], ['plantar','足底反射'],
  ['external-genitalia','外生殖器'], ['growth','生长测量'],
] as const;
export type ExamLocationId = (typeof EXAM_LOCATIONS)[number][0];
const [firstLocation, ...restLocations] = EXAM_LOCATIONS.map(([id]) => id);
/** 由 EXAM_LOCATIONS 派生，避免再维护一份会漂移的部位字面量清单。 */
export const EXAM_LOCATION_IDS: [ExamLocationId, ...ExamLocationId[]] = [firstLocation, ...restLocations];
export const SOURCE_EXAM_TOOL_IDS = ['stethoscope','thermometer','axillary-thermometer','infrared-thermometer','tympanic-thermometer','oximeter','bp-cuff','tongue-depressor','flashlight','otoscope','measuring-tape','inspection','palpation','percussion','reflex-hammer'] as const;
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
