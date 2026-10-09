-- 账号标记证据补全（2026-10-13 第二轮）：统计深探针账号受控标记
-- 背景：20261013110000 迁移已修正「按昵称前缀泛化标记」的违规——仅保留有受控创建证据的账号标记为 test，
--   dbg/routeB 因无任何受控创建溯源回退 unknown。
-- 本轮新增证据：scripts/verify-usage-stats-deep.ts（受控深度验收脚本，git 追踪）真实 signup 创建
--   display_name 前缀为「统计深探针」的学生探针账号（usage-deep-<stamp>@luojia.dev 邮箱、
--   进程内存凭据不落盘），与既有「统计探针A%」（verify-usage-stats.ts 创建）同属受控可溯源测试身份。
-- 规则：仅将脚本内显式声明的两个前缀（统计探针A% / 统计深探针%）标记为 test，不做泛化前缀匹配；
--   其余账号一律保持 unknown（无受控证据不改判，如需标记 real 由管理员受控 UPDATE）。
-- 边界：不改教师白名单；不修改既有 RLS；不标记任何 real 账号。

begin;

update profiles set account_kind = 'test'
where app_role = 'student'
  and account_kind = 'unknown'
  and display_name like '统计深探针%';

commit;
