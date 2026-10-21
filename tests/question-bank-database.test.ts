import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Json = Record<string, unknown>;

// 独立 WASM PostgreSQL，只使用合成账号，验证真实 SQL/RLS/触发器/RPC 语义。不是平台登录验收。
// 覆盖 F-题库补验-02（基线 32b2565 + 迁移 20261022000200_question_bank_write_guard）：
//   1) RLS 收口负例：学生不可直建/直改题集与条目（owner 策略教师门控）；版本/批次/作答直写授权 REVOKE；
//   2) 触发器守卫：发布字段（visibility/current_version_id/owner_id）与非法状态迁移被拒，教师 INSERT 强制缺省发布态；
//   3) 最后题重试幂等：批次完成后重试同题返回首答结果（completed 如实），而非 ATTEMPT_CLOSED；
//   4) fresh 交错：completed 批次不降级 abandoned；in_progress 废弃保留已答记录与解析释放；
//   5) 版本冻结：旧批次绑定版本判分不变，再发布不影响；教师不可直写版本快照；
//   6) 草稿答案不泄漏：未作答题投影无 answer/explanation；学生不可直读条目与快照；
//   7) quiz_attempt_start 版本归属守卫：跨题集版本引用被拒；
//   8) legacy 题池收紧：教师只读，仅项目管理员可写。
// 注：平台租户的 ACL 叠加（五表 arwd → 三表 REVOKE）已在 G2 直查验证；本测试验证迁移声明的授权语义。
for (const integerActive of [false, true]) test(`题库数据库（is_active=${integerActive ? 'integer' : 'boolean'}）：RLS 收口、触发器守卫、幂等重试、版本冻结`, { timeout: 180_000 }, async () => {
  const db = new PGlite();
  const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005'];
  const [admin, teacherA, teacherB, studentA, studentB] = ids;
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    const initial = (await readFile('supabase/migrations/202608230001_pediatrics_agent.sql','utf8')).replace('create extension if not exists pgcrypto;','');
    await db.exec(initial);
    if (integerActive) await db.exec(`alter table cohorts alter column is_active drop default; alter table cohorts alter column is_active type integer using case when is_active then 1 else 0 end; alter table cohorts alter column is_active set default 1;`);
    await db.exec(`alter table profiles alter column app_role drop default; alter table profiles alter column app_role type text using app_role::text; alter table profiles alter column app_role set default 'student';
      alter table profiles add column account_kind text not null default 'real';
      create table teacher_emails(email text primary key,note text);
      create function app_is_teacher() returns boolean language sql stable security definer as $$ select exists(select 1 from teacher_emails where email=auth.jwt()->>'email') $$;
      create table quiz_questions(id uuid primary key,case_id text,difficulty text);
      alter table quiz_questions enable row level security;
      create table quiz_assignments(user_id uuid references profiles,question_id uuid references quiz_questions,is_correct boolean,assigned_at timestamptz default now(),answered_at timestamptz);
      alter table quiz_assignments enable row level security;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      create policy legacy_global_teacher_profiles on profiles for select to authenticated using(app_is_teacher());
      create policy legacy_global_teacher_sessions on training_sessions for select to authenticated using(app_is_teacher());
      create policy legacy_global_teacher_reports on training_reports for select to authenticated using(app_is_teacher());`);
    await db.exec(await readFile('supabase/migrations/20261011100000_session_engagement_events.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261015161000_profile_identity_server_role.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261019023824_classroom_management.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261022000000_question_banks.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261022000100_quiz_attempt_list_mine.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261022000200_question_bank_write_guard.sql','utf8'));
    for (const [index,id] of ids.entries()) {
      await db.query('insert into auth.users values($1)',[id]);
      await db.query('insert into profiles(id,display_name,app_role) values($1,$2,$3)',[id,`合成账号${index}`,index<3?'teacher':'student']);
    }
    await db.query('insert into teacher_emails(email) values($1)',['admin@example.test']);
    await db.query('insert into project_administrators(user_id) values($1)',[admin]);
    async function asUser(id: string, cxid: string, trusted = false) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({email:id===admin?'admin@example.test':`${cxid}@example.test`,user_metadata:{cxid,realname:`合成${cxid}`},app_metadata:trusted?{chaoxing:{uid:cxid,fid:'test',studentNo:`00${cxid}`}}:{}})]);
      await db.exec('set role authenticated');
      await db.query('select class_sync_identity()');
    }
    async function scalar<T>(sql: string,args: unknown[]=[]): Promise<T> { const r=await db.query<Record<string,T>>(sql,args); return Object.values(r.rows[0])[0]; }

    // ---------- 基线：教师授权与学生入班 ----------
    // teacher_access_grant 要求受权者已登录同步过身份（class_account_identities.cxid 匹配），先登录再授权
    await asUser(teacherA,'200');
    await asUser(teacherB,'300');
    await asUser(admin,'100');
    assert.equal(await scalar('select teacher_access_grant($1,$2,true)',[teacherA,'200']),true);
    assert.equal(await scalar('select teacher_access_grant($1,$2,true)',[teacherB,'300']),true);
    await asUser(teacherA,'200');
    const classA = await scalar<string>("select class_create('合成题库班 A')");
    // 夹具直插成员关系（超级用户模拟既有班级成员；可见性谓词只依赖 cohort_members 行，不经过登录同步链）
    await db.exec('reset role');
    await db.query("insert into cohort_members(cohort_id,user_id,role) values($1,$2,'student')",[classA,studentA]);

    // ---------- 1) 教师建题集：INSERT 强制缺省发布态 ----------
    await asUser(teacherA,'200');
    const bankA = await scalar<string>('insert into question_banks(owner_id,title) values(auth.uid(),$1) returning id',['合成题集 A']);
    const forced = (await db.query("insert into question_banks(owner_id,title,status,visibility,current_version_id) values(auth.uid(),'带发布态建行','published','platform',$1) returning status,visibility,current_version_id",['00000000-0000-4000-8000-0000000000ff'])).rows[0] as Record<string, unknown>;
    assert.equal(forced.status,'draft','教师 INSERT 强制 draft');
    assert.equal(forced.visibility,'own_class','教师 INSERT 强制 own_class');
    assert.equal(forced.current_version_id,null,'教师 INSERT 强制无版本');
    const bankDraft = await scalar<string>('insert into question_banks(owner_id,title) values(auth.uid(),$1) returning id',['合成草稿题集']);
    const item1 = await scalar<string>('insert into bank_items(bank_id,stem,options,answer,explanation,knowledge_point,difficulty) values($1,$2,$3::jsonb,$4,$5,$6,$7) returning id',[bankA,'合成题干 1',JSON.stringify(['选项甲','选项乙','选项丙']),'选项甲','合成解析 1','知识点 1','easy']);
    const item2 = await scalar<string>('insert into bank_items(bank_id,stem,options,answer,explanation,knowledge_point,difficulty) values($1,$2,$3::jsonb,$4,$5,$6,$7) returning id',[bankA,'合成题干 2',JSON.stringify(['选项甲','选项乙']),'选项乙','合成解析 2','知识点 2','medium']);

    // ---------- 2) 学生直表负例（RLS 收口 + REVOKE） ----------
    await asUser(studentA,'400');
    await assert.rejects(() => db.query('insert into question_banks(owner_id,title) values(auth.uid(),$1)',['学生自建题集']),/row-level security/,'学生不可自建题集');
    await assert.rejects(() => db.query('insert into bank_items(bank_id,stem,options,answer,explanation) values($1,$2,$3::jsonb,$4,$5)',[bankA,'学生条目',JSON.stringify(['a','b']),'a','x']),/row-level security/,'学生不可直写条目');
    assert.equal(await scalar('select count(*)::int from bank_items'),0,'学生不可直读条目');
    assert.equal(await scalar('select count(*)::int from question_bank_versions'),0,'学生不可直读版本快照');
    assert.equal(await scalar('select count(*)::int from question_banks where id=$1',[bankA]),0,'学生不可见他人题集');
    await assert.rejects(() => db.query('insert into quiz_attempts(user_id,bank_id,version_id) values($1,$2,gen_random_uuid())',[studentA,bankA]),/permission denied/,'批次直写已 REVOKE');
    await assert.rejects(() => db.query('insert into question_bank_versions(bank_id,version,items,item_count) values($1,1,$2::jsonb,1)',[bankA,JSON.stringify([{itemId:'x'}])]),/permission denied/,'版本快照直写已 REVOKE');
    await assert.rejects(() => db.query("insert into attempt_answers(attempt_id,item_id,submitted_answer,is_correct) values(gen_random_uuid(),gen_random_uuid(),'a',true)"),/permission denied/,'作答直写已 REVOKE');
    await assert.rejects(() => db.query('update quiz_attempts set status=$1 where user_id=auth.uid()',['completed']),/permission denied/);
    await assert.rejects(() => db.query('delete from attempt_answers'),/permission denied/);
    assert.equal(await scalar("select has_table_privilege('authenticated','question_bank_versions','INSERT')"),false);
    assert.equal(await scalar("select has_table_privilege('authenticated','quiz_attempts','UPDATE')"),false);
    assert.equal(await scalar("select has_table_privilege('authenticated','attempt_answers','DELETE')"),false);
    assert.equal(await scalar("select has_table_privilege('authenticated','quiz_attempts','SELECT')"),true);
    assert.equal(await scalar("select has_table_privilege('authenticated','question_banks','INSERT')"),true,'教师直写路径保留');
    // 收口前可能存在的学生属主行：只读面保留，更新/删除被教师门控策略静默拒绝
    await db.exec('reset role');
    await db.query('insert into question_banks(owner_id,title) values($1,$2)',[studentA,'学生历史脏行']);
    await asUser(studentA,'400');
    assert.equal(await scalar('select count(*)::int from question_banks where title=$1',['学生历史脏行']),1,'owner 只读面保留');
    assert.equal((await db.query('update question_banks set title=$1 where title=$2 returning id',['篡改标题','学生历史脏行'])).rows.length,0,'学生不可更新自有行');
    assert.equal((await db.query('delete from question_banks where owner_id=auth.uid() returning id')).rows.length,0,'学生不可删除自有行');

    // ---------- 3) 发布负例 ----------
    await asUser(teacherA,'200');
    await assert.rejects(() => db.query('select quiz_bank_publish($1)',[bankDraft]),/NO_APPROVED_ITEMS/);
    await assert.rejects(() => db.query('select quiz_bank_publish($1,$2)',[bankA,'platform']),/FORBIDDEN/,'教师不可直发 platform');
    await asUser(teacherB,'300');
    await assert.rejects(() => db.query('select quiz_bank_publish($1)',[bankA]),/FORBIDDEN/,'非 owner 教师不可发布');
    await asUser(teacherA,'200');
    const dupItem = await scalar<string>("insert into bank_items(bank_id,stem,options,answer,explanation) values($1,'重复选项题',$2::jsonb,'A','x') returning id",[bankA,JSON.stringify(['A','A'])]);
    await db.query('update bank_items set review_status=$1 where id=$2',['approved',dupItem]);
    await assert.rejects(() => db.query('select quiz_bank_publish($1)',[bankA]),/DUPLICATE_OPTIONS/,'重复选项不得进入冻结版本');
    await db.query('delete from bank_items where id=$1',[dupItem]);
    await db.query('update bank_items set review_status=$1 where bank_id=$2',['approved',bankA]);
    const pub1 = await scalar<Json>('select quiz_bank_publish($1)',[bankA]);
    assert.equal(pub1.version,1);
    assert.equal(pub1.itemCount,2);

    // ---------- 4) 发布后触发器守卫（教师 owner 直改） ----------
    assert.equal((await db.query("update question_banks set status='ready_for_review' where id=$1 returning id",[bankDraft])).rows.length,1,'draft→ready_for_review 白名单');
    assert.equal((await db.query("update question_banks set status='draft' where id=$1 returning id",[bankDraft])).rows.length,1,'ready_for_review→draft 白名单');
    await assert.rejects(() => db.query("update question_banks set status='published' where id=$1",[bankDraft]),/STATUS_TRANSITION_FORBIDDEN/,'published 只能经发布 RPC');
    await assert.rejects(() => db.query("update question_banks set status='retired' where id=$1",[bankDraft]),/STATUS_TRANSITION_FORBIDDEN/);
    await assert.rejects(() => db.query('update question_banks set visibility=$1 where id=$2',['platform',bankA]),/PUBLISH_FIELDS_PROTECTED/,'visibility 不可直改');
    await assert.rejects(() => db.query('update question_banks set current_version_id=$1 where id=$2',['00000000-0000-4000-8000-0000000000ff',bankA]),/PUBLISH_FIELDS_PROTECTED/,'current_version_id 不可直改');
    await assert.rejects(() => db.query('update question_banks set owner_id=$1 where id=$2',[teacherB,bankA]),/PUBLISH_FIELDS_PROTECTED/,'owner_id 不可直改');
    await assert.rejects(() => db.query("update question_banks set status='draft' where id=$1",[bankA]),/STATUS_TRANSITION_FORBIDDEN/,'published→draft 不在白名单');
    assert.equal((await db.query('update question_banks set title=$1 where id=$2 returning id',['合成题集 A（改）',bankA])).rows.length,1,'元信息可改');

    // ---------- 5) 学生可见性 ----------
    await asUser(studentA,'400');
    const listA = await scalar<Json[]>('select quiz_bank_list_student()');
    assert.equal(listA.length,1);
    assert.equal(listA[0].bankId,bankA);
    assert.equal(listA[0].itemCount,2);
    assert.equal(listA[0].version,1);
    assert.equal(listA[0].platformWide,false);
    await asUser(studentB,'500');
    assert.equal((await scalar<Json[]>('select quiz_bank_list_student()')).length,0,'班级外学生不可见');
    await assert.rejects(() => db.query('select quiz_attempt_start($1)',[bankA]),/FORBIDDEN/);
    await asUser(teacherA,'200');
    await assert.rejects(() => db.query('select quiz_attempt_start($1)',[bankA]),/FORBIDDEN/,'教师身份不可开批次');

    // ---------- 6) 批次作答：判分、首答终局、最后题重试幂等 ----------
    await asUser(studentA,'400');
    const attempt1 = await scalar<Json>('select quiz_attempt_start($1)',[bankA]);
    const attemptId1 = attempt1.attemptId as string;
    assert.equal(attempt1.status,'in_progress');
    assert.equal(attempt1.itemCount,2);
    const items1 = attempt1.items as Json[];
    assert.equal(items1.length,2);
    for (const it of items1) {
      assert.equal(it.answer,null,'未作答题不泄漏答案');
      assert.equal(it.explanation,null,'未作答题不泄漏解析');
      assert.equal(it.answered,false);
    }
    const wrong1 = await scalar<Json>('select quiz_attempt_answer($1,$2,$3)',[attemptId1,item1,'选项乙']);
    assert.equal(wrong1.correct,false);
    assert.equal(wrong1.alreadyAnswered,false);
    assert.equal(wrong1.completed,false);
    const retry1 = await scalar<Json>('select quiz_attempt_answer($1,$2,$3)',[attemptId1,item1,'选项甲']);
    assert.equal(retry1.alreadyAnswered,true,'同题重试幂等');
    assert.equal(retry1.correct,false,'首答判分终局，不覆盖');
    assert.equal(retry1.submittedAnswer,'选项乙');
    const state1 = await scalar<Json>('select quiz_attempt_state($1)',[attemptId1]);
    const stateItems1 = state1.items as Json[];
    const s1i1 = stateItems1.find((it) => it.itemId===item1)!;
    assert.equal(s1i1.answered,true);
    assert.equal(s1i1.isCorrect,false);
    assert.equal(s1i1.answer,'选项甲','已答释放答案');
    assert.equal(s1i1.explanation,'合成解析 1','已答释放解析');
    const s1i2 = stateItems1.find((it) => it.itemId===item2)!;
    assert.equal(s1i2.answered,false);
    assert.equal(s1i2.answer,null);
    const final1 = await scalar<Json>('select quiz_attempt_answer($1,$2,$3)',[attemptId1,item2,'选项乙']);
    assert.equal(final1.correct,true);
    assert.equal(final1.completed,true);
    // 核心回归：完成后重试最后一题 → 首答结果而非 ATTEMPT_CLOSED（20261022000200 修复）
    const final1Retry = await scalar<Json>('select quiz_attempt_answer($1,$2,$3)',[attemptId1,item2,'选项甲']);
    assert.equal(final1Retry.alreadyAnswered,true,'完成后同题重试返回首答结果');
    assert.equal(final1Retry.correct,true);
    assert.equal(final1Retry.completed,true,'completed 如实反映批次状态');
    await assert.rejects(() => db.query('select quiz_attempt_answer($1,$2,$3)',[attemptId1,'00000000-0000-4000-8000-0000000000aa','x']),/ATTEMPT_CLOSED/,'已完成批次拒绝新作答');
    assert.equal(await scalar('select count(*)::int from attempt_answers where attempt_id=$1',[attemptId1]),2,'作答行不重复');
    await asUser(studentB,'500');
    await assert.rejects(() => db.query('select quiz_attempt_state($1)',[attemptId1]),/NOT_FOUND/,'跨学生批次详情被拒');
    await assert.rejects(() => db.query('select quiz_attempt_answer($1,$2,$3)',[attemptId1,item1,'选项甲']),/NOT_FOUND/,'跨学生作答被拒');

    // ---------- 7) fresh 交错：completed 不降级，in_progress 废弃保留记录 ----------
    await asUser(studentA,'400');
    const attempt2 = await scalar<Json>('select quiz_attempt_start($1,true)',[bankA]);
    const attemptId2 = attempt2.attemptId as string;
    assert.notEqual(attemptId2,attemptId1);
    assert.equal((await scalar<Json>('select quiz_attempt_state($1)',[attemptId1])).status,'completed','fresh 不降级已完成批次');
    const attempt2b = await scalar<Json>('select quiz_attempt_start($1)',[bankA]);
    assert.equal(attempt2b.attemptId,attemptId2,'默认续答回到同批次');
    await db.query('select quiz_attempt_answer($1,$2,$3)',[attemptId2,item1,'选项甲']);
    const attempt3 = await scalar<Json>('select quiz_attempt_start($1,true)',[bankA]);
    const attemptId3 = attempt3.attemptId as string;
    const state2 = await scalar<Json>('select quiz_attempt_state($1)',[attemptId2]);
    assert.equal(state2.status,'abandoned','进行中批次 fresh 后废弃');
    assert.equal(state2.version,1);
    const state2Items = state2.items as Json[];
    const s2i1 = state2Items.find((it) => it.itemId===item1)!;
    assert.equal(s2i1.answered,true,'废弃批次保留已答记录');
    assert.equal(s2i1.answer,'选项甲','废弃批次已答项答案已释放');
    const mine = await scalar<Json[]>('select quiz_attempt_list_mine()');
    assert.equal(mine.length,3);
    assert.equal(mine.filter((r) => r.status==='completed').length,1);
    assert.equal(mine.filter((r) => r.status==='abandoned').length,1);
    assert.equal(mine.filter((r) => r.status==='in_progress').length,1);

    // ---------- 8) 版本冻结：再发布不影响旧批次 ----------
    await asUser(teacherA,'200');
    const item3 = await scalar<string>("insert into bank_items(bank_id,stem,options,answer,explanation) values($1,'合成题干 3',$2::jsonb,'选项甲','合成解析 3') returning id",[bankA,JSON.stringify(['选项甲','选项乙'])]);
    await db.query('update bank_items set review_status=$1 where id=$2',['approved',item3]);
    const pub2 = await scalar<Json>('select quiz_bank_publish($1)',[bankA]);
    assert.equal(pub2.version,2);
    assert.equal(pub2.itemCount,3);
    await assert.rejects(() => db.query('update question_bank_versions set item_count=$1 where bank_id=$2',[99,bankA]),/permission denied/,'教师不可直写版本快照');
    await asUser(studentA,'400');
    const stateOld = await scalar<Json>('select quiz_attempt_state($1)',[attemptId1]);
    assert.equal(stateOld.version,1,'已完成批次仍绑定旧版本');
    assert.equal(stateOld.itemCount,2);
    const attempt4 = await scalar<Json>('select quiz_attempt_start($1,true)',[bankA]);
    const attemptId4 = attempt4.attemptId as string;
    assert.equal(attempt4.version,2,'新批次绑定新版本');
    assert.equal(attempt4.itemCount,3);
    assert.equal((await scalar<Json>('select quiz_attempt_state($1)',[attemptId3])).status,'abandoned');

    // ---------- 9) 管理员路径：platform 发布、直改发布字段、下架 ----------
    await asUser(admin,'100');
    const pubPlat = await scalar<Json>('select quiz_bank_publish($1,$2)',[bankA,'platform']);
    assert.equal(pubPlat.version,3);
    await asUser(studentB,'500');
    const listB = await scalar<Json[]>('select quiz_bank_list_student()');
    const rowB = listB.find((r) => r.bankId===bankA)!;
    assert.equal(rowB.platformWide,true,'platform 全员可见');
    await db.query('select quiz_attempt_start($1)',[bankA]);
    await asUser(admin,'100');
    assert.equal((await db.query("update question_banks set status='retired' where id=$1 returning id",[bankA])).rows.length,1,'管理员可直改状态下架');
    await asUser(studentB,'500');
    await assert.rejects(() => db.query('select quiz_attempt_start($1)',[bankA]),/NOT_FOUND/,'下架后不可开新批次');

    // ---------- 10) 跨题集版本引用守卫（模拟旁路写入的脏数据） ----------
    await asUser(teacherA,'200');
    const bankB = await scalar<string>('insert into question_banks(owner_id,title) values(auth.uid(),$1) returning id',['合成题集 B']);
    const itemB = await scalar<string>("insert into bank_items(bank_id,stem,options,answer,explanation) values($1,'B 题干',$2::jsonb,'选项甲','B 解析') returning id",[bankB,JSON.stringify(['选项甲','选项乙'])]);
    await db.query('update bank_items set review_status=$1 where id=$2',['approved',itemB]);
    await db.query('select quiz_bank_publish($1)',[bankB]);
    await db.exec('reset role');
    await db.exec('alter table question_banks disable trigger question_banks_publish_guard_trigger');
    const foreignVersionId = await scalar<string>('select current_version_id from question_banks where id=$1',[bankA]);
    await db.query('update question_banks set current_version_id=$1 where id=$2',[foreignVersionId,bankB]);
    await db.exec('alter table question_banks enable trigger question_banks_publish_guard_trigger');
    await asUser(studentA,'400');
    await assert.rejects(() => db.query('select quiz_attempt_start($1)',[bankB]),/NOT_FOUND/,'跨题集版本引用被拒');
    // 已开批次不受题集下架影响（判分只看批次与版本）
    const r4 = await scalar<Json>('select quiz_attempt_answer($1,$2,$3)',[attemptId4,item1,'选项甲']);
    assert.equal(r4.correct,true);
    await asUser(teacherA,'200');
    assert.equal((await db.query('update question_banks set title=$1 where id=$2 returning id',['合成题集 B（改）',bankB])).rows.length,1,'触发器恢复后元信息可改');

    // ---------- 11) legacy 题池收紧：教师只读，项目管理员写 ----------
    await asUser(admin,'100');
    const legacyQuestion = await scalar<string>("insert into quiz_questions(id,case_id,difficulty) values(gen_random_uuid(),'case-admin','easy') returning id");
    await asUser(teacherA,'200');
    await assert.rejects(() => db.query("insert into quiz_questions(id,case_id,difficulty) values(gen_random_uuid(),'case-teacher','easy')"),/row-level security/,'教师只读题池');
    await assert.rejects(() => db.query('insert into quiz_assignments(user_id,question_id) values($1,$2)',[studentA,legacyQuestion]),/row-level security/,'教师不可直写分配');
    assert.equal(await scalar('select count(*)::int from quiz_questions where id=$1',[legacyQuestion]),1,'教师可读题池');
  } finally { await db.close(); }
});
