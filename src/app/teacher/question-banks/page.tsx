import { QuestionBankManager } from '@/components/question-bank-manager';

/**
 * 教师题集管理页（阶段 F / AI 题库闭环 D09）：
 * - AI 生成 → 逐题审核编辑 → 版本化发布 → 下架/修订再发布，全流程见 QuestionBankManager；
 * - 身份由布局门控负责；教师白名单（app_is_teacher）与归属权限（owner/项目管理员）
 *   在 API 层与数据库 RLS 双重强制，非白名单教师访问一律 403；
 * - 旧 43 题单题速练（quiz_questions legacy 链路）不受影响，学生端题库页与本页共用同一入口理念。
 */
export default function TeacherQuestionBanksPage() {
  return (
    <main>
      <QuestionBankManager />
    </main>
  );
}
