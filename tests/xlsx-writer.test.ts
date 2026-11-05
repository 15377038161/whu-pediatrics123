import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { contentDisposition, writeXlsx, XLSX_CONTENT_TYPE, type XlsxSheetSpec } from '@/lib/xlsx-writer';

async function readBack(bytes: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  return workbook;
}

const SHEET: XlsxSheetSpec = {
  name: '学情总表',
  notes: ['口径说明：姓名与学号已脱敏。', '分数为数字列，可直接求和。'],
  columns: [
    { header: '学生(脱敏)' },
    { header: '班级' },
    { header: '得分', kind: 'number' },
    { header: '正确率', kind: 'percent' },
  ],
  rows: [
    ['张*', '=HYPERLINK("http://evil")', 88, 0.756],
    ['李*', null, null, ''],
  ],
};

test('xlsx 写入：说明行 + 表头 + 冻结窗格位置与口径一致', async () => {
  const workbook = await readBack(await writeXlsx([SHEET]));
  const sheet = workbook.getWorksheet('学情总表');
  assert.ok(sheet, '工作表按名称创建');
  assert.equal(sheet.getRow(1).getCell(1).value, SHEET.notes?.[0], '第 1 行是口径说明');
  assert.equal(sheet.getRow(3).getCell(1).value, '学生(脱敏)', '表头紧跟说明行');
  assert.equal(sheet.getRow(4).getCell(1).value, '张*', '数据从表头下一行开始');
  const view = sheet.views[0];
  assert.equal(view?.state, 'frozen', '首屏冻结');
  assert.equal(view?.ySplit, 3, '冻结到表头（说明行 + 表头都留在顶部）');
});

test('xlsx 写入：分数按数字列落盘，空值留空而不是 0 或「未评分」文本', async () => {
  const sheet = (await readBack(await writeXlsx([SHEET]))).getWorksheet('学情总表');
  assert.ok(sheet);
  const score = sheet.getRow(4).getCell(3);
  assert.equal(score.type, ExcelJS.ValueType.Number, '得分是真正的数字单元格');
  assert.equal(score.value, 88);
  const rate = sheet.getRow(4).getCell(4);
  assert.equal(rate.numFmt, '0.0%', '正确率用百分数格式（传入 0–1 小数）');
  assert.equal(rate.value, 0.756);
  assert.equal(sheet.getRow(5).getCell(3).value, null, '未评分留空，不与 0 分混淆');
  assert.equal(sheet.getRow(5).getCell(4).value, null, '空字符串也留空');
  assert.equal(sheet.getRow(5).getCell(2).value, null);
});

test('xlsx 写入：以 = 开头的文本不会被当成公式（结构性免疫，无需前置单引号）', async () => {
  const sheet = (await readBack(await writeXlsx([SHEET]))).getWorksheet('学情总表');
  assert.ok(sheet);
  const cell = sheet.getRow(4).getCell(2);
  assert.notEqual(cell.type, ExcelJS.ValueType.Formula, '不能是公式单元格');
  assert.equal(cell.value, '=HYPERLINK("http://evil")', '原文保留，不加单引号污染');
});

test('xlsx 写入：列宽自适应且中文按双宽计，超长内容截到 48', async () => {
  const wide: XlsxSheetSpec = {
    name: 'W',
    columns: [{ header: 'A' }, { header: '长'.repeat(60) }],
    rows: [['短', '内容']],
  };
  const sheet = (await readBack(await writeXlsx([wide]))).getWorksheet('W');
  assert.ok(sheet);
  assert.equal(sheet.getColumn(1).width, 8, '窄列有最小宽度 8');
  assert.equal(sheet.getColumn(2).width, 48, '超宽列封顶 48');
});

test('xlsx 写入：工作表名非法字符替换、超长按 31 字符截断（Excel 硬限制）', async () => {
  const workbook = await readBack(await writeXlsx([{
    name: '病例/明细[草稿]:版本',
    columns: [{ header: 'A' }],
    rows: [['1']],
  }, {
    name: '超'.repeat(40),
    columns: [{ header: 'A' }],
    rows: [['1']],
  }]));
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ['病例 明细 草稿  版本', '超'.repeat(31)],
    '[]:*?/\\ 逐字符换空格，超长按字符（非字节）截断',
  );
});

test('xlsx 写入：多工作表按顺序输出，空清单直接拒绝', async () => {
  const workbook = await readBack(await writeXlsx([SHEET, { name: '汇总', columns: [{ header: '指标' }], rows: [['训练总数']] }]));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['学情总表', '汇总']);
  await assert.rejects(() => writeXlsx([]), /导出内容不能为空/);
});

test('附件响应头：中文名走 RFC 5987，同时给 ASCII 回退；Content-Type 为 xlsx 官方类型', () => {
  assert.equal(XLSX_CONTENT_TYPE, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const header = contentDisposition('学情总表_20261105.xlsx', 'student-summary-20261105.xlsx');
  assert.ok(header.startsWith('attachment; '), '必须是附件下载而不是内联打开');
  assert.ok(header.includes('filename="student-summary-20261105.xlsx"'), 'ASCII 回退名');
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent('学情总表_20261105.xlsx')}`), '中文名百分号编码');
});
