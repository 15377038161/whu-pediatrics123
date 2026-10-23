"""Compare recorded source text with existing DOC-to-DOCX conversions, read only."""
import ast
import hashlib
import json
from pathlib import Path
import re
from docx import Document

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/case-library-review/20261021'


def main():
    tree = ast.parse((ROOT / 'scripts/prepare-teacher-cases.py').read_text(encoding='utf-8'))
    cleaner = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'clean')
    namespace = {'re': re}
    exec(compile(ast.Module(body=[cleaner], type_ignores=[]), '<source-cleaner>', 'exec'), namespace)
    clean = namespace['clean']
    audit = json.loads((OUT / 'section-audit.json').read_text(encoding='utf-8'))
    ledger = [json.loads(line) for line in (OUT / 'materials.jsonl').read_text(encoding='utf-8').splitlines()]
    results = []
    for item in audit['results']:
        sha = item.get('primaryDocumentSha256')
        original = next((m for m in ledger if m['sha256'] == sha and m['role'] == 'source_material' and m['sourceCaseId'] == item['caseId'] and m['extension'] == '.doc'), None)
        if not original:
            continue
        row = {'caseId': item['caseId'], 'materialId': original['materialId'], 'sourceSha256': sha,
               'status': 'not_verified', 'visualReview': 'not_performed', 'originalChanged': False}
        if hashlib.sha256((ROOT / original['path']).read_bytes()).hexdigest() != sha:
            row['status'] = 'source_fingerprint_mismatch'
            results.append(row)
            continue
        converted = list((ROOT / 'output/case-drafts/converted' / sha).glob('*.docx'))
        if len(converted) != 1:
            row['status'] = 'missing_or_ambiguous_conversion'
            results.append(row)
            continue
        doc = Document(converted[0])
        lines = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for cells in table.rows:
                line = ' | '.join(c.text.strip().replace('\n', ' / ') for c in cells.cells)
                if line.strip(' |'):
                    lines.append(line)
        text = clean('\n'.join(lines))
        record = json.loads((ROOT / 'knowledge/teaching-cases' / (item['caseId'] + '.json')).read_text(encoding='utf-8'))
        source = next(d for d in record['documents'] if d['sha256'] == sha)
        row.update(convertedSha256=hashlib.sha256(converted[0].read_bytes()).hexdigest(),
                   extractedCharacters=len(text), recordedCharacters=len(source['text']),
                   status='exact_cleaned_converted_text_match' if text == source['text'] else 'text_mismatch',
                   limitations=['Existing conversion, not a fresh binary-DOC rendering', 'No clinical correctness or complete privacy approval'])
        results.append(row)
    counts = {status: sum(r['status'] == status for r in results) for status in sorted({r['status'] for r in results})}
    (OUT / 'doc-conversion-text-review.json').write_text(json.dumps({'counts': counts, 'results': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'compared': len(results), 'counts': counts, 'sourceMutation': False}))


if __name__ == '__main__':
    main()
