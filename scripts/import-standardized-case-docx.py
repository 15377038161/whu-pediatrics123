"""Import reviewed supplementary facts from the three 20261023 teacher forms.

Default is read-only. --apply updates private local runtime JSON only, with exact
backups and a per-case journal. It never publishes, imports DB rows or uploads
original records. Template role scripts and scoring advice are NOT patient facts.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from docx import Document

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    '00104f83abc7df8470c4a613f1758ad492d040e3348ff084fa4f1f55b2b5fe55': ('teacher-噬血细胞综合征', '12岁', '男'),
    '93ed1dde653b9291e4208b4e05b94a0da5f62dd0b49ecc3fe86d5465100a5dfe': ('teacher-蚕豆病', '10岁', '男'),
    '9e7a3a197877f5b0dd79fd67ca88aa448ef1d1827e5f511968abe11b1b9bfc59': ('teacher-特发性血小板减少性紫癜', '3岁', '女'),
}
SUPPLEMENT_FIELDS = ['出生史', '生长发育史', '喂养史']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def selected_basic_facts(document):
    """The right column is the completed value; HLH left cells retain old examples."""
    matches = [t for t in document.tables if any(r.cells[0].text.strip().startswith('性别、年龄') for r in t.rows)]
    if len(matches) != 1:
        raise ValueError('Missing/ambiguous patient information table')
    fields = {}
    for row in matches[0].rows:
        label = row.cells[0].text.strip()
        for key in ['性别、年龄', '主诉', '现病史', '既往史', *SUPPLEMENT_FIELDS]:
            if label.startswith(key):
                fields[key] = row.cells[-1].text.strip()
                break
    return fields


def candidate(record, fields, sha):
    cid, age, sex = EXPECTED[sha]
    if record['caseId'] != cid or record['age'] != age or record['sex'] != sex:
        raise ValueError('Patient identity conflicts with the reviewed mapping')
    normalized = re.sub(r'\s+', '', fields['性别、年龄'])
    if sex not in normalized or age not in normalized:
        raise ValueError('Attachment patient differs from current case')
    if '主诉' not in fields or re.sub(r'[；;。\s]', '', fields['主诉']) != re.sub(r'[；;。\s]', '', record['complaint']):
        raise ValueError('Chief complaint requires human conflict review')
    result = deepcopy(record)
    source = f'标准化资料补充/{cid}.docx'
    if any(d['sha256'] == sha for d in record['documents']):
        return result, []
    additions = []
    for label in SUPPLEMENT_FIELDS:
        value = fields.get(label, '')
        if value and label not in result['sections']['history']:
            result['sections']['history'] += '\n' + label + '：' + value
            additions.append(label)
    # Keep ONLY patient-specific selected fields. Do not copy another patient's
    # examples, template instructions, generic role text, diagnosis claims or doses.
    text = '\n'.join(f'{label}：{fields[label]}' for label in ['性别、年龄', '主诉', *SUPPLEMENT_FIELDS] if fields.get(label))
    result['documents'].append({'source': source, 'text': text, 'sha256': sha})
    return result, additions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', action='append', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    out = ROOT / 'outputs/case-library-review/20261023'
    out.mkdir(parents=True, exist_ok=True)
    manifest_file = out / 'standardized-intake-manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8')) if manifest_file.exists() else {'cases': []}
    prepared = []
    for file in args.input:
        sha = digest(file.read_bytes())
        if sha not in EXPECTED:
            raise ValueError('Attachment fingerprint is outside the reviewed batch')
        cid, _, _ = EXPECTED[sha]
        target = ROOT / 'knowledge/teaching-cases' / (cid + '.json')
        before = target.read_bytes()
        existing = next((r for r in manifest['cases'] if r['caseId'] == cid), None)
        if existing and digest(before) == existing['afterSha256']:
            existing['status'] = 'applied_local_only'
            continue
        if existing and digest(before) != existing['beforeSha256']:
            raise ValueError('Runtime changed after a prior attempt; inspect before retrying')
        fields = selected_basic_facts(Document(file))
        result, additions = candidate(json.loads(before), fields, sha)
        after = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        prepared.append((cid, sha, target, before, after, additions))
    if args.apply:
        for cid, sha, target, before, after, additions in prepared:
            if before == after:
                continue
            backup = out / 'runtime-backups' / (cid + '.' + digest(before)[:12] + '.json')
            backup.parent.mkdir(parents=True, exist_ok=True)
            if backup.exists():
                assert backup.read_bytes() == before
            else:
                backup.write_bytes(before)
            row = {'caseId': cid, 'sourceSha256': sha, 'beforeSha256': digest(before), 'afterSha256': digest(after),
                   'backup': backup.relative_to(ROOT).as_posix(), 'addedHistoryFields': additions, 'status': 'prepared',
                   'excluded': ['template_role_dialogue', 'generic_scoring_rules', 'other_patient_examples', 'unverified_dosing'],
                   'at': datetime.now(timezone.utc).isoformat()}
            manifest['cases'] = [r for r in manifest['cases'] if r['caseId'] != cid] + [row]
            manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            assert target.read_bytes() == before
            temp = target.with_suffix('.intake-tmp')
            temp.write_bytes(after)
            temp.replace(target)
            row['status'] = 'applied_local_only'
            manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'selectedAttachments': len(args.input), 'pendingCases': len(prepared), 'applied': args.apply,
                      'databaseWrites': False, 'published': False, 'originalsChanged': False}))


if __name__ == '__main__':
    main()
