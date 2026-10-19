import { z } from 'zod';

export const rosterRowSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名').max(80),
  cxid: z.string().trim().regex(/^\d{1,32}$/, 'cxid 只能包含数字').or(z.literal('')).default(''),
  studentNo: z.string().trim().max(64).default(''),
}).refine((row) => Boolean(row.cxid || row.studentNo), 'cxid 或学号至少填写一项');
export type RosterRow = z.infer<typeof rosterRowSchema>;

/** 支持 Excel 复制的制表符文本及 UTF-8 CSV；编号始终按字符串保存。 */
export function parseRosterText(source: string): RosterRow[] {
  if (source.length > 500_000) throw new Error('名单文件过大，请分批导入');
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('请提供学生名单');
  const delimiter = text.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else throw new Error('名单引号格式不正确');
    } else if (!quoted && (c === delimiter || c === '\n' || c === undefined)) {
      row.push(field.trim()); field = '';
      if (c !== delimiter) { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c !== undefined) field += c;
  }
  if (quoted) throw new Error('名单引号未闭合');
  const header = rows.shift() ?? [];
  const column = (names: string[]) => header.findIndex((h) => names.includes(h.toLowerCase()));
  const name = column(['姓名', 'name', '学生姓名']);
  const cxid = column(['cxid', 'uid', '超星号']);
  const studentNo = column(['学号', '工号', 'studentno', 'student_no']);
  if (name < 0 || (cxid < 0 && studentNo < 0)) throw new Error('表头需要“姓名”和“cxid”或“学号”');
  if (!rows.length || rows.length > 500) throw new Error('每次请导入 1 至 500 名学生');
  const seenCxid = new Set<string>(), seenNo = new Set<string>();
  return rows.map((cells, i) => {
    if (cells.length !== header.length) throw new Error(`第 ${i + 2} 行列数与表头不一致`);
    const parsed = rosterRowSchema.safeParse({ name: cells[name], cxid: cxid < 0 ? '' : cells[cxid], studentNo: studentNo < 0 ? '' : cells[studentNo] });
    if (!parsed.success) throw new Error(`第 ${i + 2} 行：${parsed.error.issues[0].message}`);
    const item = parsed.data;
    if ((item.cxid && seenCxid.has(item.cxid)) || (item.studentNo && seenNo.has(item.studentNo))) throw new Error(`第 ${i + 2} 行编号重复，请先核对`);
    if (item.cxid) seenCxid.add(item.cxid);
    if (item.studentNo) seenNo.add(item.studentNo);
    return item;
  });
}
