import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixedAxillaryTemperatureSelection,fixedGrowthMeasurementSelection,fixedInfraredTemperatureSelection,fixedOximeterSelection,fixedTympanicTemperatureSelection} from '../src/domain/exam-fixed-teaching';
import type {TeachingExam,TeachingPackage} from '../src/domain/teaching-package';

function fixture(overrides:{age?:string;title?:string;history?:string;origin?:TeachingExam['origin'];toolId?:TeachingExam['toolId'];bodyPartId?:TeachingExam['bodyPartId']}={}):{pack:TeachingPackage;exam:TeachingExam}{
  const exam={id:'measurement',toolId:overrides.toolId??'axillary-thermometer',bodyPartId:overrides.bodyPartId??'axilla',origin:overrides.origin??'reference'} as TeachingExam;
  const pack={
    title:overrides.title??'常规教学病例',complaint:'',age:overrides.age??'2岁',
    historyFacts:overrides.history?[{origin:'source',text:overrides.history}]:[],
    exams:[exam],
  } as unknown as TeachingPackage;
  return {pack,exam};
}

test('fixed axillary temperature requires an unresolved age-appropriate row without source temperature facts',()=>{
  const {pack,exam}=fixture();
  const selection=fixedAxillaryTemperatureSelection(pack,exam);
  assert.equal(selection?.state,'normal');
  assert.match(selection?.result??'',/36\.7 ℃/);
  assert.match(selection?.result??'',/不是原患者新增实测/);
});

test('fixed axillary temperature preserves affirmative concerns and every original numeric temperature',()=>{
  assert.equal(fixedAxillaryTemperatureSelection(...Object.values(fixture({title:'发热教学病例'})) as [TeachingPackage,TeachingExam]),null);
  assert.equal(fixedAxillaryTemperatureSelection(...Object.values(fixture({history:'腋温 36.8 ℃。'})) as [TeachingPackage,TeachingExam]),null);
});

test('fixed axillary temperature allows an explicit negative history but not young infants or source rows',()=>{
  const negative=fixture({history:'病程中无发热、无寒战。'});
  assert.ok(fixedAxillaryTemperatureSelection(negative.pack,negative.exam));
  const infant=fixture({age:'2个月'});
  assert.equal(fixedAxillaryTemperatureSelection(infant.pack,infant.exam),null);
  const source=fixture({origin:'source'});
  assert.equal(fixedAxillaryTemperatureSelection(source.pack,source.exam),null);
});

test('infrared, tympanic and oximeter values are independent fixed scenarios with safety gates',()=>{
  const infrared=fixture({toolId:'infrared-thermometer',bodyPartId:'forehead'});
  const tympanic=fixture({toolId:'tympanic-thermometer',bodyPartId:'ears'});
  const oximeter=fixture({toolId:'oximeter',bodyPartId:'finger'});
  assert.match(fixedInfraredTemperatureSelection(infrared.pack,infrared.exam)?.result??'',/额温测量读数为 36\.7 ℃/);
  assert.match(fixedTympanicTemperatureSelection(tympanic.pack,tympanic.exam)?.result??'',/耳温测量读数为 36\.7 ℃/);
  assert.match(fixedOximeterSelection(oximeter.pack,oximeter.exam)?.result??'',/SpO₂ 读数为 99%，脉率为 100 次\/分/);
  const temperature=fixture({toolId:'infrared-thermometer',bodyPartId:'forehead',history:'腋温 38.1 ℃。'});
  assert.equal(fixedInfraredTemperatureSelection(temperature.pack,temperature.exam),null);
  const cardiac=fixture({toolId:'oximeter',bodyPartId:'finger',title:'肺炎伴呼吸困难'});
  assert.equal(fixedOximeterSelection(cardiac.pack,cardiac.exam),null);
  const youngEar=fixture({toolId:'tympanic-thermometer',bodyPartId:'ears',age:'3个月'});
  assert.equal(fixedTympanicTemperatureSelection(youngEar.pack,youngEar.exam),null);
});

test('growth values use age anchors but never overwrite measurements or conflict with growth risks',()=>{
  const weight=fixture({toolId:'standing-scale',bodyPartId:'growth'});
  const height=fixture({toolId:'stadiometer',bodyPartId:'growth'});
  const head=fixture({toolId:'measuring-tape',bodyPartId:'scalp'});
  assert.match(fixedGrowthMeasurementSelection(weight.pack,weight.exam)?.result??'',/体重测量读数为 12 kg/);
  assert.match(fixedGrowthMeasurementSelection(height.pack,height.exam)?.result??'',/站立身高测量读数为 87 cm/);
  assert.match(fixedGrowthMeasurementSelection(head.pack,head.exam)?.result??'',/最大头围测量读数为 48 cm/);
  const measured=fixture({toolId:'measuring-tape',bodyPartId:'scalp',history:'体重 11.5 kg。'});
  assert.equal(fixedGrowthMeasurementSelection(measured.pack,measured.exam),null,'同例任一实测生长数据阻止整套生长模拟');
  const risk=fixture({toolId:'standing-scale',bodyPartId:'growth',title:'肾病综合征'});
  assert.equal(fixedGrowthMeasurementSelection(risk.pack,risk.exam),null);
  const wrongAge=fixture({toolId:'standing-scale',bodyPartId:'growth',age:'18个月'});
  assert.equal(fixedGrowthMeasurementSelection(wrongAge.pack,wrongAge.exam),null);
});
