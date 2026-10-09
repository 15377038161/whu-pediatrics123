begin;

-- 教师单例上下架（发布状态）：
-- 语义：无行 = 已发布（缺省开放，兼容现状 53 入口）；教师下架插入 (case_id, published=false)；
-- 重新上架 update published=true（保留行作审计痕迹）。下架是可恢复停用：
-- 不删除 case_snapshot_facts/answers 原文，不触碰历史会话与成绩。
-- 幂等初始化（facts/answers 导入）不写本表，因此不会重置教师的下架决定。
--
-- RLS：
-- - select：authenticated 可读（学生目录过滤与新建训练守卫需要知道发布状态；
--   仅 case_id/published/updated_at，无患者原文）；
-- - 教师全量维护（insert/update）via app_is_teacher()；
-- - 匿名（anon）不可读：不向未登录方公开病例清单。
-- 注：对象名不带 schema 前缀，由租户代理按项目 schema 解析（与工具约束一致）。

create table case_publication (
  case_id text primary key,
  published boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  reason text not null default ''
);

alter table case_publication enable row level security;

create policy case_publication_select on case_publication
  for select to authenticated using (true);

create policy case_publication_teacher_manage on case_publication
  for all to authenticated using (app_is_teacher()) with check (app_is_teacher());

-- 显式最小授权（默认 PUBLIC 无权限，保持显式）
revoke all on case_publication from anon, public;
grant select on case_publication to authenticated;

commit;
