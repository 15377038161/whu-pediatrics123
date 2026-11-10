import {hasAffirmedSourceMention} from './exam-source-context';
import {ageMonths,instrumentApplicability} from './exam-authoring-standard';
import {assessGrowth} from './growth-assessment';
import {growthMeasurement} from './growth-exam';
import type {ExamSelectionItem} from './exam-authoring-selection';
import type {TeachingExam,TeachingPackage} from './teaching-package';

/** Fixed teaching scenarios only. These values are never presented as original patient measurements. */
export const FIXED_AXILLARY_TEMPERATURE_C = 36.7;

function originalClinicalText(pack:TeachingPackage):string {
  return [
    pack.title,
    pack.complaint,
    ...pack.historyFacts.filter(item=>item.origin==='source').map(item=>item.text),
    ...pack.exams.filter(item=>item.origin==='source').map(item=>item.result),
  ].join('\n');
}

export function hasOriginalTemperatureValue(pack:TeachingPackage):boolean {
  return /\d+(?:\.\d+)?\s*(?:℃|°\s*C)/i.test(originalClinicalText(pack));
}

export function hasTemperatureConcern(pack:TeachingPackage):boolean {
  return hasAffirmedSourceMention(originalClinicalText(pack),[
    '发热','高热','低热','体温升高','体温不升','低体温','寒战',
  ]);
}

/**
 * A deliberately narrow first batch: no source temperature value or temperature concern,
 * a known age of at least three months, and an otherwise unresolved axillary measurement.
 */
export function fixedAxillaryTemperatureSelection(
  pack:TeachingPackage,
  exam:TeachingExam,
):ExamSelectionItem|null {
  if(exam.origin!=='reference'||exam.toolId!=='axillary-thermometer')return null;
  const months=ageMonths(pack.age);
  if(months===null||months<3)return null;
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,months).status!=='applicable')return null;
  if(hasOriginalTemperatureValue(pack)||hasTemperatureConcern(pack))return null;
  const value=FIXED_AXILLARY_TEMPERATURE_C.toFixed(1);
  return {
    id:exam.id,
    state:'normal',
    origin:'teaching-simulation',
    result:`教学模拟设定：本次腋温测量读数为 ${value} ℃；测量条件设为安静、腋窝干燥、探头位置正确且读数稳定。该数值仅用于腋温操作与规范记录训练，不是原患者新增实测，也不据此反推原病例是否发热。`,
    rationale:'原资料未提供独立腋温读数，未见被肯定的发热、低体温或原始温度数值；按本例年龄适用性设置固定教学模拟，不代替原患者实测。',
  };
}

export function fixedInfraredTemperatureSelection(pack:TeachingPackage,exam:TeachingExam):ExamSelectionItem|null {
  if(exam.origin!=='reference'||exam.toolId!=='infrared-thermometer')return null;
  const months=ageMonths(pack.age);
  if(months===null||months<3||hasOriginalTemperatureValue(pack)||hasTemperatureConcern(pack))return null;
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,months).status!=='applicable')return null;
  return {
    id:exam.id,state:'normal',origin:'teaching-simulation',
    result:'教学模拟设定：本次额温测量读数为 36.7 ℃；测量条件设为额部无遮挡、无汗液干扰，并按设备说明保持距离与方向，读数稳定。该独立教学场景值不是由腋温或耳温换算，不是原患者新增实测。',
    rationale:'原资料没有独立额温或其他温度数值，也无被肯定的温度异常；按额温器材适用性设置独立固定教学场景。',
  };
}

export function fixedTympanicTemperatureSelection(pack:TeachingPackage,exam:TeachingExam):ExamSelectionItem|null {
  if(exam.origin!=='reference'||exam.toolId!=='tympanic-thermometer')return null;
  const months=ageMonths(pack.age);
  if(months===null||months<6||hasOriginalTemperatureValue(pack)||hasTemperatureConcern(pack))return null;
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,months).status!=='applicable')return null;
  return {
    id:exam.id,state:'normal',origin:'teaching-simulation',
    result:'教学模拟设定：本次耳温测量读数为 36.7 ℃；测量条件设为年龄与设备适用、探头套完整并按说明定位耳道，读数稳定。该独立教学场景值不是由腋温或额温换算，不是原患者新增实测。',
    rationale:'原资料没有独立耳温或其他温度数值，无被肯定的温度异常，且年龄不少于6月龄；设置独立固定耳温教学场景。',
  };
}

function hasOriginalCardiorespiratoryValue(pack:TeachingPackage):boolean {
  return originalClinicalText(pack).split(/[\n。；]/).some(clause=>/(?:SpO\s*[₂2]|血氧|脉率|心率)/i.test(clause)&&/\d/.test(clause));
}

function hasCardiorespiratoryConcern(pack:TeachingPackage):boolean {
  return hasAffirmedSourceMention(originalClinicalText(pack),[
    '先天性心脏病','心脏病','心力衰竭','心功能不全','哮喘','肺炎','呼吸困难','呼吸窘迫','呼吸衰竭',
    '发绀','青紫','低氧','低氧血症','氧疗','吸氧','休克','心悸','心动过速','心动过缓','末梢循环差',
  ]);
}

