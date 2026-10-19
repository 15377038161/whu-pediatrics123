import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  extractCaseDocument,
  prepareCaseDocument,
  MAX_CASE_FILE_BYTES,
} from '../src/lib/case-document';

const clinical =
  '病种名称\n教学病例\n性别、年龄\n女，1岁3月\n主诉\n发热伴咳嗽2天\n现病史\n发热2天。\n既往史\n原文未记录\n体格检查\n体温38℃\n三、检查资料\n血常规：详见原始结果\n四、典型图片、声音和视频\n图示待审核\n五、诊断与临床思路\n教师诊断记录\n六、治疗经过与随访计划\n教师处置记录\n七、教学训练信息\n教学目标';
test('模板按临床顺序分段，原文完整保留，图片教学目标不混入结果', () => {
  const result = prepareCaseDocument(clinical, '教学.docx');
  assert.equal(result.sourceName, '教学病例');
  assert.equal(result.payload.age, '1岁3月');
  assert.equal(result.payload.sex, '女');
  assert.equal(result.payload.complaint, '发热伴咳嗽2天');
  assert.equal(result.payload.sections.exam, '体温38℃');
  assert.equal(result.payload.sections.tests, '血常规：详见原始结果');
  assert.equal(result.payload.sections.diagnosis, '教师诊断记录');
  assert.equal(result.payload.sections.plan, '教师处置记录');
  assert.equal(result.payload.documents?.[0].text, clinical);
  assert.match(result.payload.caseId, /^intake-/);
  assert.equal(
    result.fingerprint,
    prepareCaseDocument(clinical, '教学.docx').fingerprint,
  );
});
test('同名字段冲突不擅自选择；缺少的结果不编造正常', () => {
  const result = prepareCaseDocument(
    '年龄：1岁6月\n年龄：1岁3月\n主诉：发热6天\n主诉：发热2天',
    '病例.txt',
  );
  assert.equal(result.payload.age, '');
  assert.equal(result.payload.complaint, '');
  assert.equal(result.payload.sections.exam, '');
  assert.ok(result.issues.some((issue) => issue.includes('年龄出现多种记录')));
});
test('模板文件夹说明不应误报重复病种名称', () => {
  const result = prepareCaseDocument(`${clinical}\n病种名称/\n病种名称、病例类型、整理教师`, 'source.docx');
  assert.equal(result.sourceName, '教学病例');
  assert.ok(!result.issues.some(issue => issue.includes('病例名称出现多种记录')));
});
test('空表格单元格不把下一字段标题当作病例事实', () => {
  const result = prepareCaseDocument('病种名称\n所属系统或专科\n呼吸系统\n主诉\n现病史\n发热2天', '待核对.docx');
  assert.equal(result.sourceName, '待核对');
  assert.equal(result.payload.complaint, '');
  assert.equal(result.payload.sections.history, '发热2天');
});
test('含身份字段或长编号必须提示，不修改源事实', () => {
  const result = prepareCaseDocument(
    '姓名：测试姓名\n住院号：123456789012345\n主诉：发热',
    '病例.txt',
  );
  assert.ok(result.issues.some((issue) => issue.includes('身份信息')));
  assert.ok(result.payload.documents?.[0].text?.includes('123456789012345'));
});
test('UTF-8文本、无效编码、旧doc、空文件、伪docx与过大文件', async () => {
  assert.equal(
    await extractCaseDocument('病例.txt', strToU8('主诉：发热')),
    '主诉：发热',
  );
  await assert.rejects(
    extractCaseDocument('病例.txt', new Uint8Array([255, 254])),
    /UTF-8/,
  );
  await assert.rejects(
    extractCaseDocument('病例.doc', strToU8('abc')),
    /另存为/,
  );
  await assert.rejects(
    extractCaseDocument('病例.docx', strToU8('not a ZIP')),
    /无法读取/,
  );
  await assert.rejects(
    extractCaseDocument('病例.txt', new Uint8Array()),
    /为空/,
  );
  await assert.rejects(
    extractCaseDocument('病例.txt', new Uint8Array(MAX_CASE_FILE_BYTES + 1)),
    /10 MB/,
  );
  await assert.rejects(
    extractCaseDocument('病例.docx', zipSync({ 'other.xml': strToU8('x') })),
    /无法读取/,
  );
});
test('有效Word表格文字按原顺序读取，HTML不作为可执行页面返回', async () => {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>主诉</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>发热2天</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>体格检查</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const text = await extractCaseDocument('教学.docx', bytes);
  assert.ok(text.indexOf('主诉') < text.indexOf('发热2天'));
  assert.ok(text.indexOf('发热2天') < text.indexOf('体格检查'));
  assert.ok(!text.includes('<w:'));
});
test('解压后过大档案在Word读取之前拒绝', async () => {
  const bytes = zipSync({
    'word/document.xml': new Uint8Array(13 * 1024 * 1024),
  });
  await assert.rejects(extractCaseDocument('大文件.docx', bytes), /解压后过大/);
});
