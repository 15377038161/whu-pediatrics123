import type { CaseMedia, SessionState } from '@/domain/agent';
import { TEACHING_ILLUSTRATIONS } from '@/domain/teaching-illustrations';

/** Keep storage URLs and any extra private properties out of event metadata. */
export function decodeCaseMedia(value: unknown): CaseMedia[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CaseMedia => Boolean(item && typeof item === 'object'
    && item.kind === 'image' && typeof item.fileId === 'string' && item.fileId && typeof item.caption === 'string'))
    .map(({fileId,kind,caption})=>({fileId,kind,caption}));
}

/** Reconstruct only already-performed exam media from the exact bound snapshot.
 * No new clinical event/evidence, no overwrite of media frozen in historical events. */
export function hydrateReleasedExamMedia(session: SessionState, exams: ReadonlyArray<{evidenceCode: string; media?: CaseMedia[]}>) {
  if (!session.sourceSnapshotVersion) return session;
  const byEvidence = new Map(exams.map(exam=>[exam.evidenceCode,exam.media]));
  for (const event of session.events) {
    if (event.type !== 'EXAM_ACTION' || event.stage !== 'exam' || event.correct !== true || event.media?.length) continue;
    const media=event.evidenceCodes.filter(code=>session.unlockedEvidence.includes(code))
      .flatMap(code=>decodeCaseMedia(byEvidence.get(code)));
    if (media.length) event.media=[...new Map(media.map(item=>[item.fileId,item])).values()];
  }
  return session;
}

/**
 * 病例媒体释放与解析（补充单：媒体按检查/操作触发绑定）。
 *
 * 安全边界：
 * - fileId 只允许来自本会话事件中已随结果释放的媒体登记（fail-closed）——
 *   不接受客户端传入未释放的 fileId，防止遍历探测病例配置中未开单/未到阶段的媒体；
 * - URL 仅经服务端 StorageClient.getFile 换带期限签名链接（默认 1 小时），
 *   不持久化、不暴露存储凭据、不做开放 URL 代理（与 learning-resource 播放链接同一契约）。
 */

/** 本会话已释放媒体定位：事件随结果释放时挂载 media；未释放的 fileId 一律 null（不泄露存在性）。 */
export function findReleasedMedia(session: SessionState, fileId: string): CaseMedia | null {
  for (const event of session.events) {
    const hit = event.media?.find((item) => item.fileId === fileId);
    if (hit) return hit;
  }
  return null;
}

/** 媒体签名链接解析：以已释放登记的 fileId 换带期限链接（过期前端重新请求）。 */
export async function getCaseMediaLink(fileId: string): Promise<{ url: string; expiresAt: string; fileName: string | null }> {
  const illustration = Object.hasOwn(TEACHING_ILLUSTRATIONS, fileId) ? TEACHING_ILLUSTRATIONS[fileId] : undefined;
  if (illustration) return {url: illustration.url, expiresAt: '', fileName: null};
  if (fileId.startsWith('teaching-illustration:')) throw new Error('FILE_UNAVAILABLE');
  const { StorageClient } = await import('coder-coding-dev-sdk');
  const storage = new StorageClient();
  try {
    const info = await storage.getFile({ fileId, expiresInSeconds: 3600 });
    return { url: info.url, expiresAt: info.expiresAt ?? '', fileName: info.fileName ?? null };
  } catch {
    throw new Error('FILE_UNAVAILABLE');
  }
}
