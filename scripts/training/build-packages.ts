import {extractLabRows} from '../../src/domain/lab-report';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { TEACHER_CASE_CATALOG } from '../../src/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '../../src/domain/teacher-case-links';
import { ANATOMY_REGIONS, anatomyLabel, instrumentsForSite } from '../../src/domain/exam-anatomy';
import { sourceExamDefinitions } from '../../src/domain/exam-methods';
import { examProtocol } from '../../src/domain/exam-protocol';
import { sourceHistoryFacts, deidentifyClinicalText } from '../../src/lib/history-dialogue';
import { computeCaseDataVersion } from '../../src/lib/case-data-version';
import { teachingPackageVersion } from '../../src/lib/teaching-package-store';
import { recordSchema, getKnowledgeRoot } from '../../src/lib/teacher-case-data';
import { teachingPackageSchema, type TeachingPackage, type TeachingExam, type TeachingTest, type TeachingRubricItem } from '../../src/domain/teaching-package';
import { extractObjectiveTestReport } from '../../src/domain/test-report-extraction';
import { CURRICULA } from './curricula';
import { patientAppearance,allowedPostures } from '../../src/domain/patient-appearance';
import { publicCaseId } from '../../src/lib/case-identity';
import { parseAgeToDays, toAgeBand } from '../../src/domain/communication-profile';
import {hasAffirmedSourceMention,sourceHasSystemicExamConcern} from '../../src/domain/exam-source-context';

const sourceRoot=path.join(getKnowledgeRoot(),'teaching-cases');
const root=path.resolve(process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT||'knowledge/training-packages');
const delivery=path.resolve(process.env.PEDIATRICS_TRAINING_DELIVERY_ROOT||'deliverables/67-cases-20261107');
const authoring=path.resolve(process.env.PEDIATRICS_TRAINING_AUTHORING_ROOT||'outputs/training-20261107');
mkdirSync(authoring,{recursive:true});
for(const dir of [root,path.join(root,'packages'),path.join(root,'media'),delivery,path.join(delivery,'json')])mkdirSync(dir,{recursive:true});
const mediaIndexPath=path.join(authoring,'processed-media.json');
const mediaIndex:Record<string,Array<{testLabel?:string;examSite?:string;fileId:string;kind:'image';caption:string}>>=existsSync(mediaIndexPath)?JSON.parse(readFileSync(mediaIndexPath,'utf8')):{};
const reportIndexPath=path.join(authoring,'report-media.json');
const reportIndex:typeof mediaIndex=existsSync(reportIndexPath)?JSON.parse(readFileSync(reportIndexPath,'utf8')):{};
const simulationPath=path.join(authoring,'simulated-media.json');
const simulation:Record<string,{fileId:string;kind:'image';caption:string}>=existsSync(simulationPath)?JSON.parse(readFileSync(simulationPath,'utf8')):{};

