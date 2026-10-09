begin;

-- 教师导入与健康端点最小化（2026-10-13 第四轮）：
-- 1) 收紧 case_knowledge_health_counts：原设计允许 anon 执行（健康端点服务端 anon 探活
--    需要真实计数）。2026-10-13 安全审计结论：聚合计数虽不含病例内容，但暴露
--    会话数/持久化规模属于业务运营信息，不应向匿名公开。收紧为：
--    - 撤销 anon 与 PUBLIC 的 EXECUTE（保留 authenticated）；
--    - 函数体内加 app_is_teacher() 守卫，非教师调用直接返回 null（纵深防御：
--      即使未来误授权限，非教师也拿不到计数）。
--    健康端点公开信息改由新最小枚举 RPC case_knowledge_status 提供（见 2）。
-- 2) 新增 case_knowledge_status()：公开健康探活专用，仅返回单枚举字符串，
--    不返回任何计数、病例 ID、版本内容或内部路径：
--      unavailable —— 数据库/表不可达或函数异常
--      empty       —— 持久化 facts 0 行（未装载）
--      partial     —— facts>0 但 answers=0（教学事实已装载，教师对照答案缺失）
--      ready       —— facts>0 且 answers>0（双通道装载完成）
-- 3) 新增 case_snapshot_latest_version(p_case_id)：
--    - authenticated 可执行；返回该病例最新持久化 facts 的版本指纹（仅版本哈希文本，
--      不含病例内容），供冷启动场景（本地 knowledge/ 缺失）下 createSession 绑定版本，
--      之后学生按既有受控 RPC case_snapshot_get_facts 恢复教学事实；
--    - SECURITY DEFINER 读取版本列是该函数唯一目的（INVOKER 模式下学生被 facts 表
--      RLS（仅教师）过滤查不到版本，冷启动绑定将永远失败）；与既有
--      case_snapshot_get_facts 的 SECURITY DEFINER 模式一致；
--    - 版本指纹为分片 sha256 聚合哈希，非敏感业务数据。
-- 4) 不改历史迁移、不新增表、不修改既有表 RLS；函数体表名不带 schema 前缀。

-- 1) 收紧健康计数 RPC：仅教师
create or replace function case_knowledge_health_counts()
returns jsonb
language plpgsql
stable
security definer
as $$
begin
  if not app_is_teacher() then
    return null;
  end if;
  return jsonb_build_object(
    'persisted_facts_versions', (select count(*)::int from case_snapshot_facts),
    'persisted_answer_versions', (select count(*)::int from case_snapshot_answers),
    'bound_teacher_sessions', (select count(*)::int from training_sessions
      where case_id like 'teacher-%' and state->>'sourceSnapshotVersion' is not null)
  );
exception
  when others then
    return null;
end;
$$;

revoke all on function case_knowledge_health_counts() from public, anon;
grant execute on function case_knowledge_health_counts() to authenticated;

-- 2) 公开最小枚举健康 RPC：仅返回枚举状态，零业务计数
create or replace function case_knowledge_status()
returns text
language plpgsql
stable
security definer
as $$
declare
  v_facts int;
  v_answers int;
begin
  select count(*) into v_facts from case_snapshot_facts;
  select count(*) into v_answers from case_snapshot_answers;
  if v_facts = 0 then
    return 'empty';
  end if;
  if v_answers = 0 then
    return 'partial';
  end if;
  return 'ready';
exception
  when others then
    return 'unavailable';
end;
$$;

revoke all on function case_knowledge_status() from public;
grant execute on function case_knowledge_status() to anon, authenticated;

-- 3) 冷启动版本绑定 RPC：返回病例最新持久化版本指纹（仅版本文本，无内容）
create or replace function case_snapshot_latest_version(p_case_id text)
returns text
language sql
stable
security definer
as $$
  select f.version
  from case_snapshot_facts f
  where f.case_id = p_case_id
  order by f.created_at desc
  limit 1;
$$;

revoke all on function case_snapshot_latest_version(text) from public, anon;
grant execute on function case_snapshot_latest_version(text) to authenticated;

commit;
