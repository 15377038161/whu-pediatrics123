import type { SessionState } from '@/domain/agent';
import { getCase, type FlagshipCase } from '@/domain/case';
import { readTeachingPackage } from './teaching-package-store';

export function sessionTeachingPackage(session:SessionState){
  return session.teachingPackageVersion?readTeachingPackage(session.caseId,session.teachingPackageVersion,session.sourceSnapshotVersion):null;
}
export function sessionTeachingCase(session:SessionState):FlagshipCase {
  const base=getCase(session.caseId,session.sourceSnapshotVersion,session.id);
  const pack=sessionTeachingPackage(session);
  if(!pack)return base;
  return {...base,
    exams:[...base.exams.filter(e=>e.evidenceCode==='EX_PREP'),...pack.exams.map(exam=>({
      id:exam.id,toolId:exam.toolId,bodyPartId:exam.bodyPartId,label:exam.label,evidenceCode:exam.evidenceCode,
      result:[`【${exam.origin==='source'?'原记录':exam.origin==='reference'?'操作与参考说明':'教学模拟'}】${exam.result}`,`操作：${exam.technique}`,`配合反应：${exam.reaction}`].join('\n'),
      requires:['EX_PREP'],risk:'attention' as const,postures:exam.postures,media:exam.media,
    }))],
    tests:pack.tests.map(test=>({id:test.id,report:test.report,label:test.label,aliases:test.aliases,indication:'按临床问题申请后查看结果',
      result:[`【${test.origin==='source'?'原记录':test.origin==='reference'?'检查参考说明':'教学模拟'}】${test.label}`,test.result,test.reference?`参考信息：${test.reference}`:''].filter(Boolean).join('\n'),
      evidenceCode:`TEACH_TEST_${test.id}`,appropriate:null,media:test.media})),
  };
}
