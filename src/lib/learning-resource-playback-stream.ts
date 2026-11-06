import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_CONTEXT = 'clinical-learning-resource-playback-stream-v1';

type PlaybackStreamPayload = {
  v: 1;
  resourceId: string;
  fileId: string;
  exp: number;
};

function getSigningKey(): Buffer {
  const secret = process.env.CODER_CODING_API_KEY;
  if (!secret) throw new Error('FILE_UNAVAILABLE');
  return createHmac('sha256', secret).update(TOKEN_CONTEXT).digest();
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', getSigningKey()).update(encodedPayload).digest('base64url');
}

export function createPlaybackStreamUrl(resourceId: string, fileId: string): { url: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload: PlaybackStreamPayload = { v: 1, resourceId, fileId, exp };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${encodedPayload}.${sign(encodedPayload)}`;
  return {
    url: `/api/resources/${encodeURIComponent(resourceId)}/playback/stream?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyPlaybackStreamToken(token: string | null, resourceId: string): { fileId: string; expiresAt: string } {
  try {
    if (!token || token.length > 4096) throw new Error('invalid');
    const [encodedPayload, suppliedSignature, extra] = token.split('.');
    if (!encodedPayload || !suppliedSignature || extra || encodedPayload.length > 2048) throw new Error('invalid');
    const expectedSignature = sign(encodedPayload);
    const supplied = Buffer.from(suppliedSignature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('invalid');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<PlaybackStreamPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.v !== 1
      || payload.resourceId !== resourceId
      || typeof payload.fileId !== 'string'
      || !payload.fileId
      || typeof payload.exp !== 'number'
      || !Number.isInteger(payload.exp)
      || payload.exp <= now
      || payload.exp > now + TOKEN_TTL_SECONDS + 60
    ) {
      throw new Error('invalid');
    }
    return { fileId: payload.fileId, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch {
    throw new Error('PLAYBACK_URL_INVALID');
  }
}
