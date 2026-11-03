import { StorageClient } from 'coder-coding-dev-sdk';
import type { SessionState } from '@/domain/agent';

const prefix = (sessionId: string) => `student-voice-${sessionId}-`;

export async function storeStudentVoice(sessionId: string, audio: File) {
  const result = await new StorageClient().uploadFile({
    fileContent: Buffer.from(await audio.arrayBuffer()),
    fileName: `${prefix(sessionId)}${crypto.randomUUID()}.wav`,
    contentType: 'audio/wav',
  });
  if (!result.fileId) throw new Error('VOICE_STORAGE_FAILED');
  return result.fileId;
}

/** Bind playback to a persisted message and its own session, never to a client-supplied fileId. */
export async function getStudentVoiceLink(session: SessionState, messageId: string) {
  const message = session.messages.find((item) => item.id === messageId && item.actor === 'student');
  const fileId = message?.audioFileId;
  if (!fileId) throw new Error('VOICE_NOT_FOUND');
  const info = await new StorageClient().getFile({ fileId, expiresInSeconds: 3600 });
  if (!info.fileName?.startsWith(prefix(session.id)) || !info.fileName.endsWith('.wav')) {
    throw new Error('VOICE_NOT_FOUND');
  }
  return info.url;
}

/** Only attachments uploaded for this exact session can enter the agent event. */
export async function assertStudentVoiceAttachment(sessionId: string, fileId: string) {
  const info = await new StorageClient().getFile({ fileId, expiresInSeconds: 60 });
  if (!info.fileName?.startsWith(prefix(sessionId)) || !info.fileName.endsWith('.wav')) {
    throw new Error('VOICE_ATTACHMENT_INVALID');
  }
}