const TESTS:Array<{label:string;aliases:string[];pattern:RegExp;reference:string;fallbackFor?:string[]}>=[
  {label:'胸部CT',aliases:['肺部CT','肺CT','胸CT'],pattern:/(?:胸|肺).{0,5}CT|CT.{0,8}(?:胸|肺)/i,reference:'原始CT的范围、窗位和重建方法需要明确；不能用胸片、MRI或超声图代替CT结果。'},
  {label:'胸部X线',aliases:['胸片','胸部DR','胸部X光','胸部X线片'],pattern:/胸片|胸部.{0,5}(?:X线|X光|DR)|X线.{0,5}胸/i,reference:'注明投照体位与范围；胸片与CT不可互相冒充，正常胸片也不能排除所有疾病。'},
  {label:'胸部超声',aliases:['肺部超声','肺超声','胸腔超声'],pattern:/(?:胸|肺).{0,5}(?:超声|B超|彩超)/,reference:'超声的范围与声窗须明确；不能代替未检查的其他胸部结构。'},
  {label:'腹部CT',aliases:['腹CT','腹部增强CT'],pattern:/腹.{0,5}CT|CT.{0,5}腹/i,reference:'注明范围及是否增强，不能以腹部MRI或超声冒充CT结果。'},
  {label:'腹部MRI',aliases:['腹部磁共振','腹部MR','盆腔MRI'],pattern:/(?:腹|盆腔).{0,5}(?:MRI|磁共振)|MRI.{0,5}(?:腹|盆腔)/i,reference:'注明具体扫描部位和序列，单张关键帧不等同于完整检查。'},
  {label:'脊髓MRI',aliases:['脊柱MRI','脊髓磁共振','颈椎MRI','胸椎MRI','腰椎MRI'],pattern:/(?:脊髓|脊柱|颈椎|胸椎|腰椎).{0,5}(?:MRI|磁共振)/i,reference:'颈、胸、腰各段范围不同，按原图所示范围解释，不以单一层面覆盖全脊髓。'},
  {label:'心脏MRI',aliases:['心脏磁共振','心肌MRI','心脏MR'],pattern:/心(?:脏|肌).{0,5}(?:MRI|磁共振)/i,reference:'心脏MRI与超声心动图不能互相冒充；关键帧仅代表相应序列和层面。'},
  {label:'头颅CT',aliases:['头部CT','脑CT','颅脑CT'],pattern:/(?:头|颅|脑).{0,5}CT|CT.{0,5}(?:头|颅|脑)/i,reference:'注意扫描范围、平扫或增强及儿童辐射风险；MRI或超声不能作为CT图展示。'},
  {label:'四肢X线',aliases:['骨骼X线','四肢X光'],pattern:/(?:四肢|胫骨|尺桡骨|骨骼).{0,6}(?:X线|X光|平片)/,reference:'按原图保留的左右和具体部位解释，不以局部片段冒充所有关节均已检查。'},
  {label:'血常规',aliases:['血细胞分析','CBC','血象'],pattern:/血常规|血细胞|白细胞|WBC|血小板|PLT|血红蛋白|Hb\b/i,reference:'白细胞分类、血红蛋白及血小板应使用相应年龄和本实验室参考区间；儿童不能一概套用成人区间。'},
  {label:'炎症指标',aliases:['CRP','C反应蛋白','PCT','降钙素原','血沉','ESR'],pattern:/CRP|C反应蛋白|PCT|降钙素原|血沉|ESR/i,reference:'炎症指标用于结合病程、查体及病原资料判断，单项升高或正常均不能独立确诊或排除感染。'},
  {label:'血糖',aliases:['随机血糖','指尖血糖','空腹血糖','葡萄糖'],pattern:/血糖|葡萄糖|GLU\b/i,reference:'参考用途：按采血条件解释血糖，并结合症状、酮体和血气；参考区间不等于诊断阈值。'},
  {label:'血酮',aliases:['酮体','血酮体','β羟丁酸'],pattern:/血酮|酮体|羟丁酸/,reference:'血酮和尿酮测量对象不同，需结合血糖、酸碱状态和方法解释，不互相替代。'},
  {label:'血气分析',aliases:['血气','动脉血气','静脉血气'],pattern:/血气|pH\s*[:：=]?\s*\d|HCO|碳酸氢|碱剩余/i,reference:'常用动脉pH参考约7.35～7.45；静脉样本、年龄和采样条件需单独注明，不能只凭pH评价氧合。'},
  {label:'电解质',aliases:['血钾','血钠','钾钠氯','离子'],pattern:/电解质|血钾|血钠|血氯|钠离子|钾离子|K\s*[:：]|Na\s*[:：]/i,reference:'常用血钠参考约135～145 mmol/L；血钾、钙等按年龄和实验室区间。补充的是参考信息，不是患者测量值。'},
  {label:'肾功能',aliases:['肌酐','尿素','尿素氮','肾功'],pattern:/肌酐|尿素|肾功能|BUN|Scr\b|CREA/i,reference:'儿童肌酐与年龄、肌肉量有关，需结合既往值、尿量和适用的肾功能估算方法，不能套用成人肌酐正常上限。'},
  {label:'肝功能',aliases:['肝功','转氨酶','白蛋白'],pattern:/肝功能|转氨酶|ALT|AST|白蛋白|ALB|球蛋白|GGT/i,reference:'转氨酶、白蛋白、凝血和胆红素应联合评估；胆红素异常需区分直接与间接组分。'},
  {label:'胆红素',aliases:['总胆红素','经皮胆红素','血清胆红素','直接胆红素'],pattern:/胆红素|黄疸指数|TBIL|DBIL|TcB/i,reference:'新生儿必须结合出生后小时龄、胎龄及危险因素评价，不能采用统一成人区间或单一光疗阈值。'},
  {label:'尿常规',aliases:['尿检','尿液分析'],pattern:/尿常规|尿蛋白|尿隐血|尿潜血|尿白细胞|尿红细胞|尿糖|尿酮/i,reference:'正常参考描述包括无明确病理性蛋白、血尿、糖尿或脓尿，仍需注明留尿方法与本实验室区间。'},
  {label:'尿培养',aliases:['尿细菌培养'],pattern:/尿培养|尿细菌培养/,reference:'结果解释依赖留取方式、菌落计数、单一或混合菌及抗菌药暴露，不能把污染标本当作确诊依据。'},
  {label:'大便检查',aliases:['便常规','大便常规','粪便检查','轮状病毒抗原'],pattern:/大便|粪便|便常规|轮状病毒/,reference:'结合大便性状、白红细胞、病原方法及临床情况解释，不以单一便常规确定病原。'},
  {label:'胸部影像',aliases:[],fallbackFor:['胸部CT','胸部X线','胸部超声'],pattern:/胸片|胸部|肺部CT|肺纹理|肺野|肺叶|肺不张|实变|磨玻璃|纵隔/,reference:'报告应说明检查方式、范围和客观所见；不能把胸片和CT当作等价申请。影像风格模拟图不用于细微征象评分。'},
  {label:'头颅MRI',aliases:['头部MRI','脑MRI','颅脑磁共振','头颅磁共振'],pattern:/(?:头|颅|脑).{0,8}(?:MRI|磁共振)|(?:MRI|磁共振).{0,8}(?:头|颅|脑)/i,reference:'注明部位、序列和是否增强；申请MRI不等于已完成所有序列，模拟图不能替代完整真实序列。'},
  {label:'头颅影像',aliases:['头颅超声'],fallbackFor:['头颅CT','头颅MRI'],pattern:/(?:头|颅|脑).{0,8}(?:CT|超声)|(?:CT|超声).{0,8}(?:头|颅|脑)/i,reference:'根据具体临床问题选择影像方式，结合辐射、镇静及检查时机，不作为所有神经症状的默认检查。'},
  {label:'心电图',aliases:['ECG','心电'],pattern:/心电图|ECG|窦性|ST段|心律失常|房室传导/i,reference:'心率、间期、轴和复极表现需按儿童年龄解释；图示或文字应与相同节律和频率一致。'},
  {label:'心脏超声',aliases:['心超','超声心动图','心脏彩超'],pattern:/心脏.{0,5}(超声|彩超)|超声心动图|冠状动脉|射血分数|LVEF/i,reference:'按体表面积和年龄解释相应指标；正常早期检查不能排除后续出现的病变。'},
  {label:'腹部超声',aliases:['腹部B超','腹部彩超','肝胆脾超声','盆腔超声','泌尿系超声','肾脏超声'],pattern:/(腹部|肝胆|肾脏|泌尿|盆腔|子宫|卵巢).{0,8}(超声|B超|彩超)|(?:超声|B超).{0,8}(腹|肝|肾|子宫|卵巢)/i,reference:'检查范围必须明确；腹部、泌尿系与盆腔属于不同目标，不能以同一结论覆盖未检查器官。'},
  {label:'脑脊液',aliases:['腰穿','脑脊液检查','CSF'],pattern:/脑脊液|腰穿|脑脊液压力|CSF/i,reference:'注明年龄、标本和采样条件；需评估腰穿安全，不能以参考结果代替腰穿禁忌评估。'},
  {label:'脑电图',aliases:['EEG','视频脑电图'],pattern:/脑电图|EEG|棘波|慢波|癫痫样/i,reference:'需要结合临床发作判断，正常脑电图不等于排除癫痫；模拟波形不用于细微波形识别评分。'},
  {label:'凝血功能',aliases:['凝血','PT','APTT','D二聚体'],pattern:/凝血|PT\b|APTT|纤维蛋白原|D.?二聚体/i,reference:'按方法及年龄解释PT、APTT和纤维蛋白原，结合出血表现及肝功能，而非单个数值。'},
  {label:'骨髓检查',aliases:['骨髓穿刺','骨髓象','骨髓活检'],pattern:/骨髓|原始细胞|幼稚细胞|免疫分型/,reference:'骨髓形态、流式、遗传及外周血资料需要综合解释；示意图不能代替原始细胞形态诊断。'},
  {label:'血培养',aliases:['血细菌培养'],pattern:/血培养|血细菌培养/,reference:'注明采样及抗菌药使用时点；单次阴性不能独立排除感染。'},
  {label:'骨龄',aliases:['骨龄片','左手腕X线','骨龄评估'],pattern:/骨龄/,reference:'注明判读方法，结合实际年龄、身高速度及青春发育，不能仅据骨龄超前或落后定病因。'},
  {label:'性激素',aliases:['LH','FSH','雌二醇','睾酮','激发试验'],pattern:/性激素|LH\b|FSH\b|雌二醇|睾酮|激发试验/i,reference:'参考范围受性别、年龄、青春发育分期、采血时间和检测方法影响。'},
  {label:'铁蛋白',aliases:['血清铁蛋白','铁蛋白测定'],pattern:/铁蛋白|Ferritin/i,reference:'铁蛋白也受炎症影响；不能仅凭明显升高确诊噬血细胞综合征。'},
  {label:'血脂',aliases:['血脂四项','胆固醇','甘油三酯'],pattern:/血脂|胆固醇|甘油三酯|TG\b|TC\b|LDL|HDL/i,reference:'按年龄及空腹情况解释，结合营养、代谢与基础疾病。'},
];

