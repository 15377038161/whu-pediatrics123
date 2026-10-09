begin;


-- 清理废弃重载（不改已执行历史，追加迁移）：
-- report_side_effects_save 最初为 4 参数签名（无 p_display_name），后升级为 5 参数版本
-- （新增新学生 profiles 引导）。两个重载并存期间调用走 5 参数版本；本迁移移除 4 参数
-- 旧重载，避免同名函数按 SQL 解析规则（proname + 参数个数不敏感的隐患）引发误调用。
-- 仅 authenticated 拥有执行权限，保持收紧状态。

drop function if exists report_side_effects_save(uuid, jsonb, text, jsonb);

commit;
