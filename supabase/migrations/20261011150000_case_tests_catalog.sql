begin;

-- 辅助检查目录/结果分离（死锁修复，新增迁移不改历史）：
-- 死锁链（迁移 20261010120000 引入的投影门控副作用）：facts 投影中 sections.tests 门控
--（orderedTests>0）与开单依赖目录互锁——学生可见目录来自投影 tests，未开单前目录被剥离
-- → 无法开出首张检查单 → orderedTests 永远为 0 → tests 全文永远不投影。
-- 分离原则：
--   1) 目录（无答案，仅 id/label）对本人会话始终可见（case_snapshot_list_tests）；
--   2) 单行结果在下单时按 testId 行级读取（case_snapshot_get_test）：
--      一次下单仅返回该项目结果，不以一次下单暴露全部 tests 全文；
--   3) 门控与 case_snapshot_get_facts 前置一致：登录 + 会话归属本人（受保护 user_id 列）
--      + 版本绑定一致（state->>'sourceSnapshotVersion'）+ 病例匹配（state->>'caseId'）。
--      get_test 不加 orderedTests 门控（下单回合内 DB 尚未保存本单，无法以 orderedTests 判定）；
--      暴露面=本人会话本人病例本人版本的单行结果，教学评分以 events 证据为准（直调 RPC
--      不产生 event，不影响评分公正），无跨会话/跨病例越权面。
-- 行解析规则与 createSourceCase（src/domain/case.ts）保持一致：
--   split('\n')、过滤 trim 后空行与「辅助检查/辅检/入院后辅检：」标题行；
--   label=冒号前段（≤60 字符），无冒号行整行为结果文本 →「检查记录 N」（目录不透出数值）。
-- 注：平台 SQL 守卫禁止在 SECURITY DEFINER 函数内 SET search_path；表名不带前缀。

-- ---- 1) 无答案目录：仅 id/label，本人会话始终可见 ----
create or replace function case_snapshot_list_tests(p_case_id text, p_version text, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_lines text[];
  v_line text;
  v_label text;
  v_items jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  if auth.uid() is null then
    return null;
  end if;
  select user_id, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then
    return null;
  end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then
    return null;
  end if;
  if v_row.state->>'caseId' is distinct from p_case_id then
    return null;
  end if;
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  if v_facts is null then
    return null;
  end if;
  v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
  foreach v_line in array v_lines loop
    v_line := btrim(v_line);
    if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then
      continue;
    end if;
    v_label := split_part(v_line, '：', 1);
    if v_label = v_line then
      v_label := split_part(v_line, ':', 1);
    end if;
    if v_label = v_line then
      v_label := '检查记录 ' || (v_index + 1);
    else
      v_label := left(btrim(v_label), 60);
      if v_label = '' then
        v_label := '检查记录 ' || (v_index + 1);
      end if;
    end if;
    v_items := v_items || jsonb_build_object('id', 'source-test-' || v_index, 'label', v_label);
    v_index := v_index + 1;
  end loop;
  return v_items;
end;
$$;

revoke all on function case_snapshot_list_tests(text, text, uuid) from public, anon;
grant execute on function case_snapshot_list_tests(text, text, uuid) to authenticated;

-- ---- 2) 行级结果：按 testId 返回单行（id/label/result），一次下单仅本项目 ----
create or replace function case_snapshot_get_test(p_case_id text, p_version text, p_session_id uuid, p_test_id text)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_row record;
  v_facts jsonb;
  v_lines text[];
  v_line text;
  v_label text;
  v_id text;
  v_index integer := 0;
begin
  if auth.uid() is null then
    return null;
  end if;
  select user_id, state into v_row from training_sessions where id = p_session_id;
  if v_row is null or v_row.user_id is distinct from auth.uid() then
    return null;
  end if;
  if v_row.state->>'sourceSnapshotVersion' is distinct from p_version then
    return null;
  end if;
  if v_row.state->>'caseId' is distinct from p_case_id then
    return null;
  end if;
  select facts into v_facts from case_snapshot_facts
    where case_id = p_case_id and version = p_version;
  if v_facts is null then
    return null;
  end if;
  v_lines := string_to_array(coalesce(v_facts->'sections'->>'tests', ''), chr(10));
  foreach v_line in array v_lines loop
    v_line := btrim(v_line);
    if v_line = '' or v_line ~ '^(辅助检查|辅检|入院后辅检)[：:]$' then
      continue;
    end if;
    v_id := 'source-test-' || v_index;
    if v_id = p_test_id then
      v_label := split_part(v_line, '：', 1);
      if v_label = v_line then
        v_label := split_part(v_line, ':', 1);
      end if;
      if v_label = v_line then
        v_label := '检查记录 ' || (v_index + 1);
      else
        v_label := left(btrim(v_label), 60);
        if v_label = '' then
          v_label := '检查记录 ' || (v_index + 1);
        end if;
      end if;
      return jsonb_build_object('id', v_id, 'label', v_label, 'result', v_line);
    end if;
    v_index := v_index + 1;
  end loop;
  return null;
end;
$$;

revoke all on function case_snapshot_get_test(text, text, uuid, text) from public, anon;
grant execute on function case_snapshot_get_test(text, text, uuid, text) to authenticated;

commit;
