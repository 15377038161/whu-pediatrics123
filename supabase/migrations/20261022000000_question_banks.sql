begin;


-- AI 题库闭环（阶段 F / D09 / W09）：教师题集生成→审核编辑→班级范围发布；学生 attempt 重练/续答/错题。
-- 原则：不改历史迁移、不动既有 43 题与已答数据（legacy 链保持原样可用）、不删既有 restrictive 策略。
-- 1) 新表：question_banks（题集）、bank_items（题目条目，含答案列——学生不可直读）、
--    question_bank_versions（发布冻结版本快照，答案冻结在快照内）、quiz_attempts（练习批次）、
--    attempt_answers（批次作答，首次提交终局）。
-- 2) 受控 RPC：quiz_bank_list_student（可见题集摘要）/ quiz_attempt_start（续答优先+一次进行中）/
--    quiz_attempt_answer（归属+幂等判分+完成迁移）/ quiz_attempt_state（本人批次详情）/
--    quiz_bank_publish（审核校验+版本冻结快照原子发布）。
-- 3) 收紧既有宽泛教师题库写策略（本批澄清明确授权，方案 12.4）：
--    quiz_questions 教师 for-all → 教师只读 + 项目管理员写（legacy 43 题由项目管理员维护）；
--    quiz_assignments 教师 for-all → 教师只读（分配/判分只能经既有受控 RPC）。
-- 4) 学生不可直读 bank_items / question_bank_versions（答案列与快照内答案）；
--    取题/判分/详情全部经 SECURITY DEFINER RPC 投影，作答前不返回 answer/explanation。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。


-- ============================================================
-- 1) 新表
-- ============================================================
create table question_banks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  description text,
  topic text,
  status text not null default 'draft' check (status in ('draft', 'ready_for_review', 'published', 'retired')),
  visibility text not null default 'own_class' check (visibility in ('own_class', 'platform')),
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table bank_items (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references question_banks(id) on delete cascade,
  stem text not null check (btrim(stem) <> ''),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  -- 答案必须是选项之一（jsonb ? 检查数组元素存在）
  answer text not null check (btrim(answer) <> '' and options ? answer),
  explanation text not null check (btrim(explanation) <> ''),
  knowledge_point text,
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  review_status text not null default 'draft' check (review_status in ('draft', 'approved', 'rejected')),
  source text not null default 'ai' check (source in ('ai', 'manual')),
  -- AI 生成幂等定位符：同一批次 requestId 重复生成返回既有草稿，不重复插入
  generation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create index bank_items_bank_idx on bank_items (bank_id, review_status);
create index bank_items_generation_idx on bank_items (bank_id, generation_id);


-- 发布冻结版本快照：items 为审核通过条目的完整冻结副本（含 answer/explanation，学生不可直读）。
-- 已有练习始终按其绑定版本判分，题集后续编辑/再发布不影响进行中与已完成批次。
create table question_bank_versions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references question_banks(id) on delete cascade,
  version integer not null check (version >= 1),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) >= 1),
  item_count integer not null check (item_count >= 1),
  published_at timestamptz not null default now(),
  unique (bank_id, version)
);


create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  bank_id uuid not null references question_banks(id) on delete cascade,
  version_id uuid not null references question_bank_versions(id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create index quiz_attempts_user_bank_idx on quiz_attempts (user_id, bank_id, status);
-- 一个学生对同一题集最多一个进行中批次（RPC advisory lock 外的并发兜底）
create unique index quiz_attempts_one_in_progress on quiz_attempts (user_id, bank_id) where status = 'in_progress';


create table attempt_answers (
  attempt_id uuid not null references quiz_attempts(id) on delete cascade,
  item_id uuid not null,
  submitted_answer text not null check (btrim(submitted_answer) <> ''),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, item_id)
);


-- ============================================================
-- 2) RLS：enable + 最小授权 + 策略
-- ============================================================
alter table question_banks enable row level security;
alter table bank_items enable row level security;
alter table question_bank_versions enable row level security;
alter table quiz_attempts enable row level security;
alter table attempt_answers enable row level security;


revoke all on question_banks, bank_items, question_bank_versions, quiz_attempts, attempt_answers from public, anon;
-- 题集/条目：维护者（owner）与项目管理员可读写（RLS 限定范围）
grant select, insert, update, delete on question_banks, bank_items to authenticated;
-- 版本快照/批次/作答：只读授权；写入只能经 SECURITY DEFINER 受控 RPC
grant select on question_bank_versions, quiz_attempts, attempt_answers to authenticated;


