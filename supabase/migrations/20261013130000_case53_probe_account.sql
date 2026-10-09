-- 53 病例真实 API 验收探针账号受控标记（2026-10-13）：
-- 证据：scripts/bootstrap-case53-probe.ts（git 追踪受控脚本，一次性引导）创建
--   case53-probe@luojia.dev（display_name=病例53探针，密码仅进程内随机生成、0600 凭据文件保存）。
-- 用途：verify-case53-real-api.ts 全量 53 病例真实 API 验收专用学生身份，
--   复用同一账号（不再每轮 signup 新探针），产生的训练会话/报告为测试业务记录，
--   经 account_kind='test' 从教师统计口径排除，不污染比赛统计。
-- 边界：不改教师白名单；不修改既有 RLS；仅受控证据标记，不做昵称前缀泛化匹配。

begin;

update profiles set account_kind = 'test'
where app_role = 'student'
  and account_kind = 'unknown'
  and display_name = '病例53探针';

commit;
