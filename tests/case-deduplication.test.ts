import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_CATALOG, findPublicCase } from '../src/domain/case-catalog';
import { getPublicCase, isTrainableCase } from '../src/lib/case-identity';

const canonicalByRetired: Record<string, string> = {
  'case-5a51b3c9-ea4a-4c1b-96f8-20a9b59e44b7': 'case-a3a869a1-23ca-40db-a47c-2bf731f0d1e6',
  'case-57ba1841-4e5b-485a-9b2a-8576a819a078': 'case-fd688a62-f962-4048-ac59-da64b5be9657',
  'case-13fd5366-b7be-4dcc-8c2a-e00d28384b8c': 'case-d7cb30cb-b1a5-477b-bb41-7833f3438887',
  'case-4d3ae886-e69b-4820-bc66-f5687506e26d': 'case-c47e726a-cd18-49ee-bc20-faa4d6ed566b',
  'case-171082d2-069e-46f7-8c4c-4cdaa5dacdf2': 'case-25e26c63-3f38-4c27-9ea9-eda221c876d9',
  'case-3a061e58-1306-4f33-be6b-c6ffa7917c87': 'case-280837cf-54c4-4930-b40d-977ced5c1827',
  'case-ea9a434b-2f3c-41bc-a7b4-52c9ab3a52ea': 'case-280837cf-54c4-4930-b40d-977ced5c1827',
  'case-d1d70aa5-eb74-4a74-8fb3-43b86f9804fa': 'case-e3b0b49e-7b0a-4b97-a5c5-5e72b3604172',
  'case-934c97ab-fe0c-4908-91ba-12ec837e4668': 'case-3e0c843f-b420-4646-889f-352eb34d8e93',
  'case-f4869d4e-d88b-475b-8e04-b6d299979062': 'case-31db42f5-fcf2-4213-8675-8656b3b9e1b0',
  'case-9c03399f-1652-48f2-8c02-ceaca7a3d8a9': 'case-5dedff4c-1766-4f40-bd23-ab03662617d6',
  'case-12c7efe2-9eb0-4283-b346-e4f96c0a663e': 'case-c3633068-d383-4b2e-a48a-2c53c6679e4a',
  'case-da29f881-d2b2-410b-bd22-65de0fc1bb13': 'case-beb0c090-f6be-4c20-bd79-d21544d88354',
  'case-5197c841-12f4-4c6d-b3a9-f816fb68d91a': 'case-b115e85f-f023-4de5-ae96-dc4e788ad227',
  'case-6d3b5195-2419-4734-be1e-a09ea948fe61': 'case-647368e2-9bfa-463c-97c2-db8d867354a8',
};

test('闯关只开放52个不同病例，重复入口保留历史投影但禁止新训练', () => {
  assert.equal(CASE_CATALOG.length, 52);
  assert.ok(CASE_CATALOG.every((item) => item.sourceRelation === null));
  for (const [retired, canonical] of Object.entries(canonicalByRetired)) {
    assert.ok(!CASE_CATALOG.some((item) => item.id === retired), retired);
    assert.ok(CASE_CATALOG.some((item) => item.id === canonical), canonical);
    assert.equal(isTrainableCase(retired), false, retired);
    assert.equal(isTrainableCase(canonical), true, canonical);
    assert.equal(findPublicCase(retired)?.id, retired);
    assert.equal(getPublicCase(retired).id, retired);
  }
});

test('开放病例的展示主诉互不重复，新生儿黄染补充源病史已有伴随症状', () => {
  const complaints = CASE_CATALOG.map((item) => item.presentingSymptoms[0]);
  assert.ok(complaints.every(Boolean));
  assert.equal(new Set(complaints).size, CASE_CATALOG.length);
  assert.equal(
    CASE_CATALOG.find((item) => item.id === 'case-e750c5ff-d229-43a6-8314-2e633cacdc32')?.presentingSymptoms[0],
    '皮肤黄染1天，伴吐奶2次',
  );
  assert.equal(
    CASE_CATALOG.find((item) => item.id === 'case-87fc430b-dd4e-4aa4-8437-aab1d4b840ab')?.presentingSymptoms[0],
    '皮肤黄染1天',
  );
});
