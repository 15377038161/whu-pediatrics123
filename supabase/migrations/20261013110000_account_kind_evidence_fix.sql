-- account_kind 赋值依据修正（2026-10-13 第二轮）
-- 背景：上一轮迁移（20261013100000）用 display_name 前缀/名单匹配标记 test，与"不以昵称前缀当依据"的
--   授权边界冲突。本轮复核逐账号受控证据：
--   1) 统计探针A*（3 个）：scripts/verify-usage-stats.ts 以 usage-probe-* 邮箱真实 signup 并自建同名
--      profile 行（RLS self-insert），账号创建行为在受控脚本中可追溯 → test 标记成立，保留；
--   2) dbg / routeB：scripts/代码/external_identities 均无创建来源证据，仅凭昵称与文档描述标 test
--      → 违反赋值规则，回退 unknown（宁可少排除、不可凭名字猜测排除真实人）；
--   3) 4 个"用户"与 cx_238792026：普通 signup / 无 OAuth 绑定，无法证明真实教学学生 → 保持 unknown，正确；
--   4) E2E测试学员 / quiz-test：实际 app_role='teacher'，不在学生统计池，无需标记（上一轮名单匹配的
--      前置假设有误，本轮经 DB 核实修正）。
-- real 赋值规则（本迁移不执行任何 real 标记）：仅当账号存在官方真实 OAuth 绑定（external_identities
--   有 chaoxing 等官方身份行）或管理员受控核实后方可置 real；普通 signup / profile_bootstrap 自动补建
--   的 profile 一律不得标 real。
-- 边界：不改历史迁移文件；不改教师白名单/RLS；不删除任何账号或业务记录。

begin;

update profiles set account_kind = 'unknown'
where app_role = 'student'
  and account_kind = 'test'
  and display_name in ('dbg', 'routeB');

commit;
