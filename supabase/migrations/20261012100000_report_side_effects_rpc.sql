begin;


-- 报告副作用受控写入（新增迁移，不改已执行历史）：
-- 背景：ability_profiles 与 sync_outbox 自建库以来仅有 SELECT 策略（owner/teacher 读），
-- finish 路由此前以学生 JWT 直写两张表，真实数据库链路下被 RLS 拒绝（42501）；
-- 既有 finish 验证均走预览内存模式，未暴露该问题。
-- 修复：沿用 report_save_completed 的受控 RPC 模式，副作用（能力画像 upsert + 同步事件 outbox）
-- 由服务端 buildReport 产物驱动，经 RPC 写入，校验：
--   1) 登录（auth.uid() 非空）；
--   2) 会话归属本人（受保护 user_id 列，guard 触发器保证不可变）；
--   3) 会话 status='completed'（guard 保证单向不可回退）；
--   4) 会话已有经 report_save_completed 写入的报告（副作用只能跟随合法报告，不能凭空刷）；
--   5) 能力画像仅允许写本人行（user_id = auth.uid()），维度/建议由服务端报告产物传入；
--   6) outbox 事件幂等（event_id 唯一冲突忽略）。
-- 不放宽 RLS：两张表保持无学生 INSERT/UPDATE 策略，唯一写路径为本 RPC。
-- 注：平台 SQL 守卫禁止 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。


create or replace function report_side_effects_save(
  p_session_id uuid,
  p_ability jsonb,
  p_event_id text,
  p_event_payload jsonb
)
returns boolean
language plpgsql
volatile
security definer
as $$
declare
  v_session record;
begin
  if auth.uid() is null then
    return false;
  end if;
  -- 会话归属本人（受保护列）
  select user_id, status into v_session from training_sessions where id = p_session_id;
  if v_session is null or v_session.user_id is distinct from auth.uid() then
    return false;
  end if;
  -- 完成态门控（guard 触发器保证 completed 单向）
  if v_session.status is distinct from 'completed' then
    return false;
  end if;
  -- 副作用必须跟随已合法写入的报告（report_save_completed 是唯一报告写路径）
  if not exists (select 1 from training_reports where session_id = p_session_id) then
    return false;
  end if;
  -- 能力画像：仅本人行，维度/建议来自服务端报告产物
  insert into ability_profiles (user_id, dimensions, recommendation, source_report_id, updated_at)
  values (
    auth.uid(),
    p_ability->'dimensions',
    p_ability->'recommendation',
    (select id from training_reports where session_id = p_session_id limit 1),
    now()
  )
  on conflict (user_id) do update
    set dimensions = excluded.dimensions,
        recommendation = excluded.recommendation,
        source_report_id = excluded.source_report_id,
        updated_at = excluded.updated_at;
  -- 同步事件 outbox：幂等（event_id 冲突忽略）
  insert into sync_outbox (event_id, aggregate_type, aggregate_id, payload, status, next_attempt_at)
  values (p_event_id, 'learning_report', p_session_id, p_event_payload, 'pending', now())
  on conflict (event_id) do nothing;
  return true;
end;
$$;


revoke all on function report_side_effects_save(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function report_side_effects_save(uuid, jsonb, text, jsonb) to authenticated;


commit;