create policy question_banks_owner on question_banks
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy question_banks_admin on question_banks
  for all to authenticated using (app_is_teacher() and app_is_project_admin()) with check (app_is_teacher() and app_is_project_admin());


create policy bank_items_owner on bank_items
  for all to authenticated
  using (exists (select 1 from question_banks b where b.id = bank_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from question_banks b where b.id = bank_id and b.owner_id = auth.uid()));
create policy bank_items_admin on bank_items
  for all to authenticated
  using (app_is_teacher() and app_is_project_admin())
  with check (app_is_teacher() and app_is_project_admin());


-- 学生不可直读版本快照（快照含答案）；仅维护者与项目管理员可读版本历史
create policy question_bank_versions_owner on question_bank_versions
  for select to authenticated
  using (exists (select 1 from question_banks b where b.id = bank_id and b.owner_id = auth.uid()));
create policy question_bank_versions_admin on question_bank_versions
  for select to authenticated using (app_is_teacher() and app_is_project_admin());


create policy quiz_attempts_user_read on quiz_attempts
  for select to authenticated using (user_id = auth.uid());
create policy quiz_attempts_teacher_read on quiz_attempts
  for select to authenticated using (app_can_view_student(user_id));


create policy attempt_answers_read on attempt_answers
  for select to authenticated
  using (exists (
    select 1 from quiz_attempts a
    where a.id = attempt_id and (a.user_id = auth.uid() or app_can_view_student(a.user_id))
  ));


-- ============================================================
-- 3) 收紧既有宽泛教师题库写策略（澄清授权；方案 12.4）
-- ============================================================
-- quiz_questions：教师 for-all → 教师只读 + 项目管理员写。
-- legacy 43 题自此仅项目管理员可维护（平台统一维护口径）；教师读保留（题池状态直读依赖）。
drop policy if exists quiz_questions_teacher on quiz_questions;
create policy quiz_questions_teacher_read on quiz_questions
  for select to authenticated using (app_is_teacher());
create policy quiz_questions_admin_write on quiz_questions
  for all to authenticated
  using (app_is_teacher() and app_is_project_admin())
  with check (app_is_teacher() and app_is_project_admin());


-- quiz_assignments：教师 for-all → 教师只读。
-- 分配（quiz_fetch_questions）与判分（quiz_submit_answer）本就只能经受控 RPC；教师端统计 RPC 为 SECURITY DEFINER 不依赖此策略。
drop policy if exists quiz_assignments_teacher on quiz_assignments;
create policy quiz_assignments_teacher_read on quiz_assignments
  for select to authenticated using (app_is_teacher());


-- ============================================================
-- 4) 受控 RPC
-- ============================================================
-- 4.1 学生可见题集摘要（已发布 + platform 或本人所在 owner 班级；含本人练习概览）
create or replace function quiz_bank_list_student() returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(t order by t."updatedAt" desc), '[]'::jsonb)
  from (
    select
      b.id as "bankId",
      b.title,
      coalesce(b.description, '') as "description",
      coalesce(b.topic, '') as "topic",
      v.item_count as "itemCount",
      v.version,
      (b.visibility = 'platform') as "platformWide",
      (
        select count(*)::int from quiz_attempts a
        where a.user_id = auth.uid() and a.bank_id = b.id and a.status = 'completed'
      ) as "completedAttempts",
      (
        select round(max(r.rate)::numeric, 4) from (
          select (count(*) filter (where ans.is_correct))::numeric / nullif(count(*), 0) as rate
          from attempt_answers ans
          join quiz_attempts a2 on a2.id = ans.attempt_id
          where a2.user_id = auth.uid() and a2.bank_id = b.id and a2.status = 'completed'
          group by a2.id
        ) r
      ) as "bestCorrectRate",
      (
        select a3.id::text from quiz_attempts a3
        where a3.user_id = auth.uid() and a3.bank_id = b.id and a3.status = 'in_progress'
        order by a3.started_at desc limit 1
      ) as "inProgressAttemptId",
      b.updated_at as "updatedAt"
    from question_banks b
    join question_bank_versions v on v.id = b.current_version_id
    where b.status = 'published'
      and (
        b.visibility = 'platform'
        or exists (
          select 1 from cohort_members m
          join cohorts c on c.id = m.cohort_id
          where m.user_id = auth.uid()
            and m.role = 'student'
            and c.owner_id = b.owner_id
            and c.is_active::text in ('true', '1')
        )
      )
  ) t;
$$;


revoke all on function quiz_bank_list_student() from public, anon;
grant execute on function quiz_bank_list_student() to authenticated;


