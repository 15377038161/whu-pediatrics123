import type { SessionState } from '@/domain/agent';
import { getCase, type FlagshipCase } from '@/domain/case';
import { readTeachingPackage } from './teaching-package-store';
import type {TeachingExam} from '@/domain/teaching-package';

export function teachingExamResult(exam:TeachingExam,mode:SessionState['mode']):string{
  const origin=exam.origin==='source'?'原记录':exam.origin==='reference'?'操作与参考说明':'教学模拟';
  if(mode==='osce'&&exam.origin==='reference')return '【操作与参考说明】该项缺少独立患者查体记录，本次不提供患者结论或测量值。请记录已完成的检查及资料局限。';
  // 制作层保留完整原文；本次只释放选中定位的固定所见，不能顺带披露同一整体记录中的其他位置。
  const finding=exam.localSupplement
    ?`【局部教学补充 · 非原患者实测】${exam.localSupplement.result}`
    :`【${origin}】${exam.result}`;
  return mode==='osce'?finding:[finding,`操作：${exam.technique}`,`配合反应：${exam.reaction}`].join('\n');
}

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
      result:teachingExamResult(exam,session.mode),
      requires:['EX_PREP'],risk:'attention' as const,postures:exam.postures,media:exam.media,
    }))],
    tests:pack.tests.map(test=>({id:test.id,report:test.report,label:test.label,aliases:test.aliases,indication:'按临床问题申请后查看结果',
      result:[`【${test.origin==='source'?'原记录':test.origin==='reference'?'检查参考说明':'教学模拟'}】${test.label}`,test.result,test.reference?`参考信息：${test.reference}`:''].filter(Boolean).join('\n'),
      evidenceCode:`TEACH_TEST_${test.id}`,appropriate:null,media:test.media})),
  };
}
