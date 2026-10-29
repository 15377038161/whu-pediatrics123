import type {TrainingReport,UserContext} from '@/domain/agent';

const privateReferenceCodes=new Set(['SOURCE_DIAGNOSIS_REFERENCE','SOURCE_PLAN_REFERENCE']);
export const studentReportRecommendation='根据本轮实际获得的问诊、查体和检查证据，复盘自己的诊断依据、鉴别与处置；完整标准病历由教师保留。';

/** Keep stored scores/submissions immutable; full source answers remain teacher-only. */
export function projectReportForRole(report:TrainingReport,role:UserContext['role']):TrainingReport {
  if(role==='teacher')return report;
  const evidence=report.evidence.filter(item=>!privateReferenceCodes.has(item.code));
  if(evidence.length===report.evidence.length)return report;
  return {...report,evidence,recommendation:studentReportRecommendation};
}
