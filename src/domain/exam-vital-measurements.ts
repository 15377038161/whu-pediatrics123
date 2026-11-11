import type {TeachingExam,TeachingPackage} from './teaching-package';
import type {FixedVitalMeasurement,VitalMetric} from './vital-measurement';
import {VITAL_METRIC_UNITS} from './vital-measurement';
import {anatomyLabel} from './exam-anatomy';
import {fixedTeachingOximeterMeasurement} from './exam-fixed-teaching';

const thermometerTools=new Set(['thermometer','axillary-thermometer','infrared-thermometer','tympanic-thermometer']);

/**
 * New packages carry explicit measurements. The narrow compatibility branch lets an already
 * running session release only its pinned intake value or its existing fixed SpO₂ scenario;
 * it never parses a result paragraph while the student is operating.
 */
export function fixedMeasurementsForTeachingExam(
  pack:TeachingPackage,
  exam:TeachingExam,
):FixedVitalMeasurement[] {
  if(exam.measurements)return exam.measurements;
  if(exam.origin==='teaching-simulation'&&exam.toolId==='oximeter'){
    const measurement=fixedTeachingOximeterMeasurement(pack.age);
    return measurement?[measurement]:[];
  }
  if(exam.origin!=='source')return [];
  const metric:VitalMetric|null=exam.toolId==='oximeter'?'spo2':thermometerTools.has(exam.toolId)?'temperature':null;
  if(!metric)return [];
  const intake=pack.intake?.initialVitals.find(item=>item.code===metric);
  if(!intake||intake.status!=='recorded'||intake.value===null)return [];
  return [{
    metric,value:intake.value,unit:VITAL_METRIC_UNITS[metric],
    method:intake.method??exam.label,site:intake.site??anatomyLabel(exam.bodyPartId),origin:'source',
    sourceLocator:intake.sourceLocator,sourceTimepoint:intake.timepoint,
  }];
}
