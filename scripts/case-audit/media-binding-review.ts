import { createHash } from 'node:crypto';

/** Review is a private receipt about these exact bytes, source, candidate and trigger. */
export interface MediaBindingReview {
  caseId: string; candidateSha256: string; sourceDocumentSha256: string;
  imageSha256: string; captionSha256: string; testId: string; reviewedAt: string; reviewer: string;
  privacyStatus: 'approved'; usageAuthorized: true; purposeStatus: 'approved';
}

export function requireMediaBindingReview(review: MediaBindingReview | undefined,
  expected: { caseId: string; candidateSha256: string; sourceDocumentSha256: string; testId: string; captionSha256: string }, bytes: Buffer) {
  if (!review || review.privacyStatus !== 'approved' || review.usageAuthorized !== true || review.purposeStatus !== 'approved'
    || !review.reviewer?.trim() || !review.reviewedAt || !Number.isFinite(Date.parse(review.reviewedAt))
    || Object.entries(expected).some(([key, value]) => review[key as keyof MediaBindingReview] !== value)
    || review.imageSha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new Error('MEDIA_REVIEW_MISSING_OR_STALE');
  }
}
