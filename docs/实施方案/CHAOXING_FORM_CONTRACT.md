# 超星表单同步契约

## 1. 已实现边界

系统在报告完成时写入 `SyncEventV1` 和 `sync_outbox`，后台任务使用 `eventId` 作为幂等键。支持 4xx/5xx、超时、指数退避、最大尝试次数和失败原因保留。浏览器不能直接调用同步接口。

## 2. SyncEventV1 字段

- `eventId`、`recordType`、`submittedAt`。
- 学生：内部 ID、学号、姓名。
- 病例：病例 ID、版本、会话 ID、模式、阶段。
- 业务：学生提交、智能体反馈、总分、证据摘要、完整报告。

## 3. 待超星提供

- 服务端写入 URL 与 HTTP 方法。
- Token 或签名算法、Token 获取/刷新方式。
- 表单 ID、字段别名、字段类型和必填约束。
- 成功响应、重复提交响应、4xx/5xx 响应样例。
- 单次/每分钟限额和超时要求。

取得资料后只需调整 `src/lib/chaoxing-sync.ts` 的字段映射与鉴权头，不修改业务状态机。

## 4. 联调步骤

1. 配置 `CHAOXING_FORM_WRITE_URL`、`CHAOXING_FORM_WRITE_TOKEN`、`CHAOXING_FORM_ID`、`SYNC_WORKER_SECRET`。
2. 完成一条本地/开发环境报告，确认 outbox 为 `pending`。
3. 服务端调用 `/api/internal/sync-chaoxing`。
4. 在超星表单页面核对姓名、学号、病例、得分和报告内容。
5. 重放相同事件，确认没有重复记录；再放开积压队列。
