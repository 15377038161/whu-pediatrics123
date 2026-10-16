import mammoth from 'mammoth';
import { unzipSync } from 'fflate';
import { createHash, randomUUID } from 'node:crypto';
import type { CaseDraftPayload } from './case-draft-import';

export const MAX_CASE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CASE_TEXT = 150_000;
export class CaseDocumentError extends Error {}

/** Only raw text is returned; document HTML, links, macros and images are never rendered. */
export async function extractCaseDocument(
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  if (!bytes.length || bytes.length > MAX_CASE_FILE_BYTES)
    throw new CaseDocumentError('文件为空或超过 10 MB，请拆分后上传。');
  if (/\.txt$/i.test(name)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new CaseDocumentError(
        '文本编码无法识别，请保存为 UTF-8 文本，或直接粘贴正文。',
      );
    }
    return validateCaseText(text);
  }
  if (!/\.docx$/i.test(name))
    throw new CaseDocumentError(
      '请上传 .docx 或 UTF-8 .txt；旧版 .doc 请在 Word 中另存为 .docx。',
    );
  let total = 0,
    count = 0,
    documentFound = false;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        count++;
        if (
          count > 1500 ||
          total > 40 * 1024 * 1024 ||
          file.originalSize > 12 * 1024 * 1024
        )
          throw new Error('limit');
        if (file.name === 'word/document.xml') documentFound = true;
        return false; // Inspect ZIP metadata before allowing the Word reader to decompress anything.
      },
    });
    if (!documentFound) throw new Error('not-word');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return validateCaseText(result.value);
  } catch (error) {
    if (error instanceof CaseDocumentError) throw error;
    throw new CaseDocumentError(
      '无法读取此 Word 文件，或文档解压后过大。请重新另存为 .docx，或粘贴正文。',
    );
  }
}

export function validateCaseText(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  if (!normalized || normalized.length > MAX_CASE_TEXT)
    throw new CaseDocumentError('正文为空或超过 15 万字，请拆分为单个病例。');
  return normalized;
}

/** Deterministic template segmentation, not a clinical interpretation. Unmatched text stays in the source. */
export function prepareCaseDocument(raw: string, sourceName: string) {
  const text = validateCaseText(raw);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const value = (label: string) => {
    const values: string[] = [];
    const pattern = new RegExp(`^(?:${label})[：:]?\\s*(.*)$`);
    lines.forEach((line, i) => {
      const match = line.match(pattern);
      if (match) values.push(match[1] || lines[i + 1] || '');
    });
    return [...new Set(values.filter(Boolean))];
  };
  const issues: string[] = [
    '自动整理只按标题分段，请逐项对照原文；未识别的内容仍保留在原文中。',
    '正文及图片的脱敏、授权与医学审核尚需教师确认；上传不会导入图片或发布给学生。',
  ];
  const single = (values: string[], label: string) => {
    if (values.length > 1) {
      issues.push(`${label}出现多种记录，请核对后填写：${values.join('；')}`);
      return '';
    }
    return values[0] ?? '';
  };
  const demographics = value('性别[、，, /]*年龄|年龄[、，, /]*性别');
  const age = single(
    [
      ...new Set(
        [...value('年龄'), ...demographics].flatMap(
          (s) =>
            s.match(
              /\d+\s*(?:岁(?:\s*\d+\s*(?:个?月))?|个?月|天|日)(?:\s*\d+\s*天)?/g,
            ) ?? [],
        ),
      ),
    ],
    '年龄',
  );
  const sex = single(
    [
      ...new Set(
        [...value('性别'), ...demographics].flatMap(
          (s) => s.match(/男|女/g) ?? [],
        ),
      ),
    ],
    '性别',
  );
  const section = (start: RegExp, end: RegExp) => {
    const index = lines.findIndex((line) => start.test(line));
    if (index < 0) return '';
    const result: string[] = [];
    for (let i = index; i < lines.length; i++) {
      if (i > index && end.test(lines[i])) break;
      const line =
        i === index
          ? lines[i].replace(start, '').replace(/^[：:]\s*/, '')
          : lines[i];
      if (line) result.push(line);
    }
    return result.join('\n');
  };
  const payload: CaseDraftPayload = {
    caseId: `intake-${randomUUID()}`,
    age,
    sex,
    complaint: single(value('主诉'), '主诉'),
    sections: {
      history: section(/^现病史\s*[：:]?/, /^(?:体格检查|查体|三[、.．])/),
      exam: section(
        /^(?:体格检查|查体)\s*[：:]?/,
        /^(?:本病例最有诊断价值|三[、.．]|辅助检查|检查资料)/,
      ),
      tests: section(
        /^(?:三[、.．]\s*)?(?:检查资料|辅助检查)\s*[：:]?/,
        /^(?:四[、.．]|五[、.．]|典型图片|诊断与临床思路|诊断[：:])/,
      ),
      diagnosis: section(
        /^(?:五[、.．]\s*)?(?:诊断与临床思路|诊断)\s*[：:]?/,
        /^(?:六[、.．]|治疗经过|诊疗计划|治疗[：:])/,
      ),
      plan: section(
        /^(?:六[、.．]\s*)?(?:治疗经过与随访计划|诊疗计划|治疗)\s*[：:]?/,
        /^(?:七[、.．]|八[、.．]|教学训练信息|参考资料)/,
      ),
    },
    documents: [{ source: sourceName, text }],
  };
  const name =
    single(value('病种名称|病例名称'), '病例名称') ||
    sourceName.replace(/\.(docx|txt)$/i, '').replace(/^智慧课程[-—]/, '');
  if (
    /(?:姓名|住院号|门诊号|身份证|联系电话|家庭住址)[：:]\s*\S|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{14,18}[Xx]?(?!\d)/.test(
      text,
    )
  )
    issues.push(
      '原文可能含身份信息或长编号，请先核对并脱敏；系统未自动删除原始记录。',
    );
  return {
    payload,
    sourceName: name,
    issues,
    fingerprint: createHash('sha256').update(text).digest('hex'),
  };
}
