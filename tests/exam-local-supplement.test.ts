import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyExamLocalSupplements} from '../src/domain/exam-authoring-selection';
import {teachingPackageSchema,type TeachingPackage} from '../src/domain/teaching-package';
import {teachingPackageVersion} from '../src/lib/teaching-package-store';

function fixture():TeachingPackage{
  const exam=(id:string,origin:'source'|'reference',scope:'local'|'whole-region'|'reference')=>({
    id,toolId:'palpation',bodyPartId:'abdomen',label:'腹部触诊',result:origin==='source'?'整体原记录：腹软。':'一般正常表现参考，不是本例结果。',
    postures:['supine'],allowedPositions:['supine'],sourceLocator:'synthetic',evidenceCode:`TEACH_${id}`,
    origin,technique:'合成操作',reaction:'合成反应',interpretation:'合成解释',scope,media:[],
  });
  const pack=teachingPackageSchema.parse({
    schemaVersion:1,caseId:'teacher-synthetic',sourceId:'teacher-synthetic',sourceVersion:'source-v1',version:'pending',relation:'independent',
    title:'合成局部补充',age:'8岁',sex:'男',reviewStatus:'automated-unreviewed',complaint:'合成主诉',
    persona:{appearance:'合成',caregiver:'家长',speaking:'自然',cooperation:'可配合',knowledgeBoundary:'仅已知事实'},
    historyFacts:[],exams:[exam('whole','source','whole-region'),exam('local','source','local'),exam('reference','reference','reference')],
    tests:[],management:[],referenceNote:{},rubric:[],references:[],
  });
  pack.version=teachingPackageVersion(pack);return pack;
}

const selection={id:'whole',state:'normal' as const,result:'固定局部教学补充：局部腹部触诊柔软，无固定压痛。',rationale:'合成整体记录没有局部独立所见，仅测试受控显式补充。',origin:'teaching-simulation' as const};
const binding=(pack:TeachingPackage)=>({caseId:pack.caseId,sourceVersion:pack.sourceVersion,inputTeachingVersion:pack.version,selections:[selection]});

test('local supplement changes only the new field and participates in the package hash',()=>{
  const pack=fixture(),before=JSON.stringify(pack),original=pack.exams[0];
  const output=applyExamLocalSupplements(pack,binding(pack));
  assert.equal(JSON.stringify(pack),before,'输入包不得被原地修改');
  assert.equal(output.version,'');
  output.version=teachingPackageVersion(output);
  assert.notEqual(output.version,pack.version);
  const supplemented=output.exams[0];
  const {localSupplement,...rest}=supplemented;
  assert.deepEqual(rest,original,'原文、来源、scope、证据码与操作均不得改变');
  assert.equal(localSupplement?.origin,'teaching-simulation');
  assert.equal(localSupplement?.scope,'local');
  assert.equal(localSupplement?.reviewStatus,'automated-unreviewed');
  assert.throws(()=>applyExamLocalSupplements(output,binding(output)),/LOCAL_SUPPLEMENT_ALREADY_EXISTS/);
});

test('local supplement rejects local source rows, reference rows and stale bindings',()=>{
  const pack=fixture();
  for(const id of ['local','reference'])assert.throws(()=>applyExamLocalSupplements(pack,{...binding(pack),selections:[{...selection,id}]}),/LOCAL_SUPPLEMENT_REQUIRES_WHOLE_SOURCE/);
  assert.throws(()=>applyExamLocalSupplements(pack,{...binding(pack),inputTeachingVersion:'stale'}),/AUTHORING_BINDING_MISMATCH/);
  assert.throws(()=>applyExamLocalSupplements(pack,{...binding(pack),selections:[selection,selection]}),/DUPLICATE_SELECTION/);
  assert.throws(()=>applyExamLocalSupplements(pack,{...binding(pack),selections:[{...selection,result:'资料未提供，本次未获得结果，仅供参考，不能作为本例独立结果。'}]}),/INDEPENDENT_RESULT_REQUIRED/);
});
