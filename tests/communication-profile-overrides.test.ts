import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDITED_COMMUNICATION_PROFILE_OVERRIDES, resolveAuditedCommunicationProfile } from '@/lib/communication-profile-overrides';
import { COMMUNICATION_PROFILE_OVERRIDES, canChildSpeak } from '@/domain/communication-profile';

/** 独立项 D（角色知情范围结构化）：逐例审核覆盖表服务端注入——
 *  覆盖字段必须有审核出处；未覆盖字段回退保守年龄默认档；
 *  含病种名的审核表只在服务端模块，不进客户端 bundle（防泄题）。 */

const ITP_ID = 'teacher-特发性血小板减少性紫癜';
const ITP_PUBLIC_ID = 'case-677d408e-a6a6-4e8d-ab06-a1365f15d97b';

test('ITP 逐例审核覆盖：意识/痛苦/知情范围/发育备注注入，年龄默认档其余字段保留', () => {
  const profile = resolveAuditedCommunicationProfile(ITP_ID, '3岁');
  assert.equal(profile.derivation, 'case_override');
  assert.equal(profile.consciousness, 'alert', '入院查体「神志清楚」');
  assert.equal(profile.distress, 'mild', '查体「精神一般」/角色资料「精神反应尚可」');
  assert.equal(profile.caregiverKnowledge, 'full', '角色资料：病史主要由家长回答');
  assert.equal(profile.childKnowledge, 'partial', '角色资料：患儿仅能答「哪里痛/哪里不舒服」');
  assert.ok(profile.developmentNotes?.includes('发育'), '发育备注来自教师标准化模板');
  // 未覆盖字段回退保守年龄默认档
  assert.equal(profile.speechCapability, 'limited', '3 岁 toddler 年龄默认档保留（与角色资料一致）');
  assert.equal(profile.primaryHistorian, 'caregiver');
  assert.equal(profile.caregiverGender, 'unknown', '原资料未指定家长性别，不编造');
  assert.equal(canChildSpeak(profile), true, 'limited 患儿可短句应答自身感知');
});

test('公开 opaque ID 与 URL 编码 ID 均命中同一覆盖（resolveCaseId 归一）', () => {
  const byPublic = resolveAuditedCommunicationProfile(ITP_PUBLIC_ID, '3岁');
  assert.equal(byPublic.derivation, 'case_override');
  assert.equal(byPublic.childKnowledge, 'partial');
  const byEncoded = resolveAuditedCommunicationProfile(encodeURIComponent(ITP_ID), '3岁');
  assert.equal(byEncoded.derivation, 'case_override');
  assert.equal(byEncoded.caregiverKnowledge, 'full');
});

test('无覆盖病例保持年龄默认档且知情范围 unknown（不凭空填值）', () => {
  const profile = resolveAuditedCommunicationProfile('teacher-其他未审核病例', '8个月');
  assert.equal(profile.derivation, 'age_default');
  assert.equal(profile.speechCapability, 'nonverbal');
  assert.equal(profile.childKnowledge, 'unknown');
  assert.equal(profile.caregiverKnowledge, 'unknown');
  assert.equal(profile.consciousness, 'unknown');
});

test('domain 客户端安全表不含任何逐例审核病种名（防泄题进客户端 bundle）', () => {
  assert.deepEqual(Object.keys(COMMUNICATION_PROFILE_OVERRIDES), [], 'domain 覆盖表必须为空：逐例审核内容只在服务端模块');
  assert.ok(Object.keys(AUDITED_COMMUNICATION_PROFILE_OVERRIDES).length > 0, '服务端审核表至少有 ITP 一条已审核覆盖');
});
