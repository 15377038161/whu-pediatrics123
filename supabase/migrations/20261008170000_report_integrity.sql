begin;

-- 报告防伪造（新增迁移，不改已执行历史）：
-- 1) training_reports 撤销学生全部直插/直读/直改策略：
--    此前学生可直插自选 total_score 的报告行（伪造成绩）、直读后自改（owner_update 已在前一迁移撤销）。
-- 2) 学生读取自己的报告走受控 RPC report_get_mine / report_list_mine：登录 + 受保护 user_id 列判定。
-- 3) 合法写入路径：finish 路由在服务端校验会话归属与完成后，经受控 RPC report_save_completed 写入。
--    RPC 校验：登录、会话归属本人（受保护 user_id 列）、会话 status='completed'（guard 触发器
--    保证 completed 单向不可回退）、会话已无报告（幂等，防重复刷写）。分数由服务端 buildReport
--    计算后作为参数传入，学生无法自选分数。
-- 4) 教师保持 teacher_select 全量只读；教师维护（删/改）沿用 app_is_teacher 策略（新增）。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。

-- ---- 撤销学生直接读写策略 ----
drop policy if exists reports_owner_insert on training_reports;
drop policy if exists reports_owner_read on training_reports;
drop policy if exists training_reports_user_insert on training_reports;
drop policy if exists training_reports_user_select on training_reports;

-- ---- 教师维护（此前已撤 owner_update；补教师改/删）----
create policy training_reports_teacher_manage on training_reports
  for all to authenticated using (app_is_teacher()) with check (app_is_teacher());

-- ---- 学生读自己报告：受控 RPC（受保护列判定）----
create or replace function report_list_mine()
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select coalesce(jsonb_agg(t.*), '[]'::jsonb) into v_rows
  from (
    select id, session_id, user_id, case_id, mode, total_score, status, data, created_at
    from training_reports
    where user_id = auth.uid()
    order by created_at desc
  ) t;
  return v_rows;
end;
$$;

revoke all on function report_list_mine() from public, anon;
grant execute on function report_list_mine() to authenticated;

-- ---- 合法写路径：完成后经服务端 RPC 写入（会话归属+完成态+幂等校验）----
create or replace function report_save_completed(
  p_report_id uuid,
  p_session_id uuid,
  p_case_id text,
  p_mode text,
  p_total_score integer,
  p_status text,
  p_data jsonb
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
  -- 会话必须归属本人（受保护 user_id 列）
  select user_id, status into v_session from training_sessions where id = p_session_id;
  if v_session is null or v_session.user_id is distinct from auth.uid() then
    return false;
  end if;
  -- 会话必须已完成（guard 触发器保证 completed 单向，不可回退重刷）
  if v_session.status is distinct from 'completed' then
    return false;
  end if;
  -- 幂等：会话已有报告则拒绝重复写入（防重复刷分）
  if exists (select 1 from training_reports where session_id = p_session_id) then
    return false;
  end if;
  insert into training_reports (id, session_id, user_id, case_id, mode, total_score, status, data, created_at)
  values (p_report_id, p_session_id, auth.uid(), p_case_id, p_mode, p_total_score, p_status, p_data, now())
  on conflict (id) do nothing;
  return true;
end;
$$;

revoke all on function report_save_completed(uuid, uuid, text, text, integer, text, jsonb) from public, anon;
grant execute on function report_save_completed(uuid, uuid, text, text, integer, text, jsonb) to authenticated;

commit;
