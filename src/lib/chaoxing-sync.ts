export type SyncHealth = 'connected' | 'waiting_for_authorization' | 'database_unavailable';

export function chaoxingFormConfigured(): boolean {
  return Boolean(
    process.env.CHAOXING_FORM_WRITE_URL?.trim()
      && process.env.CHAOXING_FORM_WRITE_TOKEN?.trim()
      && process.env.CHAOXING_FORM_ID?.trim(),
  );
}

export class ChaoxingSyncUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChaoxingSyncUnavailableError';
  }
}

/**
 * 平台安全约束（fail-closed）：
 * sync_outbox 的排空（跨状态 UPDATE：pending/retry -> delivered/failed）需要特权数据库身份，
 * 平台禁止生成应用持有 SERVICE_ROLE_KEY 级凭据，且 RLS 不允许任何用户身份改写他人事件。
 * 因此本函数不构造 admin 客户端：缺少可用特权凭据时抛出明确错误，
 * 由调用方（/api/internal/sync-chaoxing，受 SYNC_WORKER_SECRET 守卫）映射为 503。
 *
 * outbox 事件本身仍由学生本人（RLS owner 限定）在 saveReport 时正常写入，
 * 不影响训练主链路与数据持久化；跨用户投递属于后台任务职责，待平台提供
 * 托管任务流/专用服务身份后接入。
 */
export async function drainChaoxingOutbox(_limit = 20): Promise<{ processed: number; delivered: number; waiting: number; failed: number }> {
  void _limit;
  throw new ChaoxingSyncUnavailableError(
    'outbox 排空依赖特权数据库身份（平台禁用 SERVICE_ROLE_KEY），当前环境已按安全规范 fail-closed',
  );
}
