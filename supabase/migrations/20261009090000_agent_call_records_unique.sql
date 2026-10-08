begin;

-- agent_call_records 调用记录唯一约束补齐：
-- 202608230001 建表迁移已定义 unique (session_id, client_event_id)，但线上租户库实际缺失
-- （saveAgentCall 的 upsert onConflict "session_id,client_event_id" 因此失败，
--  返回 "no unique or exclusion constraint matching the ON CONFLICT specification"，
--  学生每轮对话的 AI 应答链路在持久化调用记录时 409）。
-- 本迁移幂等补齐约束（已存在则跳过）。

alter table agent_call_records
  add constraint agent_call_records_session_event_unique
  unique (session_id, client_event_id);

commit;