-- 4.2 学生批次详情投影：未作答题不含 answer/explanation；已作答题释放答案与解析（首次提交后释放规则）
create or replace function quiz_attempt_state(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer as $$
declare
  v_user uuid := auth.uid();
  v_attempt record;
  v_version record;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_attempt from quiz_attempts where id = p_attempt_id;
  if not found or v_attempt.user_id <> v_user then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_version from question_bank_versions where id = v_attempt.version_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'bankId', v_attempt.bank_id,
    'status', v_attempt.status,
    'startedAt', v_attempt.started_at,
    'completedAt', v_attempt.completed_at,
    'version', v_version.version,
    'itemCount', v_version.item_count,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'itemId', x.item->>'itemId',
          'stem', x.item->>'stem',
          'options', x.item->'options',
          'difficulty', x.item->>'difficulty',
          'knowledgePoint', x.item->>'knowledgePoint',
          'answered', ans.item_id is not null,
          'submittedAnswer', ans.submitted_answer,
          'isCorrect', ans.is_correct,
          'answer', case when ans.item_id is not null then x.item->>'answer' end,
          'explanation', case when ans.item_id is not null then x.item->>'explanation' end
        ) order by x.ord
      )
      from jsonb_array_elements(v_version.items) with ordinality as x(item, ord)
      left join attempt_answers ans
        on ans.attempt_id = p_attempt_id and ans.item_id = (x.item->>'itemId')::uuid
    ), '[]'::jsonb)
  );
end;
$$;


revoke all on function quiz_attempt_state(uuid) from public, anon;
grant execute on function quiz_attempt_state(uuid) to authenticated;


-- 4.3 开始/续答批次：同一题集最多一个进行中；p_fresh=true 时旧进行中批次记 abandoned（明确结束，不删记录）
create or replace function quiz_attempt_start(p_bank_id uuid, p_fresh boolean default false)
returns jsonb
language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_bank question_banks%rowtype;
  v_visible boolean;
  v_attempt record;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from profiles p where p.id = v_user and p.app_role = 'student') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_bank_id is null then raise exception 'INVALID_REQUEST' using errcode = '22023'; end if;
  select * into v_bank from question_banks where id = p_bank_id;
  if not found or v_bank.status <> 'published' or v_bank.current_version_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 可见性：platform 或本人所在 owner 班级（与 quiz_bank_list_student 同一谓词）
  v_visible := v_bank.visibility = 'platform' or exists (
    select 1 from cohort_members m
    join cohorts c on c.id = m.cohort_id
    where m.user_id = v_user and m.role = 'student'
      and c.owner_id = v_bank.owner_id and c.is_active::text in ('true', '1')
  );
  if not v_visible then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtext('quiz_attempt:' || v_user::text || ':' || p_bank_id::text));
  select * into v_attempt from quiz_attempts
  where user_id = v_user and bank_id = p_bank_id and status = 'in_progress'
  order by started_at desc limit 1;

  if found and not p_fresh then
    return quiz_attempt_state(v_attempt.id);
  end if;
  if found and p_fresh then
    -- 明确结束旧批次：保留已答记录与解析释放状态，不改判已有作答
    update quiz_attempts set status = 'abandoned', updated_at = now() where id = v_attempt.id;
  end if;

  insert into quiz_attempts (user_id, bank_id, version_id)
  values (v_user, p_bank_id, v_bank.current_version_id)
  returning * into v_attempt;
  return quiz_attempt_state(v_attempt.id);
end;
$$;


revoke all on function quiz_attempt_start(uuid, boolean) from public, anon;
grant execute on function quiz_attempt_start(uuid, boolean) to authenticated;


