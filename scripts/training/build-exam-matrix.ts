/** Private authoring contract: case requirements, shared normal templates and the complete pairing matrix. */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ANATOMY_REGIONS,EXAM_INSTRUMENTS,anatomyLabel,instrumentsForSite} from '../../src/domain/exam-anatomy';
import {examProtocol} from '../../src/domain/exam-protocol';
import {teachingPackageSchema} from '../../src/domain/teaching-package';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';

const [runtimeDirectory,outputDirectory]=process.argv.slice(2);
if(!runtimeDirectory||!outputDirectory)throw new Error('Usage: build-exam-matrix <private-runtime> <private-output>');
const runtime=path.resolve(runtimeDirectory),output=path.resolve(outputDirectory);
if(!output.startsWith(path.resolve('outputs')+path.sep))throw new Error('PRIVATE_OUTPUT_REQUIRED');
mkdirSync(output,{recursive:true});
const index=JSON.parse(readFileSync(path.join(runtime,'index.json'),'utf8')) as {entries:Record<string,string>};
const toolName=(id:string)=>EXAM_INSTRUMENTS.find(item=>item.id===id)?.label??id;
const templates=ANATOMY_REGIONS.flatMap(region=>region.sites.flatMap(site=>instrumentsForSite(site.id).map(tool=>{
  const protocol=examProtocol(tool,site.id);if(!protocol)throw new Error('NORMAL_TEMPLATE_MISSING');
  return {key:`${tool}:${site.id}`,regionId:region.id,region:region.label,siteId:site.id,site:anatomyLabel(site.id),toolId:tool,tool:toolName(tool),aspect:site.aspect??'front',paired:site.paired??false,normal:protocol.normal,technique:protocol.technique,reaction:protocol.reaction};
})));
const matrix:Record<string,unknown>[]=[];const required:Record<string,unknown>[]=[];const caseSummary:Record<string,unknown>[]=[];
const originLabels:Record<string,string>={source:'原始记录','teaching-simulation':'固定教学模拟',reference:'参考说明（不是患者所见）'};
const positionLabels:Record<string,string>={standing:'站立',supine:'仰卧',sitting:'坐位',lateral:'侧卧',prone:'俯卧'};
const sources=new Set<string>();const usedSites=new Set<string>();const usedTools=new Set<string>();
for(const [caseOffset,[caseId,version]] of Object.entries(index.entries).entries()){
  const raw=JSON.parse(readFileSync(path.join(runtime,'packages',version+'.json'),'utf8'));
  const pack=teachingPackageSchema.parse(raw);
  if(pack.caseId!==caseId||teachingPackageVersion(raw)!==version)throw new Error('PACKAGE_VERSION_INVALID');
  sources.add(pack.sourceId);
  const caseMeta={number:caseOffset+1,title:pack.title,age:pack.age,sex:pack.sex,caseId,sourceId:pack.sourceId,sourceVersion:pack.sourceVersion,teachingVersion:version};
  caseSummary.push({...caseMeta,sourceFindings:pack.exams.filter(item=>item.origin==='source').length,simulatedFindings:pack.exams.filter(item=>item.origin==='teaching-simulation').length,referenceOnly:pack.exams.filter(item=>item.origin==='reference').length,relation:pack.relation,medicalReview:'未医学审定'});
  required.push({...caseMeta,criterion:'手卫生与检查说明',acceptedPairs:'手卫生与说明 / 检查前向患儿及照护者说明，调整适当体位',patientFinding:'准备操作，不是体征或患者数值',points:pack.rubric.find(item=>item.id==='exam-prep')?.maxScore??0,evidenceCodes:'EX_PREP',grading:'独立准备项；重复操作不重复记录或得分',medicalReview:'未医学审定'});
  const examCriteria=pack.rubric.filter(item=>item.section==='exam'&&item.evidenceCodes.length&&item.id!=='exam-prep');
  const codes=new Set(examCriteria.flatMap(item=>item.evidenceCodes));
  for(const exam of pack.exams){
    const template=templates.find(item=>item.key===`${exam.toolId}:${exam.bodyPartId}`);if(!template)throw new Error('PAIR_NOT_IN_CATALOGUE');
    const needed=codes.has(exam.evidenceCode),sourceBacked=exam.origin==='source';
    if(needed||sourceBacked){usedSites.add(exam.bodyPartId);usedTools.add(exam.toolId);}
    matrix.push({...caseMeta,region:template.region,site:template.site,siteId:exam.bodyPartId,tool:template.tool,toolId:exam.toolId,requiredGroup:needed?exam.evidenceCode:'',requirement:needed?'本例重点（同组为可接受操作选项）':sourceBacked?'本例已有记录':'其他适用操作',origin:exam.origin,originLabel:originLabels[exam.origin],scope:exam.scope,patientFinding:exam.result,normalTemplate:template.normal,procedure:exam.technique,reaction:exam.reaction,positions:(exam.allowedPositions??[]).map(value=>positionLabels[value]).join(' / '),aspect:exam.aspect??'front',defaultPolicy:sourceBacked?'优先原记录，不能被正常模板覆盖':exam.origin==='teaching-simulation'?'固定正常教学设定':'需核对是否可补固定正常设定；不得冒充患者实测',medicalReview:'未医学审定'});
  }
  for(const criterion of examCriteria){
    const choices=pack.exams.filter(exam=>criterion.evidenceCodes.includes(exam.evidenceCode));
    required.push({...caseMeta,criterion:criterion.label,acceptedPairs:choices.map(exam=>`${anatomyLabel(exam.bodyPartId)} / ${toolName(exam.toolId)}`).join('；'),patientFinding:[...new Set(choices.map(exam=>exam.result))].join('\n'),points:criterion.maxScore,evidenceCodes:criterion.evidenceCodes.join('；'),grading:'同一所见/证据组不重复得分',medicalReview:'未医学审定'});
  }
}
const catalogue=ANATOMY_REGIONS.map(region=>({id:region.id,label:region.label,sites:region.sites.map(site=>({id:site.id,label:anatomyLabel(site.id),usedBySourceOrObjective:usedSites.has(site.id),tools:instrumentsForSite(site.id).map(id=>({id,label:toolName(id)}))}))}));
const contract={schemaVersion:1,cases:Object.keys(index.entries).length,sources:sources.size,templates,catalogue,requirements:required,matrix,temperatureDisplay:{default:'axillary-thermometer',optional:['infrared-thermometer','tympanic-thermometer']},ui:'single-patient-canvas',reviewStatus:'automated-unreviewed'};
const matrixId=createHash('sha256').update(JSON.stringify(contract)).digest('hex');
writeFileSync(path.join(output,'exam-matrix.json'),JSON.stringify({matrixId,...contract},null,2),{mode:0o600});
const columnNames:Record<string,string>={number:'病例序号',title:'病例名称（教师专用）',age:'年龄',sex:'性别',caseId:'入口标识',sourceId:'独立来源标识',sourceVersion:'原始资料版本',teachingVersion:'教学补充版本',key:'组合标识',regionId:'大部位标识',region:'大部位',site:'小部位',siteId:'小部位标识',tool:'器材或方法',toolId:'器材标识',requiredGroup:'评分证据组',requirement:'本例用途',origin:'来源类型代码',originLabel:'来源类型',scope:'所见范围代码',patientFinding:'本例所见或参考说明',normalTemplate:'正常表现模板（非实测）',procedure:'操作过程',technique:'操作过程',normal:'正常表现模板（非实测）',reaction:'配合反应（模拟）',positions:'可执行体位',aspect:'观察面',defaultPolicy:'缺失结果处理规则',medicalReview:'医学审定状态',criterion:'独立评分点',acceptedPairs:'可接受部位与器材',points:'分值',evidenceCodes:'评分证据编号',grading:'评分说明',paired:'是否双侧',majorRegion:'大部位',sourceOrObjectiveUsesSite:'是否涉及原记录或教学目标',applicableTools:'适用器材或方法',sourceFindings:'原始记录组合数',simulatedFindings:'固定模拟组合数',referenceOnly:'仅参考组合数',relation:'入口关系'};
function csv(file:string,rows:Record<string,unknown>[]){
  const keys=Object.keys(rows[0]??{});const quote=(value:unknown)=>'"'+String(value??'').replace(/"/g,'""')+'"';
  writeFileSync(path.join(output,file),'\uFEFF'+[keys.map(key=>quote(columnNames[key]??key)).join(','),...rows.map(row=>keys.map(key=>quote(row[key])).join(','))].join('\r\n'),{mode:0o600});
}
csv('67例_查体矩阵索引.csv',caseSummary);
csv('67例_部位器材状态与正常模板.csv',matrix);csv('67例_重点查体与可接受操作.csv',required);csv('通用正常表现与器材部位.csv',templates);
const inventory=catalogue.flatMap(region=>region.sites.map(site=>({majorRegion:region.label,site:site.label,sourceOrObjectiveUsesSite:site.usedBySourceOrObjective,applicableTools:site.tools.map(tool=>tool.label).join('；')})));
csv('部位器材去重总表.csv',inventory);
const summary={matrixId,cases:contract.cases,sources:contract.sources,majorRegions:catalogue.length,sites:inventory.length,sourceOrObjectiveSites:usedSites.size,tools:usedTools.size,validPairs:templates.length,casePairs:matrix.length,requirementGroups:required.length,preparationGroups:caseSummary.length,referenceRows:matrix.filter(row=>row.origin==='reference').length,studentPayload:false};
if(summary.cases!==67||summary.sources!==53||matrix.length!==67*templates.length)throw new Error('MATRIX_COVERAGE_INVALID');
writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