function sourceResult(text:string,label:string):string {
  const spec=TESTS.find(t=>t.label===label||t.aliases.includes(label));
  if(!spec)return '';
  return extractObjectiveTestReport(deidentifyClinicalText(text),spec.label,TESTS);
}
function concepts(text:string):string[][]{
  const vocabulary=['补液','监测','血糖','血钾','电解质','尿量','胰岛素','氧疗','呼吸','抗感染','抗生素','培养','抗病毒','激素','输血','光疗','换血','惊厥','心电','血压','随访','复查','肾功能','肝功能','转诊','住院','观察','饮食','活动','告知','出血','感染','脑脊液','用药','支持'];
  const groups:Record<string,string[]>={补液:['补液','液体','补水','水化'],抗感染:['抗感染','抗菌','抗生素'],氧疗:['氧疗','吸氧','给氧'],监测:['监测','观察','复评','复查'],随访:['随访','复诊','定期复查'],惊厥:['惊厥','抽搐','发作'],告知:['告知','解释','说明','交代']};
  return vocabulary.filter(x=>text.includes(x)).slice(0,5).map(x=>groups[x]??[x]);
}
function criterion(section:TeachingRubricItem['section'],level:'basic'|'advanced',id:string,label:string,maxScore:number,fullAnswer:string,sourceLocator:string,evidenceCodes:string[]=[],terms?:string[][]):TeachingRubricItem{
  return {id,section,level,label,maxScore,fullAnswer,sourceLocator,evidenceCodes,concepts:terms??concepts(fullAnswer),partialAnswer:'方向正确，但尚缺本条的必要条件；只给本条一半分，不影响其他独立要点。',incorrectAnswer:'遗漏、否定应做的内容、实施相反或危险措施，或仅泛称“处理一下”而无可识别行动。',safetyCritical:/安全|危重|气道|血钾|意识|禁忌/.test(label),unsafePhrases:[]};
}
function groupForSite(part:string):string{
  if(/lung|chest$/.test(part))return 'chest-lung';if(/area$|chest-heart/.test(part))return 'chest-heart';
  if(/abdomen-|umbilicus/.test(part))return 'abdomen';if(/kidney|back/.test(part))return 'spine';
  if(/power|plantar/.test(part))return 'neuro';if(/hip|knee|ankle|foot|elbow|wrist|shoulder/.test(part))return 'joints';
  if(part==='scalp'||part==='fontanelle')return 'forehead';if(part==='thyroid')return 'neck';if(part==='cervical-nodes'||part==='axilla')return 'lymph-nodes';
  if(part==='lower-limb-edema'||part==='hands'||part==='finger')return 'limbs';if(part==='nails')return 'skin';if(part==='external-genitalia')return 'groin';return part;
}

