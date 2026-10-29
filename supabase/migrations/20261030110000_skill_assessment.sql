begin;


-- 批次8·教师手机现场考核评分（功能包批次8：技能现场考核+手机评分；对齐既有惯例：手写 SQL 迁移经 db_execute 执行，不改历史迁移）。
-- 设计（2026-10-30 澄清确认）：
--   1) 评分项内置统一：skill_rubric_items 种子（rubric_version=1，8 项技能 × 5 个观察项），教师不可增删项，保证全班口径一致；
--   2) 逐项三档（2 达标 / 1 部分达标 / 0 未达标）+ NULL=未观察（不计分），汇总 0-100 分（sum/计分项满分），与训练报告 total_score 口径对齐；
--   3) 发布制：draft → 教师确认发布后学生才可见（skill_assessment_publish 服务端校验+固化总分）；补考生成新记录（retake_of 关联原考核），历史保留可对比。
--   边界：现场考核成绩独立于 OSCE 模拟参考评分与训练报告成绩，不互换算；成绩仅教学记录展示，不入 AI 生成、不构成唯一能力判定。


-- ============================================================
-- 1) 评分项种子表（内置统一评分项）
-- ============================================================
create table skill_rubric_items (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references skills(id),
  rubric_version integer not null default 1,
  item_key text not null check (btrim(item_key) <> ''),
  item_label text not null check (btrim(item_label) <> ''),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (skill_id, rubric_version, item_key)
);


create index skill_rubric_items_skill_idx on skill_rubric_items (skill_id, rubric_version);


-- 种子：8 项技能 × 5 个观察项（通用临床观察点，不构成唯一评分标准，不猜院校考核口径）。
insert into skill_rubric_items (skill_id, rubric_version, item_key, item_label, sort_order)
select s.id, 1, v.item_key, v.item_label, v.sort_order
from skills s
join (values
  ('pediatric-cpr', 'cpr-01', '评估环境安全并确认自身防护', 1),
  ('pediatric-cpr', 'cpr-02', '拍唤判断意识与呼吸（不超过 10 秒）', 2),
  ('pediatric-cpr', 'cpr-03', '胸外按压位置与手法正确', 3),
  ('pediatric-cpr', 'cpr-04', '按压通气比例与频率符合规范', 4),
  ('pediatric-cpr', 'cpr-05', '复苏后评估并正确求助', 5),
  ('neonatal-resuscitation', 'neo-01', '保暖与体位摆放正确', 1),
  ('neonatal-resuscitation', 'neo-02', '气道清理动作规范', 2),
  ('neonatal-resuscitation', 'neo-03', '正压通气手法与频率正确', 3),
  ('neonatal-resuscitation', 'neo-04', '胸外按压与通气协调', 4),
  ('neonatal-resuscitation', 'neo-05', '复苏后评估与转运准备', 5),
  ('lumbar-puncture', 'lp-01', '体位摆放与固定正确', 1),
  ('lumbar-puncture', 'lp-02', '无菌操作与消毒铺巾规范', 2),
  ('lumbar-puncture', 'lp-03', '进针部位选择与角度正确', 3),
  ('lumbar-puncture', 'lp-04', '脑脊液观察与留取规范', 4),
  ('lumbar-puncture', 'lp-05', '术后体位指导与观察', 5),
  ('bone-marrow-aspiration', 'bma-01', '穿刺部位选择与定位正确', 1),
  ('bone-marrow-aspiration', 'bma-02', '局部麻醉与无菌操作规范', 2),
  ('bone-marrow-aspiration', 'bma-03', '穿刺与抽吸手法正确', 3),
  ('bone-marrow-aspiration', 'bma-04', '涂片与标本留取规范', 4),
  ('bone-marrow-aspiration', 'bma-05', '术后压迫止血与观察', 5),
  ('thoracentesis', 'tc-01', '体位与穿刺点定位正确', 1),
  ('thoracentesis', 'tc-02', '无菌操作与麻醉规范', 2),
  ('thoracentesis', 'tc-03', '进针深度与抽液控制正确', 3),
  ('thoracentesis', 'tc-04', '穿刺中并发症观察', 4),
  ('thoracentesis', 'tc-05', '术后处理与记录完整', 5),
  ('abdominal-paracentesis', 'ap-01', '体位与穿刺点选择正确', 1),
  ('abdominal-paracentesis', 'ap-02', '无菌操作与麻醉规范', 2),
  ('abdominal-paracentesis', 'ap-03', '进针与放液速度控制正确', 3),
  ('abdominal-paracentesis', 'ap-04', '标本留取规范', 4),
  ('abdominal-paracentesis', 'ap-05', '术后观察与记录完整', 5),
  ('urinary-catheterization', 'uc-01', '无菌准备与核对正确', 1),
  ('urinary-catheterization', 'uc-02', '消毒与铺巾规范', 2),
  ('urinary-catheterization', 'uc-03', '导管插入手法正确', 3),
  ('urinary-catheterization', 'uc-04', '气囊固定与引流确认', 4),
  ('urinary-catheterization', 'uc-05', '记录与观察完整', 5),
  ('venipuncture', 'vp-01', '核对与沟通充分', 1),
  ('venipuncture', 'vp-02', '部位选择与止血带使用正确', 2),
  ('venipuncture', 'vp-03', '消毒与进针手法正确', 3),
  ('venipuncture', 'vp-04', '固定与调速规范', 4),
  ('venipuncture', 'vp-05', '拔针与按压处理正确', 5)
) v(slug, item_key, item_label, sort_order) on v.slug = s.slug
on conflict (skill_id, rubric_version, item_key) do nothing;


