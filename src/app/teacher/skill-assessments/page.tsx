import { SkillAssessmentManager } from '@/components/skill-assessment-manager';


/**
 * 教师现场考核评分页（批次8）：
 * - 考核列表 / 新建草稿 / 逐项三档打分 / 发布 / 撤回 / 补考，全流程见 SkillAssessmentManager；
 * - 教师身份由布局门控；白名单教师（app_is_teacher）在 API 层与数据库 RLS 双重强制；
 * - 现场考核成绩独立于训练报告与模拟参考评分，不互换算、不入 AI 生成。
 */
export default function TeacherSkillAssessmentsPage() {
  return (
    <main>
      <SkillAssessmentManager />
    </main>
  );
}
