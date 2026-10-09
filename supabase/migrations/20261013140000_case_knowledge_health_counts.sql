begin;

-- 病例知识库装载健康计数 RPC（2026-10-13 只读诊断后续实施）：
-- 目的：生产启动缺 53 源时，/api/health/integrations 可给出明确非敏感健康状态
-- （DB 持久化版本数 / 已绑定版本会话数），替代"静默资料不足"。
-- 安全边界：
--   1. 仅返回聚合计数（三个数字），不返回任何病例原文、患者事实、版本内容、
--      病例 ID 列表——计数本身不构成敏感信息泄露；
--   2. SECURITY DEFINER：绕过表级 RLS 读取全量计数是本函数的唯一目的（INVOKER
--      模式下教师外身份被 RLS 过滤只能看到 0，健康探活将永远误报"未装载"）；
--      与既有 case_snapshot_get_facts 的 SECURITY DEFINER 模式一致；
--   3. 不改历史迁移、不新增表、不修改既有 RLS 策略；
--   4. anon 也可执行：健康端点（/api/health/integrations）以服务端 anon 凭据
--      探活，无教师登录态时仍需真实计数判断装载状态。

create or replace function case_knowledge_health_counts()
returns jsonb
language sql
stable
security definer
as $$
  select jsonb_build_object(
    'persisted_facts_versions', (select count(*)::int from case_snapshot_facts),
    'persisted_answer_versions', (select count(*)::int from case_snapshot_answers),
    'bound_teacher_sessions', (select count(*)::int from training_sessions
      where case_id like 'teacher-%' and state->>'sourceSnapshotVersion' is not null)
  );
$$;

revoke all on function case_knowledge_health_counts() from public;
grant execute on function case_knowledge_health_counts() to anon, authenticated;

commit;
