begin;

-- report_get_mine 补充（新增迁移，不改已执行历史）：
-- 学生按 ID 读自己单份报告：登录 + 受保护 user_id 列判定。
-- 与 report_list_mine（列表）/ report_save_completed（写入）构成完整受控读写集。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。

create or replace function report_get_mine(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
begin
  if auth.uid() is null then
    return null;
  end if;
  select id, session_id, user_id, case_id, mode, total_score, status, data, created_at
  into v_row from training_reports where id = p_report_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function report_get_mine(uuid) from public, anon;
grant execute on function report_get_mine(uuid) to authenticated;

commit;
