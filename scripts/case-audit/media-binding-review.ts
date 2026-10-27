import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

/** Standalone originals must never be given an invented containing document. */
export type MediaSource =
  | { kind: 'document-embedded'; documentSha256: string; archiveEntry: string }
  | { kind: 'standalone-image'; originalSha256: string; locatorSha256: string };

export interface MediaBindingReview {
  caseId: string; candidateSha256: string; source: MediaSource;
  imageSha256: string; captionSha256: string; testId: string; reviewedAt: string; reviewer: string;
  usageAuthorized: true; purposeStatus: 'approved';
  authorization: { basis: 'user-confirmed-teacher-authorization'; confirmedAt: string; reference: string };
  // Usage authorization does not imply a completed visual or medical review.
  privacyStatus?: 'unreviewed' | 'approved' | 'redacted';
}

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function sameMediaSource(actual: MediaSource | undefined, expected: MediaSource): boolean {
  if (!actual || actual.kind !== expected.kind) return false;
  if (actual.kind === 'standalone-image' && expected.kind === 'standalone-image') {
    return hash(actual.originalSha256) && hash(actual.locatorSha256)
      && actual.originalSha256 === expected.originalSha256 && actual.locatorSha256 === expected.locatorSha256;
  }
  return actual.kind === 'document-embedded' && expected.kind === 'document-embedded'
    && hash(actual.documentSha256) && !!actual.archiveEntry?.trim()
    && actual.documentSha256 === expected.documentSha256 && actual.archiveEntry === expected.archiveEntry;
}

export function requireMediaBindingReview(review: MediaBindingReview | undefined,
  expected: { caseId: string; candidateSha256: string; source: MediaSource; testId: string; captionSha256: string }, bytes: Buffer) {
  const auth = review?.authorization;
  if (!review || review.usageAuthorized !== true || review.purposeStatus !== 'approved'
    || auth?.basis !== 'user-confirmed-teacher-authorization' || !date(auth.confirmedAt) || !auth.reference?.trim()
    || !review.reviewer?.trim() || !date(review.reviewedAt)
    || !hash(expected.candidateSha256) || !hash(expected.captionSha256)
    || review.caseId !== expected.caseId || review.candidateSha256 !== expected.candidateSha256
    || review.testId !== expected.testId || review.captionSha256 !== expected.captionSha256
    || !sameMediaSource(review.source, expected.source)
    || review.imageSha256 !== createHash('sha256').update(bytes).digest('hex')
    || (review.source.kind === 'standalone-image' && review.source.originalSha256 !== review.imageSha256)) {
    throw new Error('MEDIA_REVIEW_MISSING_OR_STALE');
  }
}

/** Verify original bytes before any storage request; locators stay private. */
export function verifyMediaOriginal(source: MediaSource, original: Buffer, absoluteLocator: string, image: Buffer) {
  const digest = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  if (source?.kind === 'standalone-image') {
    if (source.originalSha256 !== digest(original) || !original.equals(image)
      || source.locatorSha256 !== digest(absoluteLocator.replaceAll('\\', '/'))) throw new Error('MEDIA_SOURCE_MISMATCH');
    return;
  }
  if (source?.kind !== 'document-embedded' || source.documentSha256 !== digest(original)
    || !/^word\/media\/[^/]+$/.test(source.archiveEntry)) throw new Error('MEDIA_SOURCE_MISMATCH');
  try {
    const entries = unzipSync(original, {filter: file => {
      if (file.name !== source.archiveEntry) return false;
      if (file.originalSize > 40 * 1024 * 1024) throw new Error('limit');
      return true;
    }});
    const embedded = entries[source.archiveEntry];
    if (!embedded || !Buffer.from(embedded).equals(image)) throw new Error('wrong bytes');
  } catch {
    throw new Error('MEDIA_SOURCE_MISMATCH');
  }
}