-- 4.4 批次作答判分：归属 + 幂等（首次提交终局）+ 全部作答即完成（原子迁移）
create or replace function quiz_attempt_answer(p_attempt_id uuid, p_item_id uuid, p_answer text)
returns jsonb
language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_attempt quiz_attempts%rowtype;
  v_version question_bank_versions%rowtype;
  v_item jsonb;
  v_answer text;
  v_explanation text;
  v_correct boolean;
  v_existing record;
  v_answered_count integer;
  v_completed boolean := false;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_attempt_id is null or p_item_id is null or p_answer is null or btrim(p_answer) = '' then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  select * into v_attempt from quiz_attempts where id = p_attempt_id;
  if not found or v_attempt.user_id <> v_user then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'ATTEMPT_CLOSED' using errcode = 'P0001'; end if;

  select * into v_version from question_bank_versions where id = v_attempt.version_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select x.item into v_item from jsonb_array_elements(v_version.items) as x(item)
  where x.item->>'itemId' = p_item_id::text;
  if v_item is null then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
  v_answer := v_item->>'answer';
  v_explanation := v_item->>'explanation';

  perform pg_advisory_xact_lock(hashtext('quiz_attempt_ans:' || p_attempt_id::text));
  -- 幂等：已作答题返回首次结果，不覆盖不刷分
  select * into v_existing from attempt_answers where attempt_id = p_attempt_id and item_id = p_item_id;
  if found then
    return jsonb_build_object(
      'correct', v_existing.is_correct,
      'answer', v_answer,
      'explanation', v_explanation,
      'alreadyAnswered', true,
      'submittedAnswer', v_existing.submitted_answer,
      'completed', false
    );
  end if;

  v_correct := (btrim(p_answer) = v_answer);
  insert into attempt_answers (attempt_id, item_id, submitted_answer, is_correct)
  values (p_attempt_id, p_item_id, btrim(p_answer), v_correct);

  select count(*) into v_answered_count from attempt_answers where attempt_id = p_attempt_id;
  if v_answered_count >= v_version.item_count then
    update quiz_attempts
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_attempt_id and status = 'in_progress';
    v_completed := true;
  end if;

  return jsonb_build_object(
    'correct', v_correct,
    'answer', v_answer,
    'explanation', v_explanation,
    'alreadyAnswered', false,
    'completed', v_completed
  );
end;
$$;


revoke all on function quiz_attempt_answer(uuid, uuid, text) from public, anon;
grant execute on function quiz_attempt_answer(uuid, uuid, text) to authenticated;


-- 4.5 题集发布（原子）：审核状态校验 + 选项唯一性校验 + 版本快照冻结 + 状态/可见性迁移。
-- platform 可见性仅项目管理员可设定（全平台内容由项目管理员审核开放，方案 11.5/12.4）。
create or replace function quiz_bank_publish(p_bank_id uuid, p_visibility text default null)
returns jsonb
language plpgsql volatile security definer as $$
declare
  v_user uuid := auth.uid();
  v_bank question_banks%rowtype;
  v_is_admin boolean;
  v_approved_count integer;
  v_invalid_options integer;
  v_version integer;
  v_version_id uuid;
  v_items jsonb;
  v_count integer;
begin
  if v_user is null or not app_is_teacher() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_bank_id is null then raise exception 'INVALID_REQUEST' using errcode = '22023'; end if;
  if p_visibility is not null and p_visibility not in ('own_class', 'platform') then
    raise exception 'INVALID_VISIBILITY' using errcode = '22023';
  end if;
  select * into v_bank from question_banks where id = p_bank_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_is_admin := app_is_project_admin();
  if v_bank.owner_id <> v_user and not v_is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_visibility = 'platform' and not v_is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select count(*) into v_approved_count from bank_items
  where bank_id = p_bank_id and review_status = 'approved';
  if v_approved_count < 1 then raise exception 'NO_APPROVED_ITEMS' using errcode = 'P0002'; end if;

  -- 选项唯一性（重复选项是制作缺陷，不得进入冻结版本）
  select count(*) into v_invalid_options from bank_items i
  where i.bank_id = p_bank_id and i.review_status = 'approved'
    and (select count(distinct o) from jsonb_array_elements_text(i.options) as t(o)) <> jsonb_array_length(i.options);
  if v_invalid_options > 0 then raise exception 'DUPLICATE_OPTIONS' using errcode = 'P0002'; end if;

  -- 冻结审核通过条目为版本快照（完整内容：含 answer/explanation/knowledgePoint）
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', i.id, 'stem', i.stem, 'options', i.options, 'answer', i.answer,
    'explanation', i.explanation,
    'knowledgePoint', i.knowledge_point, 'difficulty', i.difficulty
  ) order by i.created_at), '[]'::jsonb)
  into v_items
  from bank_items i
  where i.bank_id = p_bank_id and i.review_status = 'approved';
  v_count := jsonb_array_length(v_items);

  select coalesce(max(version), 0) + 1 into v_version from question_bank_versions where bank_id = p_bank_id;

  insert into question_bank_versions (bank_id, version, items, item_count)
  values (p_bank_id, v_version, v_items, v_count)
  returning id into v_version_id;

  update question_banks
  set current_version_id = v_version_id,
      status = 'published',
      visibility = coalesce(p_visibility, visibility),
      updated_at = now()
  where id = p_bank_id;

  return jsonb_build_object('bankId', p_bank_id, 'version', v_version, 'itemCount', v_count, 'versionId', v_version_id);
end;
$$;


revoke all on function quiz_bank_publish(uuid, text) from public, anon;
grant execute on function quiz_bank_publish(uuid, text) to authenticated;


commit;