const entries:Record<string,string>={};const inventory=[];
for(const [ordinal,item] of TEACHER_CASE_CATALOG.filter(item=>{
  const sourceId=TEACHER_CASE_LINKS[item.id]?.sourceId??item.id;return existsSync(path.join(sourceRoot,`${sourceId}.json`));
}).entries()){
  const sourceId=TEACHER_CASE_LINKS[item.id]?.sourceId??item.id;
  const source=recordSchema.parse(JSON.parse(readFileSync(path.join(sourceRoot,`${sourceId}.json`),'utf8')));
  const title=item.name;const curriculum=CURRICULA[sourceId.replace(/^teacher-/,'')];
  if(!curriculum)throw new Error(`CURRICULUM_MISSING:${sourceId}`);
  const sourceVersion=computeCaseDataVersion(source);
  const sourceExams=sourceExamDefinitions(source.sections.exam).filter(x=>x[3]);
  const rawPlan=deidentifyClinicalText(source.sections.plan);
  const actions=rawPlan.split(/[。\n]/).map(s=>s.trim()).filter(s=>s.length>4&&!/^(诊断|讨论|病例分析|参考文献)[:：]?$/.test(s));
  const historyFacts=sourceHistoryFacts(source.sections.history,true);
  const prompts:Record<string,string>={'起病与病程':'最早什么时候开始不舒服的？这几天有什么变化？','发热与处理':'有发烧吗？量过多少度，怎么处理的？','一般状态、进食及排泄':'这几天精神、吃喝、睡觉和大小便怎么样？','出生、喂养与生长发育':'出生和喂养情况怎么样？生长发育与同龄孩子相比如何？','既往、过敏、接种及家族史':'以前有类似情况吗？有过敏、住院或者家族相关疾病吗？','已用药物与院外处理':'已经用过什么药或做过什么处理？之后有什么变化？','呼吸相关症状':'有咳嗽、喘或呼吸费力吗？什么时候更明显？','水肿及尿液变化':'小便量和颜色有什么变化？哪里有肿？','疼痛及消化道症状':'哪里不舒服？疼痛、呕吐或大便有什么特点？','神经、意识与肢体功能':'发作时是什么样子？意识、活动和恢复情况怎么样？','黄疸、皮肤及出血':'皮肤颜色、皮疹或者出血是怎么出现和变化的？'};
  const questions=[...new Set(historyFacts.flatMap(f=>f.topics))].map(topic=>{
    const relevant=historyFacts.filter(f=>f.topics.includes(topic));
    return {topic,prompt:prompts[topic]??`请说说${topic}的情况。`,variants:[`能具体说说${topic}吗？`,`这方面最早有什么变化？`],followups:['后来呢？','处理以后有什么变化？','您刚才说的情况一直存在，还是有变化？'],factIds:relevant.map(f=>f.id),parentAnswer:relevant.map(f=>f.text).join('；'),childAnswer:relevant.filter(f=>f.childText).map(f=>f.childText).join('；')||'该主题由了解情况的照护者补充；不能让患儿背诵专业病史。',unavailable:'不能问出隐藏诊断、标准答案、未做检查的结果；原材料未记载的生活细节需说明具体核实事项，不凭空作阴性回答。'};
  });
  const band=toAgeBand(parseAgeToDays(source.age));
  const infant=band==='newborn'||band==='infant';
  const impaired=/昏迷|意识不清|神志不清|昏睡|不能言语|失语/.test(source.sections.exam.replace(/(?:无|未见|否认)[^，。；]{0,10}(?:昏迷|意识不清|神志不清|昏睡|不能言语|失语)/g,''));
  const childCanSpeak=!infant&&band!=='unknown'&&!impaired;
  for(const f of historyFacts){
    if(/出生|孕|产|疫苗|接种|家族|用药|治疗|检查|既往|过敏史/.test(f.text))f.actor='parent';
    if(childCanSpeak&&f.actor!=='parent'&&/诉.{0,4}(痛|疼|不舒服)|自觉|腹痛|头痛|头晕|口渴|乏力|恶心|不舒服|胸痛|咽痛|疼痛/.test(f.text)){
      const own=f.text.replace(/^.*?(?:诉|自觉)/,'').replace(/患儿|患者/g,'我');
      f.childText=/^我/.test(own)?own:'我感觉'+own;
    }
  }
  for(const q of questions){q.childAnswer=historyFacts.filter(f=>q.factIds.includes(f.id)&&f.childText).map(f=>f.childText).join('；')||(childCanSpeak?'该主题由了解情况的照护者补充；患儿仅回答自身能感知的部分，不背诵专业病史。':'本例当前不安排患儿语义台词，由了解情况的照护者补充。');}
  const exams:TeachingExam[]=[];const seen=new Set<string>();
  const allParts=[...new Set(ANATOMY_REGIONS.flatMap(r=>r.sites.map(s=>s.id)))];
  for(const part of allParts)for(const tool of instrumentsForSite(part)){
    const protocol=examProtocol(tool,part);if(!protocol)continue;
    const key=`${tool}:${part}`;if(seen.has(key))continue;seen.add(key);
    const group=groupForSite(part);
    const original=sourceExams.find(([t,p])=>t===tool&&p===part)??sourceExams.find(([t,p])=>t===tool&&p===group);
    const related=original??sourceExams.find(([,p])=>p===group);
    const measurement=/thermometer/.test(tool);
    const tempOriginal=measurement?(sourceExams.find(([t])=>t==='thermometer')??(source.vitals.temperature!==null?['thermometer','forehead','体温',`体温${source.vitals.temperature}℃`]:undefined)):undefined;
    let result:string,origin:TeachingExam['origin'],scope:TeachingExam['scope'];
    if(tempOriginal){result=`原记录体温信息：${tempOriginal[3]}。原记录未明确测量方式时，本次仅展示已有体温，不把该值认定为${tool==='axillary-thermometer'?'腋温':tool==='infrared-thermometer'?'额温':'耳温'}的新测量值。`;origin='source';scope='whole-region';}
    else if(original){result=original[3]+(part!==group?`。原文为${anatomyLabel(group)}整体描述，未独立分区；不能把整体所见自动定位为${anatomyLabel(part)}。`:'');origin='source';scope=part!==group?'whole-region':'local';}
    else if(related){result=`${anatomyLabel(group)}已有整体记录：${related[3]}。此处提供${anatomyLabel(part)}的操作说明，不从整体记录推断局部阴阳性。`;origin='reference';scope='whole-region';}
    else if(measurement||part==='growth'||/power|neuro|fontanelle|external-genitalia|plantar/.test(part)){result=`${protocol.normal} 本项无可核验的独立测量或分级，展示评估方法与参考，不生成患者数值。`;origin='reference';scope='reference';}
    else if(sourceHasSystemicExamConcern(source.sections.exam,source.sections.diagnosis)){result=`${protocol.normal} 本病例存在可能影响全身表现的病情，缺失局部结果采用参考说明，不擅自补为正常。`;origin='reference';scope='reference';}
    else{result=`教学模拟设定：${protocol.normal.replace('一般正常表现：','')}。此为补充操作场景，不是原患者新增实测记录。`;origin='teaching-simulation';scope='local';}
    const region=ANATOMY_REGIONS.find(r=>r.sites.some(s=>s.id===part));
    const aspect=region?.sites.find(s=>s.id===part)?.aspect;
    const postures:TeachingExam['postures']=infant||/abdomen|umbilicus|liver-spleen|groin|external-genitalia/.test(part)?['supine']:['standing','supine'];
    const examMedia=(mediaIndex[sourceId]??[]).filter(m=>m.examSite===part&&tool==='inspection').map(({fileId,kind,caption})=>({fileId,kind,caption}));
    exams.push({id:`teaching-exam-${tool}-${part}`,toolId:tool as TeachingExam['toolId'],bodyPartId:part as TeachingExam['bodyPartId'],label:`${anatomyLabel(part)}${tool==='inspection'?'观察':tool==='palpation'?'触诊':tool==='percussion'?'叩诊':tool==='stethoscope'?'听诊':'检查'}`,result,allowedPositions:aspect==='back'?(infant?['lateral']:['standing','sitting','lateral','prone']):/abdomen|umbilicus|liver-spleen|groin|external-genitalia/.test(part)?['supine']:infant?['supine','lateral']:['standing','supine','sitting','lateral','prone'],evidenceCode:tempOriginal?'SOURCE_EX_thermometer_forehead':original?`SOURCE_EX_${original[0]}_${original[1]}`:`TEACH_EX_${tool}_${part}`,postures,sourceLocator:related?`sections.exam:${group}`:'教学操作规范',origin,technique:protocol.technique,reaction:protocol.reaction,interpretation:protocol.normal,scope,...(aspect?{aspect}:{}),media:examMedia});
  }
  const tests:TeachingTest[]=[];
  const requested=[...new Set([...curriculum.tests,...TESTS.filter(t=>t.pattern.test(source.sections.tests)).map(t=>t.label),...(mediaIndex[sourceId]??[]).flatMap(m=>m.testLabel?[m.testLabel]:[]),'头颅MRI','血常规','尿常规'])];
  for(const label of requested){
    const spec=TESTS.find(t=>t.label===label||t.aliases.includes(label));
    const raw=sourceResult(source.sections.tests,label);
    const hasSourceMedia=(mediaIndex[sourceId]??[]).some(m=>m.testLabel===label);
    const brainConcern=hasAffirmedSourceMention(`${sourceId}\n${source.sections.diagnosis}\n${source.sections.exam}`,['脑','神经','癫痫','惊厥','窒息','意识障碍','昏迷','肝豆状']);
    const simulatedNormal=!raw&&!hasSourceMedia&&label==='头颅MRI'&&!curriculum.tests.includes(label)&&!brainConcern;
    const origin:TeachingTest['origin']=raw||hasSourceMedia?'source':simulatedNormal?'teaching-simulation':'reference';
    const rationale=simulatedNormal?'本例现有资料没有支持常规头颅MRI的神经系统指征，应优先完成与当前主要问题相关的评估；若出现新的意识、局灶神经表现或其他明确指征，可重新判断必要性。':curriculum.tests.includes(label)?`用于本例教学目标的${curriculum.focus.join('、')}评估；需结合实际病史、查体及检查风险确定时机。`:`只有相应鉴别诊断、治疗前评估、并发症或监测指征存在时才考虑；不能因最终结果正常而直接认定多余。`;
    const id=`teaching-test-${createHash('sha256').update(label).digest('hex').slice(0,10)}`;
    const media=[...(mediaIndex[sourceId]??[]),...(reportIndex[sourceId]??[])].filter(m=>m.testLabel===label).map(({fileId,kind,caption})=>({fileId,kind,caption}));
    if(simulatedNormal&&simulation.normalBrainMRI)media.push(simulation.normalBrainMRI);
    const rows=raw?extractLabRows(raw,label):[];
    tests.push({...(rows.length?{report:{name:label,specimen:'原记录未单列采样类型；按实际标本及检测方法核对',reference:spec?.reference??'以原实验室和相应年龄参考范围解释',origin,rows}}:{}),id,label,aliases:spec?.aliases??[],result:raw?`检查范围：${label}。\n客观记录：${raw}。\n记录时点：沿用原报告；原记录未标注时点时不擅自补日期。`:hasSourceMedia?`检查范围：${label}。\n原始图像材料已提供：以下展示去身份处理后的原图关键帧。原材料未提供可核验文字所见时，不从病名反推影像结论。\n范围说明：关键帧不是完整序列；请结合本次实际可见内容分析。`:simulatedNormal?'教学模拟正常报告：双侧大脑半球形态大致对称；本模拟检查范围内未展示明显局灶异常信号、占位效应或中线移位，脑室系统形态无明显扩大。\n说明：这是预先固定的教学模拟设定，不是原患者MRI；不据此排除所有神经系统疾病，也不用于细微征象识别评分。':`检查范围：${label}。\n教学参考报告：${spec?.reference??'本项需结合年龄、临床问题、标本与检测方法解释；提供评估内容，不编造原患者测量值。'}\n解释边界：本项为教学补充参考，尚无可核验患者结果；不把参考区间当作患者数值。`,origin,objective:curriculum.tests.includes(label)?curriculum.focus[0]:`针对${label}对应临床问题提出可检验假设`,reference:spec?.reference??'按原报告方法和适龄参考解释。',necessity:curriculum.tests.slice(0,2).includes(label)?'essential':curriculum.tests.includes(label)?'optional':simulatedNormal?'not-routine':'context-dependent',rationale,sourceLocator:raw?'sections.tests':'教学补充参考',media});
  }
  const rubric:TeachingRubricItem[]=[];
  const hxTopics=[...new Set(historyFacts.flatMap(f=>f.topics))];
  if(!hxTopics.length)hxTopics.push('主要不适');
  hxTopics.forEach((topic,i)=>rubric.push(criterion('history','basic',`hx-${i}`,`问清${topic}`,16/hxTopics.length,`用自然问法获取${topic}的本例已有信息；不要求照抄病历。`,'sections.history',historyFacts.filter(f=>f.topics.includes(topic)).map(f=>f.id))));
  rubric.push(criterion('history','advanced','hx-follow','围绕病程进行相关追问',4,`进一步问清${curriculum.focus.join('、')}；追问应承接已获得内容。`,'教学目标',[],curriculum.focus.map(x=>[...x.matchAll(/起病|时间|持续|变化|进展|诱因|用药|既往|家族|尿量|喂养|意识|体重/g)].map(m=>m[0])).filter(x=>x.length)));
  const examPriority=/糖尿病|酮症/.test(sourceId)?['general-state','skin','chest','abdomen','forehead']:/新生儿|胆汁|黄疸/.test(sourceId)?['general-state','skin','forehead','liver-spleen','abdomen','mouth']:/肺炎|哮喘|支气管|异物|呼吸/.test(sourceId)?['chest-lung','chest','finger','general-state','forehead']:/心|川崎/.test(sourceId)?['chest-heart','general-state','finger','upper-arm','skin','liver-spleen']:/脑|神经|癫痫|惊厥|肌无力/.test(sourceId)?['neuro','general-state','eyes','neck','forehead']:/肾|紫癜/.test(sourceId)?['limbs','skin','abdomen','upper-arm','general-state']:['general-state','skin','lymph-nodes','abdomen','forehead','neuro'];
  const sourceCandidates=[...new Map(exams.filter(e=>e.origin==='source').map(e=>[e.evidenceCode,e])).values()];
  const rank=(e:TeachingExam)=>{const i=examPriority.indexOf(groupForSite(e.bodyPartId));return i<0?99:i;};
  const coreExams=sourceCandidates.sort((a,b)=>rank(a)-rank(b)).slice(0,6);
  if(!coreExams.length)coreExams.push(exams.find(e=>e.bodyPartId==='general-state')!);
  rubric.push(criterion('exam','basic','exam-prep','手卫生与检查说明',4,'完成手卫生，向患儿和照护者解释检查，选择适当体位。','通用检查准备',['EX_PREP']));
  coreExams.forEach((e,i)=>rubric.push(criterion('exam','basic',`exam-${i}`,e.label,16/coreExams.length,`完成适用操作并获取${e.label}对应记录；整体记录不要求捏造分区结果。`,e.sourceLocator,[e.evidenceCode])));
  rubric.push(criterion('exam','advanced','exam-interpret','描述并解释查体所得',5,'用自己的话记录关键所见及临床含义，区分原记录、模拟设定和参考；不只罗列器材名称。','查体观察提交',[],[['所见','观察','查体','呼吸','皮肤','腹','心','神经'],['提示','考虑','支持','需','结合','异常','正常']]));
  const essential=tests.filter(t=>t.necessity==='essential');
  essential.forEach((t,i)=>rubric.push(criterion('tests','basic',`test-${i}`,`有目的地申请${t.label}`,8/essential.length,`针对本次临床问题申请${t.label}，说明其用途；有充分理由的合理替代方案可给分。`,t.sourceLocator,tests.filter(x=>x.id===t.id||t.label==='胸部影像'&&/^胸部/.test(x.label)||t.label==='头颅影像'&&/^头颅/.test(x.label)).map(x=>`TEACH_TEST_${x.id}`))));
  rubric.push(criterion('tests','advanced','tests-reason','解释检查目的与局限',2,'说明检查用于诊断、鉴别、治疗前评估或监测中的哪一项，并解释正常或异常结果的局限。','教学目标',[],[['诊断','鉴别','评估','监测','排除','判断'],['结合','局限','不能','不能排除','风险','依据']]));
  const diagnosisAliases:Record<string,string[]>={
    '1型糖尿病伴有酮症酸中毒':['糖尿病酮症酸中毒','DKA','1型糖尿病伴酮症酸中毒'],
    '儿童-肥胖症':['儿童肥胖症','肥胖症'], '心律失常-室上性心动过速':['室上性心动过速','室上速','SVT'],
    '特发性血小板减少性紫癜':['免疫性血小板减少症','ITP'], '过敏性紫癜':['IgA血管炎'],
    '新生儿abo溶血性黄疸':['新生儿ABO溶血病','ABO溶血性黄疸'], '新生儿rh溶血性黄疸':['新生儿Rh溶血病','Rh溶血性黄疸'],
    '肺炎支原体肺炎':['支原体肺炎','MPP'], '先天性肌无力':['先天性肌无力综合征'],
    '急性毛细支气管炎':['毛细支气管炎'], '急性白血病-急性淋巴细胞白血病':['急性淋巴细胞白血病','ALL'],
    '癫痫全面性发作阵挛性发作':['全面性阵挛发作','癫痫全面性发作'],
  };
  const sourceName=sourceId.replace(/^teacher-/,'');
  const firstDiagnosis=source.sections.diagnosis.split(/[\n；;]/).map(x=>x.trim()).find(x=>x.length>3&&!/^(?:初步诊断|临床诊断|主要诊断|诊断)[:：]?$/.test(x))?.replace(/^(?:[一二三四\d]+[.、)）]\s*|(?:初步诊断|临床诊断|主要诊断|诊断)[:：]\s*)/,'').split(/[，,]/)[0];
  const diagnosisPoint=criterion('diagnosis','basic','diagnosis-primary','主要诊断与关键依据',8,firstDiagnosis||sourceName,'sections.diagnosis',[],[[...new Set([title,sourceName,...(diagnosisAliases[sourceName]??[]),...(firstDiagnosis&&firstDiagnosis.length<70?[firstDiagnosis]:[])])]]);
  const broader=[sourceName.replace(/^新生儿|^急性|^重症|^暴发性/,'').split('-')[0],...(sourceName.match(/糖尿病|肺炎|肌无力|白血病|脑膜炎|脑炎|黄疸|肾炎|肾衰竭|贫血|性早熟|尿崩症|惊厥|癫痫/g)??[])];
  diagnosisPoint.partialConcepts=[[...new Set(broader)].filter(x=>x.length>2&&!['儿童','新生儿','婴儿'].includes(x))];
  rubric.push(diagnosisPoint);
  rubric.push(criterion('diagnosis','basic','diagnosis-evidence','用病例证据解释诊断',4,'将病史、体征和检查中的相关证据与诊断联系；正确简答可得分。','sections.diagnosis',[],[['病史','病程','症状','发热','咳嗽','多尿','黄疸','出血','水肿'],['体征','查体','检查','化验','影像','血','尿']]));
  rubric.push(criterion('diagnosis','advanced','diagnosis-differential','提出有依据的鉴别',3,`按本例表现考虑${curriculum.differentials.join('、')}等合理鉴别，并指出区分依据。`,'教学补充',[],[curriculum.differentials]));
  const seenPlan=new Set<string>();
  const planActions=actions.filter(a=>/治疗|给予|予以|用药|给药|输注|口服|静脉|肌注|监测|复查|补液|补钾|胰岛素|抗感染|抗生素|吸氧|氧疗|通气|光疗|换血|输血|激素|手术|住院|转诊|饮食|限制|随访|防治|纠正|停用|避免/.test(a)).filter(a=>{const key=JSON.stringify(concepts(a));if(seenPlan.has(key))return false;seenPlan.add(key);return true;});
  if(!planActions.length)planActions.push(curriculum.safety);
  planActions.forEach((a,i)=>rubric.push(criterion('plan','basic',`plan-${i}`,`处置要点${i+1}`,12/planActions.length,a,'sections.plan',[],concepts(a))));
  const safety=criterion('plan','basic','plan-safety','关键安全条件',4,curriculum.safety,'教学安全说明',[],concepts(curriculum.safety));
  if(sourceId.includes('酮症酸中毒')){safety.concepts=[['补液','液体'],['血钾','电解质','补钾'],['意识','神志','神经','脑水肿','精神变化','复评']];safety.unsafePhrases=['静脉推注胰岛素','常规补碱','不监测血钾'];}
  if(sourceId.includes('心肌炎'))safety.unsafePhrases=['常规大量快速补液','无需心电监护'];
  if(sourceId.includes('异物吸入'))safety.unsafePhrases=['盲目抠取异物','先等影像再处理气道'];
  rubric.push(safety);
  rubric.push(criterion('plan','advanced','plan-reassess','个体化复评与升级安排',4,'针对个体情况安排连续复评和随访，说明何种变化需要调整治疗、转诊或升级监护。','教学复评说明',[],[['复评','复查','随访','监测'],['调整','转诊','升级','恶化','加重','持续','如果']]));
  rubric.push(criterion('note','basic','note-core','病历保留关键事实和诊疗思路',4,'记录主诉、现病史、关键查体、已有检查、诊断及计划；简洁、准确即可，不要求篇幅。','病历模板',[],[['主诉','现病史','病史'],['查体','体格检查'],['诊断','考虑'],['计划','治疗','处置']]));
  rubric.push(criterion('note','advanced','note-boundary','记录来源、时点及未确定事项',1,'区分已获得记录、教学模拟、待核实事项，不把未检查项目写成阴性。','病历模板',[],[['原记录','模拟','待核实','未查','未行','参考','待回报']]));
  rubric.push(criterion('communication','basic','communication-core','向患儿家长说明安排和风险',4,'通俗说明当前判断、下一步安排及需要及时就医的危险变化，回应家长担忧。','沟通目标',[],[['目前','考虑','情况','可能'],['接下来','安排','治疗','检查','复查'],['如果','及时','立即','危险','加重']]));
  rubric.push(criterion('communication','advanced','communication-check','确认理解与可执行安排',1,'确认家长是否理解，给出可执行的复诊或监测安排。','沟通目标',[],[['理解','明白','疑问','担心','清楚'],['复诊','随访','复查','记录','观察']]));
  // Make published weights add up exactly at one decimal; half credit remains exact at two decimals.
  for(const section of ['history','exam','tests','diagnosis','plan','note','communication'] as const)for(const level of ['basic','advanced'] as const){
    const rows=rubric.filter(r=>r.section===section&&r.level===level);
    const target=Math.round(rows.reduce((sum,r)=>sum+r.maxScore,0)*10);
    const units=rows.map(r=>Math.floor(r.maxScore*10+1e-8));
    let remaining=target-units.reduce((sum,n)=>sum+n,0);
    const order=rows.map((r,i)=>({i,fraction:r.maxScore*10-units[i]})).sort((a,b)=>b.fraction-a.fraction);
    for(const candidate of order){if(remaining<=0)break;units[candidate.i]++;remaining--;}
    rows.forEach((r,i)=>r.maxScore=units[i]/10);
  }
  const historySection=(pattern:RegExp)=>historyFacts.filter(f=>pattern.test(f.text)).map(f=>f.text).join('；')||'原材料未单独记录；接诊时核实，不补为阴性。';
  const referenceNote={chiefComplaint:deidentifyClinicalText(source.complaint),presentIllness:deidentifyClinicalText(source.sections.history),pastHistory:historySection(/既往|平素|过敏|手术|外伤|住院|输血/),personalHistory:historySection(/胎|孕|产|出生|喂养|发育|接种|疫苗/),familyHistory:historySection(/家族|遗传|父母|家人|近亲/),physicalExam:deidentifyClinicalText(source.sections.exam),auxiliaryTests:deidentifyClinicalText(source.sections.tests),preliminaryDiagnosis:deidentifyClinicalText(source.sections.diagnosis),differentialDiagnosis:curriculum.differentials.join('；')+'（教学补充鉴别，需结合具体证据）',treatmentPlan:rawPlan};
  const link=Object.hasOwn(TEACHER_CASE_LINKS,item.id)?TEACHER_CASE_LINKS[item.id]:undefined;
  const relation:TeachingPackage['relation']=link?.relation??'independent';
  const subtypeNotes:Record<string,string>={
    'teacher-单纯肥胖症':'入口强调单纯肥胖；来源为儿童肥胖，鉴别继发病因依据沿用原材料，不额外虚构已排除结果。',
    'teacher-毛细支气管炎':'入口为较宽病名，来源为急性毛细支气管炎；病程、年龄和查体保持同一来源。',
    'teacher-大叶性肺炎':'入口强调影像形态，来源强调支原体病原；两者不是互斥新患者，不另造细菌感染证据。',
    'teacher-心律失常-阵发性室上性心动过速':'入口强调阵发性发作；来源为室上性心动过速，起止经过及心电资料只用原记录。',
    'teacher-急性白血病':'入口为上位病名，来源为急性淋巴细胞白血病；分型信息沿用同一患者，不虚构其他白血病亚型。',
    'teacher-癫痫':'入口为上位病名，来源为全面性阵挛发作；保留原发作形式，不泛化为所有发作类型。',
    'teacher-生长激素缺乏症-矮小症':'入口强调生长激素缺乏的病因判断，来源为矮小症；激发试验和病因证据仅沿用原材料，不补造确诊数值。',
    'teacher-糖原贮积病':'入口为上位病名，来源为IV型糖原贮积病；遗传、病理或分型证据不扩展成其他类型。',
  };
  const relationNote=relation==='independent'?'独立来源病例。':relation==='alias'?`入口“${title}”与来源“${sourceName}”为名称或写法关联，使用同一患者事实；不代表另一名患者。`:`${subtypeNotes[item.id]??'关联入口完整沿用同一来源患者事实。'} 原始诊断和检查结果不因入口名称改变。`;
  const content:Omit<TeachingPackage,'version'>={schemaVersion:1,caseId:item.id,sourceId,sourceVersion,relation,relationNote,title,age:source.age,sex:source.sex,reviewStatus:'automated-unreviewed',complaint:deidentifyClinicalText(source.complaint),persona:{appearance:`${source.age}、${source.sex}；采用相应年龄段与性别的通用教学形象，原病情外观依据查体原记录，不由头像推断。`,caregiver:'照护者身份与性别仅在原文有依据时确定，否则使用“家长/照护者”；不固定称妈妈。',speaking:!childCanSpeak?'以照护者陈述为主，婴儿无语义台词；非语言表现独立记录。':'按年龄与病情安排患儿回答自身感受，照护者补充病程、出生和治疗信息，不故意答非所问。',cooperation:'按解释与安抚调整配合方式；不随机改变病情，不为增加难度强行哭闹。',knowledgeBoundary:'仅知道已提供的生活观察与既往获知情况，不提供隐藏诊断、评分点或尚未进行的检查结果。'},roleState:{childCanSpeak,reason:infant?'年龄尚不适于语义应答':impaired?'原查体明确记录交流受限的意识或语言状态':band==='unknown'?'年龄资料不足':'年龄允许，限于已知主观感受',sourceLocator:impaired?'sections.exam':'age'},appearanceAssets:allowedPostures(source.age).flatMap(posture=>{const asset=patientAppearance(source.sex,posture,publicCaseId(item.id),source.age);return asset.src?[{assetId:asset.key,posture,publicPath:asset.src}]:[];}),historyFacts,questions,exams,tests,management:[...actions.map((detail,i)=>({title:`原诊疗经过 ${i+1}`,detail,origin:'source' as const,sourceLocator:`sections.plan#${i}`})),{title:'教学安全与复评',detail:curriculum.safety,origin:'reference',sourceLocator:curriculum.guide}],referenceNote,rubric,references:[{title:'原病例五段记录及附件（本地受控保存）',url:'local:source',accessedAt:'2026-11-07'},{title:'本病教学补充核对资料',url:curriculum.guide,accessedAt:'2026-11-07'},{title:'WHO 儿科检查与问诊原则',url:'https://www.ncbi.nlm.nih.gov/sites/books/NBK154441/',accessedAt:'2026-11-07'}]};
  const pack=teachingPackageSchema.parse({...content,version:teachingPackageVersion(content)});
  const total=pack.rubric.reduce((s,r)=>s+r.maxScore,0),basic=pack.rubric.filter(r=>r.level==='basic').reduce((s,r)=>s+r.maxScore,0);
  if(Math.abs(total-100)>.001||Math.abs(basic-80)>.001)throw new Error('RUBRIC_TOTAL_INVALID');
  // Recompute after schema defaults, keeping serialized bytes and version verification identical.
  pack.version=teachingPackageVersion(pack);
  const filename=`${String(ordinal+1).padStart(2,'0')}_${title.replace(/[<>:"/\\|?*]/g,'-')}`;
  const raw=JSON.stringify(pack,null,2);
  writeFileSync(path.join(root,'packages',`${pack.version}.json`),raw);writeFileSync(path.join(delivery,'json',`${filename}.json`),raw);
  entries[item.id]=pack.version;inventory.push({ordinal:ordinal+1,caseId:item.id,sourceId,title,relation:pack.relation,version:pack.version,sourceVersion,filename,historyFacts:historyFacts.length,exams:exams.length,tests:tests.length,rubricItems:rubric.length,mediaBindings:tests.reduce((n,t)=>n+t.media.length,0)});
}
if(inventory.length!==67||new Set(inventory.map(r=>r.sourceId)).size!==53)throw new Error('CATALOGUE_COUNT_INVALID');
writeFileSync(path.join(root,'index.next.json'),JSON.stringify({schemaVersion:1,entries},null,2));
renameSync(path.join(root,'index.next.json'),path.join(root,'index.json'));
writeFileSync(path.join(delivery,'index.json'),JSON.stringify(inventory,null,2));
writeFileSync(path.join(authoring,'build-summary.json'),JSON.stringify({entryCount:inventory.length,sourceCount:new Set(inventory.map(r=>r.sourceId)).size,historyFacts:inventory.reduce((n,r)=>n+r.historyFacts,0),exams:inventory.reduce((n,r)=>n+r.exams,0),tests:inventory.reduce((n,r)=>n+r.tests,0),rubricItems:inventory.reduce((n,r)=>n+r.rubricItems,0)},null,2));
console.log(JSON.stringify({entryCount:inventory.length,sourceCount:new Set(inventory.map(r=>r.sourceId)).size,packages:readdirSync(path.join(root,'packages')).length}));
