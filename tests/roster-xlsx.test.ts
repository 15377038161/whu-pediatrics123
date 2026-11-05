import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseRosterXlsx } from '@/lib/roster-xlsx';

async function buildXlsx(rows: readonly unknown[][], sheetName = '名单'): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  rows.forEach((cells) => sheet.addRow(cells));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

test('名单 .xlsx：表头 + 数据行解析成与粘贴/CSV 同构的行，编号按文本保存', async () => {
  const rows = await parseRosterXlsx(await buildXlsx([
    ['姓名', 'cxid', '学号'],
    ['张同学', 123456, ''],
    ['李同学', '', '001234'],
  ]));
  assert.deepEqual(rows, [
    { name: '张同学', cxid: '123456', studentNo: '' },
    { name: '李同学', cxid: '', studentNo: '001234' },
  ]);
});

test('名单 .xlsx：整行空白（含只刷格式的空行）跳过，短行按表头列数补齐后仍校验必填', async () => {
  const rows = await parseRosterXlsx(await buildXlsx([
    ['姓名', '学号'],
    ['王同学', '0001'],
    ['', ''],
    ['赵同学', '0002'],
  ]));
  assert.deepEqual(rows.map((row) => row.name), ['王同学', '赵同学']);
  // 只有前两列有内容时，第三列缺失不能让「列数与表头不一致」误伤老师
  await assert.rejects(
    async () => parseRosterXlsx(await buildXlsx([['姓名', 'cxid', '学号'], ['孙同学', 1, ''], ['周同学']])),
    /第 3 行/,
  );
});

test('名单 .xlsx：表头缺列、缺编号、编号重复都给出可操作的中文提示（含行号）', async () => {
  await assert.rejects(async () => parseRosterXlsx(await buildXlsx([['学号'], ['0001']])), /第一行需要是表头/);
  // 老师直接上传没有表头的数据表时，也要说清是表头缺失，而不是报「姓名无效」
  await assert.rejects(async () => parseRosterXlsx(await buildXlsx([['张同学', '123']])), /第一行需要是表头/);
  await assert.rejects(async () => parseRosterXlsx(await buildXlsx([['姓名', 'cxid'], ['甲同学', '']])), /第 2 行/);
  await assert.rejects(
    async () => parseRosterXlsx(await buildXlsx([['姓名', 'cxid'], ['甲同学', '1'], ['乙同学', '1']])),
    /第 3 行编号重复/,
  );
  await assert.rejects(async () => parseRosterXlsx(await buildXlsx([['姓名', 'cxid']])), /每次请导入 1 至 500 名学生/);
});

test('名单 .xlsx：富文本、超链接、日期与数字单元格统一降为纯文本，公式只取缓存结果', async () => {
  const rows = await parseRosterXlsx(await buildXlsx([
    ['姓名', 'cxid', '学号'],
    [{ richText: [{ text: '欧阳' }, { text: '娜娜' }] }, { text: '123456', hyperlink: 'http://example.com' }, new Date('2026-03-01T00:00:00.000Z')],
    ['甲同学', { formula: 'A1', result: 987654 }, 1.5],
  ]));
  assert.deepEqual(rows[0], { name: '欧阳娜娜', cxid: '123456', studentNo: '2026-03-01' });
  assert.equal(rows[1].cxid, '987654', '公式单元格取显示结果，不在服务端求值');
  await assert.rejects(
    async () => parseRosterXlsx(await buildXlsx([['姓名', '学号'], ['乙同学', { error: '#N/A' }]])),
    /表格错误值/,
  );
});

test('名单 .xlsx：空文件、非 xlsx 内容、空工作表都给出明确原因而不是抛未捕获异常', async () => {
  await assert.rejects(() => parseRosterXlsx(new Uint8Array(0)), /文件内容为空/);
  await assert.rejects(
    () => parseRosterXlsx(new TextEncoder().encode('姓名,cxid\n张同学,1')),
    /无法读取该文件，请确认为 \.xlsx/,
    '把 CSV 当 .xlsx 上传时要说清格式要求',
  );
  await assert.rejects(async () => parseRosterXlsx(await buildXlsx([])), /工作表没有内容/);
});

test('名单 .xlsx：超过 5MB 直接在解析前拒绝', async () => {
  await assert.rejects(() => parseRosterXlsx(new Uint8Array(5_000_001)), /名单文件过大/);
});

test('名单 .xlsx：只读第一个工作表（老师常把说明放在后面的表）', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('名单').addRows([['姓名', '学号'], ['张同学', '0001']]);
  workbook.addWorksheet('说明').addRows([['本表仅说明用'], ['不该被导入']]);
  const rows = await parseRosterXlsx(new Uint8Array(await workbook.xlsx.writeBuffer()));
  assert.deepEqual(rows, [{ name: '张同学', cxid: '', studentNo: '0001' }]);
});
