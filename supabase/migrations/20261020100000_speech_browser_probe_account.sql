-- 语音链浏览器验收探针账号受控标记（2026-10-20，口径同 20261013130000_case53_probe_account.sql）：
-- 证据：scripts/bootstrap-speech-browser-probe.ts（git 追踪受控脚本，一次性引导）创建
--   speech-browser-probe@luojia.dev（display_name=语音链浏览器探针，密码仅进程内随机生成、0600 凭据文件保存）。
-- 用途：verify-browser-speech-ui.mjs 真实浏览器语音链验收专用学生身份，
--   复用同一账号（不再每轮 signup 新探针），产生的训练会话/报告为测试业务记录，
--   经 account_kind='test' 从教师统计口径排除，不污染比赛统计。
-- 背景：既有浏览器凭据文件（演示学生）随 /tmp 清理丢失且不可恢复，按同一受控口径重建唯一探针。
-- 边界：不改教师白名单；不修改既有 RLS；仅受控证据标记，不做昵称前缀泛化匹配。


begin;


update profiles set account_kind = 'test'
where app_role = 'student'
  and account_kind = 'unknown'
  and display_name = '语音链浏览器探针';


commit;