-- ============================================================
-- 2) 现场考核表（教师评分记录）
-- ============================================================
create table skill_assessments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null,
  student_id uuid not null,
  skill_id uuid not null references skills(id),
  rubric_version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published')),
  total_score numeric(5, 2),
  published_at timestamptz,
  assessment_at timestamptz not null default now(),
  note text,
  retake_of uuid references skill_assessments(id),
  client_event_id text not null check (btrim(client_event_id) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, client_event_id)
);


create index skill_assessments_teacher_idx on skill_assessments (teacher_id, created_at desc);
create index skill_assessments_student_idx on skill_assessments (student_id, skill_id, status);


-- ============================================================
-- 3) 逐项评分明细表
-- ============================================================
create table skill_assessment_scores (
  assessment_id uuid not null references skill_assessments(id) on delete cascade,
  item_key text not null check (btrim(item_key) <> ''),
  score smallint check (score in (0, 1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assessment_id, item_key)
);


-- ============================================================
-- 4) RLS：enable + 最小授权 + 策略
-- ============================================================
alter table skill_rubric_items enable row level security;
alter table skill_assessments enable row level security;
alter table skill_assessment_scores enable row level security;


revoke all on skill_rubric_items from public, anon;
-- 评分项为教学口径元数据：登录用户（学生/教师）全员可读；写权限不开放（种子由迁移维护）
grant select on skill_rubric_items to authenticated;


create policy skill_rubric_items_authenticated_select on skill_rubric_items
  for select to authenticated using (true);


revoke all on skill_assessments from public, anon;
grant select, insert, update on skill_assessments to authenticated;


create policy skill_assessments_teacher_all on skill_assessments
  for all to authenticated
  using (teacher_id = auth.uid() and app_is_teacher())
  with check (teacher_id = auth.uid() and app_is_teacher());


revoke all on skill_assessment_scores from public, anon;
grant select, insert, update, delete on skill_assessment_scores to authenticated;


create policy skill_assessment_scores_teacher_all on skill_assessment_scores
  for all to authenticated
  using (exists (
    select 1 from skill_assessments a
    where a.id = assessment_id
      and a.teacher_id = auth.uid()
      and app_is_teacher()
  ))
  with check (exists (
    select 1 from skill_assessments a
    where a.id = assessment_id
      and a.teacher_id = auth.uid()
      and app_is_teacher()
  ));


-- ============================================================
-- 5) 受控 RPC：发布固化与学生查询
-- ============================================================
-- 5.1 发布：服务端校验（本人/草稿/明细集合匹配评分项/至少 1 项计分）并原子固化总分
create or replace function skill_assessment_publish(p_assessment_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_assessment skill_assessments%rowtype;
  v_scored_count int;
  v_score_sum int;
  v_total numeric;
begin
  select * into v_assessment from skill_assessments where id = p_assessment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_assessment.teacher_id <> auth.uid() or not app_is_teacher() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_assessment.status <> 'draft' then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  -- 明细集合必须全部属于该技能当前 rubric 版本（防混入未定义项）
  if exists (
    select 1 from skill_assessment_scores s
    where s.assessment_id = p_assessment_id
      and not exists (
        select 1 from skill_rubric_items r
        where r.skill_id = v_assessment.skill_id
          and r.rubric_version = v_assessment.rubric_version
          and r.item_key = s.item_key
      )
  ) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  -- 至少 1 项计分（全未观察不可发布）；总分 = 得分和 / 计分项满分 × 100（未观察不计分母）
  select count(*), coalesce(sum(score), 0)
    into v_scored_count, v_score_sum
    from skill_assessment_scores
    where assessment_id = p_assessment_id and score is not null;
  if v_scored_count = 0 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  v_total := round(v_score_sum::numeric / (v_scored_count * 2) * 100, 2);

  update skill_assessments
     set status = 'published',
         total_score = v_total,
         published_at = now(),
         updated_at = now()
   where id = p_assessment_id;

  return jsonb_build_object(
    'assessmentId', p_assessment_id,
    'totalScore', v_total,
    'publishedAt', now()
  );
end;
$$;


revoke all on function skill_assessment_publish(uuid) from public, anon;
grant execute on function skill_assessment_publish(uuid) to authenticated;


-- 5.2 学生查询：本人已发布考核 + 逐项明细投影（成绩仅本人可见）
create or replace function skill_assessments_student()
returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(t order by t."publishedAt" desc, t."assessmentAt" desc), '[]'::jsonb)
  from (
    select
      a.id as "assessmentId",
      a.skill_id as "skillId",
      s.title as "skillTitle",
      a.total_score as "totalScore",
      a.assessment_at as "assessmentAt",
      a.published_at as "publishedAt",
      a.note as "note",
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'itemKey', sc.item_key,
          'itemLabel', r.item_label,
          'score', sc.score
        ) order by r.sort_order)
        from skill_assessment_scores sc
        join skill_rubric_items r
          on r.item_key = sc.item_key
         and r.skill_id = a.skill_id
         and r.rubric_version = a.rubric_version
        where sc.assessment_id = a.id
      ), '[]'::jsonb) as "items"
    from skill_assessments a
    join skills s on s.id = a.skill_id
    where a.student_id = auth.uid()
      and a.status = 'published'
  ) t;
$$;


revoke all on function skill_assessments_student() from public, anon;
grant execute on function skill_assessments_student() to authenticated;


commit;
