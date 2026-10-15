begin;

-- 保留旧签名以兼容已部署客户端，但 p_app_role 已废弃，不参与任何分类或授权。
-- 新行分类只来自当前已认证会话的 app_is_teacher()；既有行审计分类不重写。
-- 原历史迁移保持不变；本迁移不新增教师白名单、不扩大媒体/RLS权限。

create or replace function sync_profile_identity(
  p_display_name text,
  p_student_no text,
  p_chaoxing_uid text,
  p_app_role text
)
returns boolean
language plpgsql
volatile
security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  insert into profiles (id, display_name, student_no, chaoxing_uid, app_role, created_at, updated_at)
  values (
    v_uid,
    coalesce(nullif(p_display_name, ''), '用户'),
    nullif(p_student_no, ''),
    nullif(p_chaoxing_uid, ''),
    case when app_is_teacher() is true then 'teacher' else 'student' end,
    now(),
    now()
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        student_no = excluded.student_no,
        chaoxing_uid = excluded.chaoxing_uid,
        updated_at = now()
  where profiles.display_name is distinct from excluded.display_name
     or profiles.student_no is distinct from excluded.student_no
     or profiles.chaoxing_uid is distinct from excluded.chaoxing_uid;
  return true;
end;
$$;

-- 最小授权：authenticated 可执行（只能写本人行，由函数内 auth.uid() 强制）；public/anon 拒绝。
revoke all on function sync_profile_identity(text, text, text, text) from public, anon;
grant execute on function sync_profile_identity(text, text, text, text) to authenticated;

commit;