function fixedPulseRate(months:number):number {
  if(months<12)return 120;
  if(months<24)return 110;
  if(months<60)return 100;
  if(months<144)return 90;
  return 80;
}

export function fixedOximeterSelection(pack:TeachingPackage,exam:TeachingExam):ExamSelectionItem|null {
  if(exam.origin!=='reference'||exam.toolId!=='oximeter')return null;
  const months=ageMonths(pack.age);
  if(months===null||months<3||hasOriginalCardiorespiratoryValue(pack)||hasCardiorespiratoryConcern(pack))return null;
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,months).status==='not_applicable')return null;
  const pulse=fixedPulseRate(months);
  return {
    id:exam.id,state:'normal',origin:'teaching-simulation',
    result:`教学模拟设定：室内空气、末梢灌注良好且信号稳定时，本次 SpO₂ 读数为 99%，脉率为 ${pulse} 次/分。数值仅用于适龄探头操作、信号核对与规范记录训练，不是原患者新增实测，也不用于推算氧疗目标或心肺诊断。`,
    rationale:'原资料没有血氧、脉率或心率数值，未见被肯定的心肺、低氧、氧疗或循环异常；按年龄设置固定测量教学场景。',
  };
}

type FixedGrowthKind='weight'|'height'|'head';

function hasAnyOriginalGrowthMeasurement(pack:TeachingPackage):boolean {
  const text=originalClinicalText(pack);
  return ['standing-scale','length-board','stadiometer','measuring-tape'].some(tool=>growthMeasurement(tool,text).length>0);
}

function hasGrowthConcern(pack:TeachingPackage):boolean {
  return hasAffirmedSourceMention(originalClinicalText(pack),[
    '生长迟缓','生长发育迟缓','低体重','体重不增','体重下降','营养不良','消瘦','肥胖','超重','身材矮小','矮小症',
    '小头畸形','小头','大头','头围增大','脑积水','佝偻病','甲状腺功能减低','甲状腺功能亢进','性早熟',
    '慢性肾脏病','慢性肾衰竭','肾病综合征','先天性心脏病','心力衰竭','炎症性肠病','克罗恩','溃疡性结肠炎',
    '乳糜泻','糖尿病','恶性肿瘤','白血病','化疗','长期激素','糖皮质激素',
  ]);
}

function hasMotorConcern(pack:TeachingPackage):boolean {
  return hasAffirmedSourceMention(originalClinicalText(pack),[
    '瘫痪','肌无力','不能站立','不能行走','活动受限','骨折','意识障碍','昏迷','嗜睡',
  ]);
}

function growthKindForExam(exam:TeachingExam):FixedGrowthKind|null {
  if(exam.toolId==='standing-scale'||exam.toolId==='infant-scale')return exam.bodyPartId==='growth'?'weight':null;
  if(exam.toolId==='length-board'||exam.toolId==='stadiometer')return exam.bodyPartId==='growth'?'height':null;
  if(exam.toolId==='measuring-tape'&&(exam.bodyPartId==='growth'||exam.bodyPartId==='scalp'))return 'head';
  return null;
}

export function fixedGrowthMeasurementSelection(pack:TeachingPackage,exam:TeachingExam):ExamSelectionItem|null {
  if(exam.origin!=='reference')return null;
  const kind=growthKindForExam(exam);
  if(!kind)return null;
  const exactMonths=ageMonths(pack.age);
  if(exactMonths===null||exactMonths<3||exactMonths>120)return null;
  const months=Math.round(exactMonths);
  if((exam.toolId==='standing-scale'||exam.toolId==='stadiometer')&&exactMonths<24)return null;
  if((exam.toolId==='infant-scale'||exam.toolId==='length-board')&&exactMonths>=24)return null;
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,exactMonths).status==='not_applicable')return null;
  if(hasAnyOriginalGrowthMeasurement(pack)||hasGrowthConcern(pack))return null;
  if((exam.toolId==='standing-scale'||exam.toolId==='stadiometer')&&hasMotorConcern(pack))return null;
  const assessment=assessGrowth({ageMonths:months});
  if(!assessment.ok)return null;
  const metric=assessment.metrics.find(item=>item.kind===kind);
  const value=metric?.typical.match(/\d+(?:\.\d+)?\s*(?:kg|cm)/)?.[0];
  if(!value)return null;
  const label=kind==='weight'?'体重':kind==='height'?(exam.toolId==='length-board'?'仰卧身长':'站立身高'):'最大头围';
  return {
    id:exam.id,state:'normal',origin:'teaching-simulation',
    result:`教学模拟设定：本次${label}测量读数为 ${value}，测量条件与器材适用性符合操作要求。该固定场景值采用本例年龄对应的教材典型锚点，仅用于测量与记录训练；不是原患者新增实测，不用于个体生长、营养或发育诊断，同例其他生长教学值也按同一锚点设置。`,
    rationale:'原资料没有当前体重、身长/身高或头围实测，未见被肯定的生长、营养或相关慢性病情风险；器材年龄适用，采用一致教材锚点设置固定教学场景。',
  };
}
