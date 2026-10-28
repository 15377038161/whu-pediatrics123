import assert from 'node:assert/strict';
import test from 'node:test';
import { TRUSTED_TEST_NAMES, trustedTestLabel } from '@/domain/case';

test('数值前缀行：白名单匹配剥离数值，数值不进目录', () => {
  assert.equal(trustedTestLabel('降钙素原 0.58 ng/mL：明显升高', 0), '降钙素原');
  assert.equal(trustedTestLabel('超敏C反应蛋白 8.2 mg/L：升高', 1), '超敏C反应蛋白');
});

test('阳性结论前缀行：无白名单匹配回退「检查记录 N」，结论不进目录', () => {
  assert.equal(trustedTestLabel('WBC升高：提示细菌感染', 0), '检查记录 1');
  assert.equal(trustedTestLabel('明显代谢性酸中毒：考虑代谢异常', 3), '检查记录 4');
});

test('结论行前缀命中白名单时 label 为白名单名（数值/结论仍不进目录）', () => {
  // 「乳酸堆积明显」前缀命中白名单「乳酸」——label 为检查名本身，不含数值与结论，不泄露答案
  assert.equal(trustedTestLabel('乳酸堆积明显：考虑代谢异常', 0), '乳酸');
});

test('常规冒号行：白名单名作为 label', () => {
  assert.equal(trustedTestLabel('血气分析：pH 7.31，PCO2 65mmHg', 0), '血气分析');
  assert.equal(trustedTestLabel('胸片：双肺纹理增粗', 1), '胸片');
});

test('行首序号剥离后匹配白名单', () => {
  assert.equal(trustedTestLabel('1、血常规：WBC 12.3×10^9/L', 0), '血常规');
  assert.equal(trustedTestLabel('三、心脏彩超：室间隔稍厚', 2), '心脏彩超');
});

test('无冒号整行结果：回退「检查记录 N」', () => {
  assert.equal(trustedTestLabel('双肺呼吸音粗，未闻及干湿性啰音', 0), '检查记录 1');
});

test('最长前缀匹配：血气分析优先于血气', () => {
  assert.equal(trustedTestLabel('血气分析：pH 7.31', 0), '血气分析');
  assert.equal(trustedTestLabel('血气：pH 7.31', 0), '血气');
});

test('PET/CT 项目可识别且目录不带检查结果', () => {
  assert.equal(trustedTestLabel('PET/CT：合成结果，仅供测试', 0), 'PET/CT');
  assert.equal(trustedTestLabel('1、PET/CT：SUV 3.2，合成结论', 1), 'PET/CT');
  assert.equal(trustedTestLabel('CT：合成对照', 2), 'CT');
});

test('白名单名在行中不前缀匹配（保守回退检查记录）', () => {
  assert.equal(trustedTestLabel('入院后查血常规：WBC 15', 0), '检查记录 1');
});

test('白名单自身完整性：无重复、无空串、无 like 通配符、无数字', () => {
  assert.equal(new Set(TRUSTED_TEST_NAMES).size, TRUSTED_TEST_NAMES.length, '白名单存在重复项');
  assert.ok(TRUSTED_TEST_NAMES.every((name) => name.length > 0), '白名单存在空串');
  assert.ok(TRUSTED_TEST_NAMES.every((name) => !/[%_]/.test(name)), '白名单含 like 通配符（SQL like 匹配会失真）');
  assert.ok(TRUSTED_TEST_NAMES.every((name) => !/\d/.test(name)), '白名单含数字（与探针无数字断言冲突）');
});

test('全部白名单 label 均不含数值与阳性结论关键词', () => {
  const dangerous = /升高|降低|正常|异常|阳性|阴性|提示|可见|考虑|\d/;
  for (const [line, index] of [
    ['降钙素原 0.58 ng/mL：明显升高', 0],
    ['WBC 15.2×10^9/L，N 78%，提示细菌感染', 1],
    ['头颅CT：双侧基底节区可见异常信号', 2],
  ] as Array<[string, number]>) {
    const label = trustedTestLabel(line, index);
    assert.match(label, /^(检查记录 \d+|[^0-9]+)$/);
    assert.ok(!dangerous.test(label.replace(/^检查记录 \d+$/, '')), `label 含数值/结论: ${label}`);
  }
});
