import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { requireMediaBindingReview, type MediaBindingReview } from '../scripts/case-audit/media-binding-review';

test('媒体上传前审核绑定真实字节、来源、版本与操作；缺项或过期收据拒绝', () => {
  const bytes = Buffer.from('synthetic media bytes');
  const expected = {caseId:'synthetic',candidateSha256:'candidate',sourceDocumentSha256:'source',testId:'source-test-0',captionSha256:'caption'};
  const review: MediaBindingReview = {...expected,imageSha256:createHash('sha256').update(bytes).digest('hex'),
    reviewer:'synthetic-reviewer',reviewedAt:'2026-10-27T16:00:00+08:00',privacyStatus:'approved',usageAuthorized:true,purposeStatus:'approved'};
  assert.doesNotThrow(() => requireMediaBindingReview(review,expected,bytes));
  assert.throws(() => requireMediaBindingReview(undefined,expected,bytes),/MEDIA_REVIEW_MISSING_OR_STALE/);
  assert.throws(() => requireMediaBindingReview(review,expected,Buffer.from('changed pixels')),/MEDIA_REVIEW_MISSING_OR_STALE/);
  for (const [key,value] of Object.entries({...expected,reviewer:'',reviewedAt:'invalid',privacyStatus:'unreviewed',usageAuthorized:false,purposeStatus:'unreviewed'})) {
    const changed = {...review,[key]:key in expected ? `${value}-changed` : value} as MediaBindingReview;
    assert.throws(() => requireMediaBindingReview(changed,expected,bytes),/MEDIA_REVIEW_MISSING_OR_STALE/);
  }
});
