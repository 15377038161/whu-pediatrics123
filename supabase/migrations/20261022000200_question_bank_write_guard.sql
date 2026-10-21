begin;



-- F-题库补验-02：D09 权限/幂等缺口收口（2026-10-22，基线 32b2565）。
-- 取证坐实（租户只读直查）：
--   1) question_banks_owner 为 ALL 且仅 owner_id = auth.uid()，无教师条件——任意 authenticated
--      （含学生）可 INSERT 自属行后直改 status/visibility/current_version_id 绕过发布审核；
--      bank_items_owner 同样仅按父题集 owner 归属、无教师门控。
--   2) quiz_attempt_answer 在重复作答检查与加锁之前先拒绝 status <> 'in_progress'，
--      最后一题提交成功后的网络重试返回 ATTEMPT_CLOSED，不满足首次终局幂等。
--   3) 平台默认授权使 authenticated 在五表上均持有 arwd（覆盖迁移里 grant select 的意图），
--      版本快照/批次/作答虽无写策略被 RLS 阻断，仍按最小权限显式 REVOKE 写授权收口。
--   4) quiz_attempt_start 未校验 current_version_id 归属该题集（跨题集版本引用无守卫）。
-- 边界：不改历史迁移、不放宽任何 RLS、不删除现存数据（取证审计五表均为 0 行）、不造宽权限后门。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀，与既有模式一致。



-- ============================================================
-- 1) question_banks owner 策略拆分 + 教师门控（收紧，不放宽）
--    非教师（含学生）不再有任何直写路径；owner 仍可读自己题集（保留既有只读面）。
-- ============================================================
drop policy if exists question_banks_owner on question_banks;

create policy question_banks_owner_select on question_banks
  for select to authenticated
  using (owner_id = auth.uid());

create policy question_banks_owner_insert on question_banks
  for insert to authenticated
  with check (owner_id = auth.uid() and app_is_teacher());

create policy question_banks_owner_update on question_banks
  for update to authenticated
  using (owner_id = auth.uid() and app_is_teacher())
  with check (owner_id = auth.uid() and app_is_teacher());

create policy question_banks_owner_delete on question_banks
  for delete to authenticated
  using (owner_id = auth.uid() and app_is_teacher());



-- ============================================================
-- 2) bank_items owner 策略加教师门控（收紧，不放宽）
-- ============================================================
drop policy if exists bank_items_owner on bank_items;

create policy bank_items_owner on bank_items
  for all to authenticated
  using (
    app_is_teacher()
    and exists (select 1 from question_banks b where b.id = bank_items.bank_id and b.owner_id = auth.uid())
  )
  with check (
    app_is_teacher()
    and exists (select 1 from question_banks b where b.id = bank_items.bank_id and b.owner_id = auth.uid())
  );



-- ============================================================
-- 3) 发布字段触发器守卫：发布字段（status/visibility/current_version_id/owner_id）
--    只能经正确授权路径变更——项目管理员策略路径，或 quiz_bank_publish 原子发布 RPC
--    （以事务级 GUC 标记识别）。owner 教师 UPDATE 仅允许：
--      - title/description/topic 元信息；
--      - 与应用层 BANK_STATUS_TRANSITIONS 完全一致的工作流迁移白名单
--        （draft→ready_for_review、ready_for_review→draft、published→retired、retired→draft；
--        published 只能经发布 RPC 达成，visibility/current_version_id 不可直改）。
--    owner 教师 INSERT 强制发布字段取缺省值（draft/own_class/无版本），防止带发布态建行。
-- ============================================================
create or replace function question_banks_publish_guard() returns trigger
language plpgsql as $$
declare
  v_admin boolean;
  v_via_publish_rpc boolean;
begin
  v_admin := app_is_teacher() and app_is_project_admin();
  v_via_publish_rpc := coalesce(current_setting('app.quiz_bank_publish', true), 'off') = 'on';
  if v_admin or v_via_publish_rpc then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.visibility := 'own_class';
    new.current_version_id := null;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id
     or new.visibility is distinct from old.visibility
     or new.current_version_id is distinct from old.current_version_id then
    raise exception 'PUBLISH_FIELDS_PROTECTED' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'ready_for_review')
    or (old.status = 'ready_for_review' and new.status = 'draft')
    or (old.status = 'published' and new.status = 'retired')
    or (old.status = 'retired' and new.status = 'draft')
  ) then
    raise exception 'STATUS_TRANSITION_FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function question_banks_publish_guard() from public, anon;

create trigger question_banks_publish_guard_trigger
  before insert or update on question_banks
  for each row execute function question_banks_publish_guard();



