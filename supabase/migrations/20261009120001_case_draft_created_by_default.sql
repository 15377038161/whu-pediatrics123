begin;

-- 草稿表修正：created_by 由数据库按当前 JWT 身份默认填充。
-- 应用层不传 created_by（不自封身份）；教师 RLS 策略不变，未扩大权限。
-- 根因：直插实测 23502（null violates not-null）——教师保存草稿被误拒。

alter table case_draft_imports alter column created_by set default auth.uid();

commit;
