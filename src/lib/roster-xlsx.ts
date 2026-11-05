import { parseRosterGrid, type RosterRow } from '@/lib/class-roster';
import { toExcelJsBuffer } from '@/lib/xlsx-writer';

/**
 * 学生名单 .xlsx 解析（服务端专用）。
 *
 * exceljs 只在服务端动态 import：它体积大且带可选原生依赖，绝不能进客户端包，
 * 因此本模块不得被任何 'use client' 组件导入（next.config.ts 已把 exceljs 列为 serverExternalPackages）。
 * 解析只负责「表格 → 二维文本」，表头识别/必填校验/行号提示/编号去重全部交给 parseRosterGrid，
 * 与粘贴文本、CSV 两条来路共用同一口径，避免出现第二套名单规则。
 */

const MAX_BYTES = 5_000_000;

async function loadExcelJs(): Promise<typeof import('exceljs')> {
  const imported = await import('exceljs');
  return (imported.default ?? imported) as typeof import('exceljs');
}

/**
 * 单元格 → 文本。表格软件里同一列可能混着数字、日期、超链接与富文本，
 * 这里统一降为纯文本再走名单校验，避免 [object Object] 之类的脏值入库。
 * 公式单元格只取缓存结果、绝不求值：名单里的公式一律按显示出来的文本看待。
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    // 整数按定点输出，防止 1e+21 之类的科学计数法把学号写坏；
    // 超长编号本身已被表格软件截断精度，建议老师把编号列设为文本格式。
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toFixed(0);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '是' : '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => cellText((part as Record<string, unknown>)?.text)).join('').trim();
    }
    if ('result' in record) return cellText(record.result);
    if ('text' in record) return cellText(record.text);
    if ('error' in record) throw new Error(`单元格内容为表格错误值（${String(record.error)}），请先修正后重新导出`);
  }
  return String(value).trim();
}

/** 读取第一个工作表并校验为名单行；错误一律是可操作的中文提示（不抛未捕获异常给调用方）。 */
export async function parseRosterXlsx(bytes: Uint8Array): Promise<RosterRow[]> {
  if (bytes.byteLength === 0) throw new Error('文件内容为空，请重新选择');
  if (bytes.byteLength > MAX_BYTES) throw new Error('名单文件过大（超过 5MB），请分批导入');
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(toExcelJsBuffer(bytes));
  } catch {
    throw new Error('无法读取该文件，请确认为 .xlsx（Excel 2007 及以上）格式；.xls 请另存为 .xlsx 后重试');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('文件中没有工作表');

  // 所有行按同一列数补齐/截断，parseRosterGrid 才能用「列数与表头一致」这条既有校验兜住错行
  const columnCount = sheet.columnCount;
  const grid: string[][] = [];
  for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex++) {
    const row = sheet.getRow(rowIndex);
    const cells: string[] = [];
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex++) cells.push(cellText(row.getCell(columnIndex).value));
    // 整行空白（含只刷了格式的空行）直接跳过，与粘贴/CSV 路径的「空行不入表」保持一致
    if (cells.some(Boolean)) grid.push(cells);
  }
  if (!grid.length) throw new Error('工作表没有内容，请把表头放在第一行（姓名 / cxid / 学号）');
  return parseRosterGrid(grid);
}
