begin;

-- 登录身份同步 profiles（平台代理超星 OAuth 落地 realname/cxid 后，教师端可识别学生）：
-- 背景：平台代理超星登录（supabase-auth 技能 chaoxing-oauth.md/chaoxing-login.md 契约）把姓名/超星号
-- 随 user_metadata（realname/cxid）首建落库；但 profiles 行此前仅在学生完成首次训练报告时由
-- report_side_effects_save 补建——学生登录后未完成训练前 profiles 无行，教师学情统计无法识别"谁是谁"。
-- 修复：新增 sync_profile_identity RPC（SECURITY DEFINER），登录身份就绪时幂等 upsert 本人 profiles 行，
-- 仅维护 display_name/student_no/chaoxing_uid 三个身份列；app_role/account_kind 等审计列不触碰
--（既有行只更新身份列，新行 app_role 取调用方传入值——与学生完成报告补建的既有语义一致）。
-- 安全：auth.uid() 为空返回 false；只能写 id = auth.uid() 的本人行（无法触碰他人 profiles）；
-- 不修改教师白名单、不扩大任何 RLS；平台 SQL 守卫约束（无 SET search_path、表名不带前缀）与既有 RPC 一致。

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
    case when p_app_role in ('teacher', 'student') then p_app_role else 'student' end,
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