-- ============================================================
-- 4) quiz_bank_publish：发布 UPDATE 前设置事务级标记，供触发器识别原子发布路径。
--    其余逻辑与 20261022000000 版一致（教师门控/owner 或管理员/审核校验/选项去重/冻结快照）。
-- ============================================================
create or replace function quiz_bank_publish(p_bank_id uuid, p_visibility text default null)
returns jsonb
language plpgsql security definer as $$
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

  perform set_config('app.quiz_bank_publish', 'on', true);
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



-- ============================================================
-- 5) quiz_attempt_start：补版本归属守卫（current_version_id 必须属于该题集，
--    杜绝跨题集版本引用）；fresh 废弃旧批次仅作用于仍进行中的行
--    （与并发判分交错时不把已完成批次降级为 abandoned）。
-- ============================================================
create or replace function quiz_attempt_start(p_bank_id uuid, p_fresh boolean default false)
returns jsonb
language plpgsql security definer as $$
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
  -- 版本归属守卫：冻结版本必须属于该题集，防跨题集版本引用
  if not exists (select 1 from question_bank_versions v
                 where v.id = v_bank.current_version_id and v.bank_id = p_bank_id) then
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
    -- 明确结束旧批次：保留已答记录与解析释放状态，不改判已有作答；
    -- 仅当批次仍为进行中时废弃（并发完成时不降级已完成批次）
    update quiz_attempts set status = 'abandoned', updated_at = now()
    where id = v_attempt.id and status = 'in_progress';
  end if;

  insert into quiz_attempts (user_id, bank_id, version_id)
  values (v_user, p_bank_id, v_bank.current_version_id)
  returning * into v_attempt;
  return quiz_attempt_state(v_attempt.id);
end;
$$;

revoke all on function quiz_attempt_start(uuid, boolean) from public, anon;
grant execute on function quiz_attempt_start(uuid, boolean) to authenticated;



-- ============================================================
-- 6) quiz_attempt_answer：同批次串行化 + 首次终局幂等重写。
--    顺序：归属校验（FOR UPDATE 行锁，先于状态与重复检查）→ 版本加载 →
--    已作答题返回首答结果与准确 completed 状态（无论批次 completed/abandoned）→
--    新作答仅允许进行中批次 → 判分入表 → 完成迁移。
--    行锁串行化同批次作答，并与 quiz_attempt_start 的废弃 UPDATE 交错安全。
-- ============================================================
create or replace function quiz_attempt_answer(p_attempt_id uuid, p_item_id uuid, p_answer text)
returns jsonb
language plpgsql security definer as $$
declare
  v_user uuid := auth.uid();
  v_attempt quiz_attempts%rowtype;
  v_version question_bank_versions%rowtype;
  v_item jsonb;
  v_answer text;
  v_explanation text;
  v_correct boolean;
  v_existing attempt_answers%rowtype;
  v_answered_count integer;
  v_completed boolean := false;
begin
  if v_user is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_attempt_id is null or p_item_id is null or p_answer is null or btrim(p_answer) = '' then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;

  -- 归属校验 + 行锁串行化（先于状态检查与重复检查）
  select * into v_attempt from quiz_attempts where id = p_attempt_id for update;
  if not found or v_attempt.user_id <> v_user then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_version from question_bank_versions where id = v_attempt.version_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- 幂等：已作答题返回首次结果（不覆盖不刷分），completed 如实反映批次当前状态；
  -- 即使批次已完成/已放弃，重试同题也返回原结果而非 ATTEMPT_CLOSED
  select * into v_existing from attempt_answers where attempt_id = p_attempt_id and item_id = p_item_id;
  if found then
    select x.item->>'answer', x.item->>'explanation' into v_answer, v_explanation
    from jsonb_array_elements(v_version.items) as x(item)
    where x.item->>'itemId' = p_item_id::text;
    return jsonb_build_object(
      'correct', v_existing.is_correct,
      'answer', v_answer,
      'explanation', v_explanation,
      'alreadyAnswered', true,
      'submittedAnswer', v_existing.submitted_answer,
      'completed', (v_attempt.status = 'completed')
    );
  end if;

  -- 新作答仅允许进行中批次（已完成/已放弃一律拒绝新写入）
  if v_attempt.status <> 'in_progress' then raise exception 'ATTEMPT_CLOSED' using errcode = 'P0001'; end if;

  select x.item into v_item from jsonb_array_elements(v_version.items) as x(item)
  where x.item->>'itemId' = p_item_id::text;
  if v_item is null then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
  v_answer := v_item->>'answer';
  v_explanation := v_item->>'explanation';

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



-- ============================================================
-- 7) 最小权限收口：版本快照/批次/作答的写授权显式 REVOKE
--    （平台默认授权叠加了 arwd；写入只能经 SECURITY DEFINER 受控 RPC，
--     应用层无任何直写路径，此处为防御纵深，不影响既有功能）
-- ============================================================
revoke insert, update, delete on question_bank_versions, quiz_attempts, attempt_answers from authenticated;



commit;
