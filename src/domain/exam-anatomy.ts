import { EXAM_LOCATIONS } from './source-exam-contract';

export type ExamAspect = 'front' | 'back';
export interface AnatomySite { id: string; x: number; y: number; aspect?: ExamAspect; paired?:boolean }
export interface AnatomyRegion { id: string; label: string; sites: AnatomySite[]; outline: 'head' | 'torso' | 'abdomen' | 'back' | 'arm' | 'leg' | 'general' }
const site = (id: string, x: number, y: number, aspect?: ExamAspect): AnatomySite => ({ id, x, y, ...(aspect ? { aspect } : {}) });

/** Patient left is viewer right in the anterior view. Coordinates belong to local diagrams, never the patient photograph. */
export const ANATOMY_REGIONS: AnatomyRegion[] = [
  { id: 'rg-head-neck', label: '头面颈部', outline: 'head', sites: [site('scalp',50,9),site('fontanelle',50,19),{...site('eyes',35,39),paired:true},{...site('ears',19,41),paired:true},site('nose',50,48),site('mouth',50,59),site('neck',50,80),site('thyroid',50,87),{...site('cervical-nodes',30,76),paired:true},site('forehead',50,29)] },
  { id: 'rg-chest', label: '胸部', outline: 'torso', sites: [site('chest',50,19),site('right-lung-upper',30,31,'front'),site('left-lung-upper',76,31,'front'),site('right-lung-lower',30,58,'front'),site('left-lung-lower',76,62,'front'),site('right-lung-back',70,49,'back'),site('left-lung-back',30,49,'back'),site('aortic-area',44,27,'front'),site('pulmonic-area',56,27,'front'),site('erb-area',56,38,'front'),site('tricuspid-area',52,51,'front'),site('mitral-area',66,54,'front'),{...site('axilla',17,43),paired:true},{...site('breast',26,44,'front'),paired:true},site('chest-lung',30,78),site('chest-heart',68,38,'front')] },
  { id: 'rg-abdomen', label: '腹部', outline: 'abdomen', sites: [site('abdomen-right-upper',29,30),site('abdomen-left-upper',71,30),site('abdomen-right-lower',29,63),site('abdomen-left-lower',71,63),site('umbilicus',50,49),site('liver-spleen',50,17),site('abdomen',50,82)] },
  { id: 'rg-back', label: '背腰部', outline: 'back', sites: [site('back',50,23,'back'),site('spine',50,45,'back'),site('right-kidney',68,66,'back'),site('left-kidney',32,66,'back')] },
  { id: 'rg-upper-limb', label: '上肢', outline: 'arm', sites: [site('shoulder',50,17),site('upper-arm',50,31),site('elbow',50,46),site('wrist',50,64),site('hands',50,79),site('finger',64,87),site('nails',38,89),site('upper-limb-power',27,48)] },
  { id: 'rg-lower-limb', label: '下肢', outline: 'leg', sites: [site('hip',50,14),site('knee',50,43),site('ankle',50,72),site('foot',59,86),site('lower-limb-edema',28,60),site('lower-limb-power',28,30),site('plantar',74,87)] },
  { id: 'rg-groin', label: '腹股沟会阴', outline: 'abdomen', sites: [site('groin',50,68),site('external-genitalia',50,82)] },
  { id: 'rg-general', label: '全身与测量', outline: 'general', sites: [site('general-state',50,14),site('skin',26,37),site('lymph-nodes',74,37),site('growth',50,52),site('limbs',26,68),site('joints',74,68),site('neuro',50,84)] },
];

export const ANATOMY_LABELS = Object.fromEntries(EXAM_LOCATIONS);
export function anatomyLabel(id: string): string { return ANATOMY_LABELS[id as keyof typeof ANATOMY_LABELS] ?? id; }

export const EXAM_INSTRUMENTS = [
  {id:'hand-hygiene',label:'手卫生与说明',image:'/media/clinical/tools/hand-hygiene.png'},
  {id:'inspection',label:'视诊',image:'/media/clinical/tools/inspection.png'}, {id:'palpation',label:'触诊',image:'/media/clinical/tools/palpation.png'}, {id:'percussion',label:'叩诊',image:'/media/clinical/tools/percussion.png'},
  {id:'stethoscope',label:'听诊器',image:'/media/clinical/tools/stethoscope.png'},
  {id:'axillary-thermometer',label:'腋下电子体温计',image:'/media/clinical/tools/thermometer.png'},
  {id:'infrared-thermometer',label:'额温枪',image:'/media/clinical/tools/infrared-thermometer.png'},
  {id:'tympanic-thermometer',label:'耳温计',image:'/media/clinical/tools/tympanic-thermometer.png'},
  {id:'oximeter',label:'血氧仪',image:'/media/clinical/tools/oximeter.png'},
  {id:'bp-cuff',label:'儿童血压计',image:'/media/clinical/tools/bp-cuff.png'},
  {id:'tongue-depressor',label:'压舌板',image:'/media/clinical/tools/tongue-depressor.png'},
  {id:'flashlight',label:'手电筒',image:'/media/clinical/tools/flashlight.png'},
  {id:'otoscope',label:'耳镜',image:'/media/clinical/tools/otoscope.png'},
  {id:'measuring-tape',label:'软尺',image:'/media/clinical/tools/measuring-tape.png'},
  {id:'reflex-hammer',label:'叩诊锤',image:'/media/clinical/tools/reflex-hammer.png'},
];

/** Neutral method menu. It must never be derived from a case's positive findings. */
export function instrumentsForSite(id: string): string[] {
  if (id === 'axilla') return ['inspection','palpation','axillary-thermometer'];
  if (id === 'forehead') return ['inspection','infrared-thermometer'];
  if (id === 'ears') return ['inspection','otoscope','tympanic-thermometer'];
  if (id === 'eyes') return ['inspection','flashlight'];
  if (id === 'mouth') return ['inspection','flashlight','tongue-depressor'];
  if (id === 'upper-arm') return ['inspection','palpation','bp-cuff'];
  if (id === 'finger') return ['inspection','palpation','oximeter'];
  if (id === 'growth') return ['measuring-tape'];
  if (id === 'fontanelle' || id === 'scalp') return ['inspection','palpation','measuring-tape'];
  if (/lung|chest$/.test(id)) return ['inspection','palpation','percussion','stethoscope'];
  if (/area$|chest-heart/.test(id)) return ['inspection','palpation','stethoscope'];
  if (/abdomen|umbilicus|liver-spleen/.test(id)) return ['inspection','stethoscope','percussion','palpation'];
  if (/kidney/.test(id)) return ['inspection','palpation','percussion'];
  if (/neuro|plantar|knee|elbow/.test(id)) return ['inspection','palpation','reflex-hammer'];
  return ['inspection','palpation'];
}
