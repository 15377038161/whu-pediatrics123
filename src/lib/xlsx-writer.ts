/**
 * 教师端 Excel(.xlsx) 导出统一写入层。
 *
 * 只在服务端使用：exceljs 由 writeXlsx 内部动态 import 载入，客户端组件不得 import 本模块，
 * 否则会把整个表格库打进浏览器包（next.config.ts 已把 exceljs 列为 serverExternalPackages）。
 *
 * 与 CSV 版的口径差异：
 * - CSV 必须给以 = + - @ 开头的值前置单引号，因为 Excel 打开 CSV 时会把这类文本当公式解析；
 *   xlsx 里单元格类型由文件本身声明，本模块一律写字面字符串（绝不写 {formula}），
 *   因此同样的值在 xlsx 中结构上就不可能被执行，无需再加单引号污染原文。
 * - 分数/计数/时长按数字列写入（number 类型 + numFmt），老师在 Excel 里可直接求和排序，
 *   不会像文本那样只能计数。
 */

export type XlsxCell = string | number | null;

/** 列语义：number 走数字格式；percent 传入 0–1 的小数，由格式渲染成百分数。 */
export type XlsxColumnKind = 'text' | 'number' | 'percent';

export interface XlsxColumn {
  header: string;
  kind?: XlsxColumnKind;
  /** 显式列宽（字符数）；缺省按表头与内容自适应，范围 8–48。 */
  width?: number;
}

export interface XlsxSheetSpec {
  name: string;
  /** 表头上方的口径/脱敏说明行，跨列合并展示，随冻结窗格一起留在顶部。 */
  notes?: readonly string[];
  columns: readonly XlsxColumn[];
  rows: readonly (readonly XlsxCell[])[];
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 附件响应头：中文文件名按 RFC 5987 编码，同时给 ASCII 回退名，
 * 兼容不认 filename* 的旧客户端（直接访问链接时也能拿到可读文件名）。
 */
export function contentDisposition(filename: string, asciiFallback: string): string {
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * exceljs 的 load(buffer) 用的是 @types/node 里非泛型的旧 Buffer 声明，
 * 而 Buffer.from() 在 TS 5.7+ 下返回 Buffer<ArrayBufferLike>，两者互不赋值（只是类型层面，运行时就是 Buffer）。
 * 因此返回类型直接取 exceljs 的形参类型，集中桥接一次，避免每个读表调用点各写一遍断言。
 */
type ExcelJsLoadBuffer = Parameters<import('exceljs').Workbook['xlsx']['load']>[0];

export function toExcelJsBuffer(bytes: ArrayBuffer | Uint8Array): ExcelJsLoadBuffer {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) as unknown as ExcelJsLoadBuffer;
}

/** Excel 工作表名限制：不含 []:*?/\，最长 31 字符。 */
function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet';
  return [...cleaned].slice(0, 31).join('');
}

/** 中日韩全角字符按 2 个字符宽计，否则列宽会明显偏窄。 */
function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 2 : 1;
  return width;
}

async function loadExcelJs() {
  const imported = await import('exceljs');
  // exceljs 是 CJS，ESM 互操作下模块对象挂在 default 上；保留兜底以防打包器改写了形状。
  return (imported.default ?? imported) as typeof import('exceljs');
}

export async function writeXlsx(sheets: readonly XlsxSheetSpec[]): Promise<ArrayBuffer> {
  if (sheets.length === 0) throw new Error('导出内容不能为空');
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '珞珈儿科智训';
  workbook.created = new Date();

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(sheetName(spec.name));
    const columnCount = spec.columns.length;
    const notes = spec.notes ?? [];

    notes.forEach((note, index) => {
      const row = sheet.getRow(index + 1);
      row.getCell(1).value = note;
      row.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF5B6B66' } };
      row.getCell(1).alignment = { vertical: 'top', wrapText: true };
      if (columnCount > 1) sheet.mergeCells(index + 1, 1, index + 1, columnCount);
      row.height = 16;
    });

    const headerRowIndex = notes.length + 1;
    const headerRow = sheet.getRow(headerRowIndex);
    spec.columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F5E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFB9CFC7' } } };
    });
    headerRow.height = 22;

    spec.rows.forEach((cells, rowIndex) => {
      const row = sheet.getRow(headerRowIndex + 1 + rowIndex);
      cells.forEach((value, columnIndex) => {
        const column = spec.columns[columnIndex];
        const cell = row.getCell(columnIndex + 1);
        const kind = column?.kind ?? 'text';
        if (value === null || value === undefined || value === '') {
          cell.value = null;
        } else if (kind === 'text') {
          // 一律写字面字符串：即便内容以 = + - @ 开头也不会成为公式（见模块头注释）
          cell.value = String(value);
          cell.alignment = { vertical: 'top', wrapText: true };
        } else {
          const numeric = typeof value === 'number' ? value : Number(value);
          cell.value = Number.isFinite(numeric) ? numeric : null;
          cell.numFmt = kind === 'percent' ? '0.0%' : '0.##';
          cell.alignment = { vertical: 'top', horizontal: 'right' };
        }
      });
    });

    spec.columns.forEach((column, index) => {
      const widest = [column.header, ...spec.rows.map((cells) => cells[index])]
        .filter((value): value is string | number => value !== null && value !== undefined)
        .reduce<number>((max, value) => Math.max(max, displayWidth(String(value))), 0);
      sheet.getColumn(index + 1).width = column.width ?? Math.min(48, Math.max(8, widest + 2));
    });

    // 冻结说明行 + 表头：老师下滑看长名单时口径说明与列名始终可见
    sheet.views = [{ state: 'frozen', ySplit: headerRowIndex, xSplit: 0 }];
  }

  const written = await workbook.xlsx.writeBuffer();
  // 返回独立的 ArrayBuffer：exceljs 给的是 Node Buffer（类型 Buffer<ArrayBufferLike>），
  // 不满足 Response/NextResponse 的 BodyInit，直接传会编译失败。
  const bytes = new Uint8Array(written.byteLength);
  bytes.set(written as unknown as Uint8Array);
  return bytes.buffer;
}
