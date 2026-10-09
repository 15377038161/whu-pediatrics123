begin;


-- 新注册学生 profiles 引导（新增迁移，不改已执行历史）：
-- 背景：profiles 表自建库以来无 auth.users 新用户触发器，历史 6 个学生 profile 为手工/种子数据。
-- 经真实学生 API 验收发现：新注册（含未来真实超星 OAuth 回跳落号）学生无 profiles 行，
-- report_side_effects_save 写 ability_profiles 时外键（ability_profiles.user_id -> profiles.id）失败。
-- 修复：report_side_effects_save 升级（签名新增 p_display_name）：
--   1) 缺 profiles 行时自动补建（app_role='student'，on conflict do nothing，幂等）；
--      display_name 由服务端从登录身份 metadata 传入（request-auth 已有同一回退链），RPC 不伪造姓名；
--   2) 既有校验链保持：登录 + 会话归属（受保护 user_id 列）+ status='completed'（guard 单向）+ 报告已合法写入；
--   3) 补建 profile 仅发生在学生完成一次合法训练报告时——不改变教师白名单、不扩大任何 RLS。
-- 注：平台 SQL 守卫禁止 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。


create or replace function report_side_effects_save(
  p_session_id uuid,
  p_display_name text,
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
  -- 会话归属本人（受保护列，guard 触发器保证不可变）
  select user_id, status into v_session from training_sessions where id = p_session_id;
  if v_session is null or v_session.user_id is distinct from auth.uid() then
    return false;
  end if;
  -- 完成态门控（guard 触发器保证 completed 单向不可回退）
  if v_session.status is distinct from 'completed' then
    return false;
  end if;
  -- 副作用必须跟随已合法写入的报告（report_save_completed 是唯一报告写路径）
  if not exists (select 1 from training_reports where session_id = p_session_id) then
    return false;
  end if;
  -- 新学生 profiles 引导：缺行补建（幂等，角色固定 student，不触碰教师白名单）
  insert into profiles (id, display_name, app_role, created_at, updated_at)
  values (auth.uid(), coalesce(nullif(trim(p_display_name), ''), '学生'), 'student', now(), now())
  on conflict (id) do nothing;
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


revoke all on function report_side_effects_save(uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function report_side_effects_save(uuid, text, jsonb, text, jsonb) to authenticated;


commit;
