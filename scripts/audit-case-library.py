"""Read-only local inventory for the case-library review; never writes source data.

Reports contain paths/IDs/hashes and structural gaps, never patient narrative.
Run from repository root: python scripts/audit-case-library.py
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MEDIA = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp3', '.wav', '.mp4', '.avi', '.mov', '.dcm'}
DOCUMENTS = {'.doc', '.docx', '.pdf', '.pptx', '.xlsx', '.xls', '.txt'}
SECTIONS = ('history', 'exam', 'tests', 'diagnosis', 'plan')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def literal(path, marker, opening):
    text = path.read_text(encoding='utf-8')
    assignment = text.index('=', text.index(marker))
    start = text.index(opening, assignment + 1)
    return json.JSONDecoder().raw_decode(text[start:])[0]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='outputs/case-library-review/20261021')
    args = parser.parse_args()
    out = (ROOT / args.output).resolve()
    if ROOT not in out.parents or out == ROOT:
        raise SystemExit('Output must stay inside the repository.')
    if not git('check-ignore', str(out.relative_to(ROOT))):
        raise SystemExit('Output must be Git ignored to protect private source paths.')
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    start_head = git('rev-parse', 'HEAD')
    catalog = literal(ROOT / 'src/domain/teacher-case-catalog.ts', 'TEACHER_CASE_CATALOG', '[')
    if not catalog or any(not item.get('id') for item in catalog):
        raise SystemExit('Teacher catalog could not be parsed; do not publish an empty scope.')
    identity_text = (ROOT / 'src/lib/case-identity.ts').read_text(encoding='utf-8')
    identities = dict(re.findall(r'"(teacher-[^"]+)"\s*:\s*"(case-[^"]+)"', identity_text))
    links_text = (ROOT / 'src/domain/teacher-case-links.ts').read_text(encoding='utf-8')
    links = {key: {'sourceId': target, 'relation': relation} for key, target, relation in re.findall(
        r"'([^']+)'\s*:\s*\{\s*sourceId:\s*'([^']+)',\s*relation:\s*'(alias|subtype)'", links_text)}
    public_text = (ROOT / 'src/domain/case-catalog.ts').read_text(encoding='utf-8')
    public_ids = re.findall(r'\bid:\s*[\'\"]((?:case-|peds-)[^\'\"]+)[\'\"]', public_text)
    if len(public_ids) != len(set(public_ids)):
        raise SystemExit('Duplicate public IDs: inspect catalog before publishing an inventory.')
    sources = {item['id']: item for item in catalog if item.get('folder')}
    folders = sorted((item['folder'].rstrip('/') + '/', key) for key, item in sources.items())
    files_by_case = defaultdict(list)
    materials = []
    errors = []
    counts = Counter()
    duplicates = defaultdict(list)
    previous = {}
    ledger = out / 'materials.jsonl'
    if ledger.exists():
        for line in ledger.read_text(encoding='utf-8').splitlines():
            record = json.loads(line)
            previous[record['materialId']] = record

    def register(relative, digest, size, extension, role, source_id=None, parent=None):
        material_id = 'mat-' + sha256(relative.encode('utf-8')).hexdigest()[:20]
        old = previous.get(material_id, {})
        record = dict(old) if old.get('sha256') == digest else {}
        record.update(materialId=material_id, path=relative, sha256=digest, bytes=size,
                      extension=extension, role=role, sourceCaseId=source_id, parentMaterialId=parent)
        record.setdefault('semanticReview', 'not_reviewed')
        record.setdefault('usage', 'unassigned')
        record.setdefault('privacyReview', 'not_reviewed')
        record.setdefault('rightsReview', 'not_reviewed')
        record.setdefault('stage', None)
        record.setdefault('trigger', None)
        materials.append(record)
        counts[role] += 1
        duplicates[digest].append(material_id)
        if source_id:
            files_by_case[source_id].append(record)
        return material_id

    for file in sorted((ROOT / 'knowledge').rglob('*')):
        if not file.is_file():
            continue
        relative = file.relative_to(ROOT).as_posix()
        if file.is_symlink() or ROOT not in file.resolve().parents:
            errors.append({'path': relative, 'error': 'symlink_or_outside_workspace'})
            continue
        source_id = next((key for folder, key in folders if relative.startswith(folder)), None)
        extension = file.suffix.lower()
        if relative.startswith('knowledge/teaching-cases/'):
            role = 'runtime_data'
        elif relative.startswith('knowledge/teaching-media/'):
            role = 'derived_media'
        elif relative.startswith('knowledge/intake/'):
            role = 'intake_material' if extension in MEDIA | DOCUMENTS else 'intake_metadata'
        else:
            role = 'source_material' if extension in MEDIA | DOCUMENTS else 'source_other'
        try:
            digest = sha256()
            with file.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            material_id = register(relative, digest.hexdigest(), file.stat().st_size, extension, role, source_id)
            if len(materials) % 5000 == 0:
                print(json.dumps({'inventoriedFiles': len(materials)}), flush=True)
            if extension in {'.docx', '.pptx', '.xlsx'}:
                with zipfile.ZipFile(file) as archive:
                    for member in sorted(archive.namelist()):
                        if re.match(r'^(word|ppt|xl)/media/', member) and not member.endswith('/'):
                            data = archive.read(member)
                            register(relative + '#' + member, sha256(data).hexdigest(), len(data),
                                     Path(member).suffix.lower(), 'embedded_media', source_id, material_id)
        except (OSError, zipfile.BadZipFile, RuntimeError, KeyError) as error:
            errors.append({'path': relative, 'error': type(error).__name__})

    runtime_dir = ROOT / 'knowledge/teaching-cases'
    runtime = {}
    for file in sorted(runtime_dir.glob('*.json')):
        try:
            record = read_json(file)
            if record.get('caseId') != file.stem:
                errors.append({'path': file.relative_to(ROOT).as_posix(), 'error': 'case_id_filename_mismatch'})
                continue
            runtime[file.stem] = record
        except (OSError, ValueError) as error:
            errors.append({'path': file.relative_to(ROOT).as_posix(), 'error': type(error).__name__})

    old_scope = read_json(out / 'scope.json') if (out / 'scope.json').exists() else {}
    old_cases = {row['caseId']: row for row in old_scope.get('cases', [])}
    versions_path = out / 'content-version-mapping.json'
    versions = read_json(versions_path) if versions_path.exists() else {}
    version_helper = ROOT / 'src/lib/case-data-version.ts'
    version_map_valid = version_helper.exists() and versions.get('versionAlgorithmSha256') == sha256(version_helper.read_bytes()).hexdigest()
    version_map = {row['caseId']: row for row in versions.get('cases', [])} if version_map_valid else {}
    cases = []
    for item in catalog:
        key = item['id']
        source_id = links.get(key, {}).get('sourceId', key)
        record = runtime.get(source_id)
        data = record or {}
        gap = [section for section in SECTIONS if not str(data.get('sections', {}).get(section, '')).strip()]
        docs = data.get('documents', [])
        legacy = sha256('\n'.join(sorted(doc['sha256'] for doc in docs)).encode()).hexdigest()[:16] if record else None
        mapped = files_by_case[source_id]
        row = {
            'publicId': identities.get(key), 'caseId': key, 'sourceCaseId': source_id,
            'category': item['category'], 'relation': links.get(key, {}).get('relation'),
            'publicCatalogMember': identities.get(key) in public_ids,
            'liveVisibility': 'not_checked', 'sourceFolder': sources.get(source_id, {}).get('folder'),
            'sourceFolderExists': bool(source_id in sources and (ROOT / sources[source_id]['folder']).is_dir()),
            'runtimeExists': bool(record), 'legacySourceVersion': legacy,
            'runtimeFileSha256': sha256((runtime_dir / f'{source_id}.json').read_bytes()).hexdigest() if record else None,
            'emptySections': gap, 'sectionCharacters': {section: len(data.get('sections', {}).get(section, '')) for section in SECTIONS},
            'unknownAge': not data.get('age') or bool(re.search('未记录|待核验|未知', data.get('age', ''))),
            'unknownSex': data.get('sex') not in ('男', '女'),
            'sourceMaterials': sum(m['role'] == 'source_material' for m in mapped),
            'embeddedMedia': sum(m['role'] == 'embedded_media' for m in mapped),
            'materialIds': [m['materialId'] for m in mapped],
            'contentReview': 'not_reviewed', 'runtimeVerification': 'not_run',
            'teacherTrial': 'not_published_by_this_review', 'medicalReview': 'not_confirmed',
        }
        old = old_cases.get(key)
        computed = version_map.get(source_id, {})
        if computed.get('runtimeFileSha256') == row['runtimeFileSha256'] and row['runtimeFileSha256']:
            row['contentVersion'] = computed['contentVersion']
            row['contentHash'] = computed['contentHash']
            row['runtimeVersionStatus'] = 'current_content_mapping'
        else:
            row['contentVersion'] = None
            row['runtimeVersionStatus'] = 'not_computed_or_stale_mapping'
        if old:
            row['reviewHistory'] = old.get('reviewHistory', [])
            if old.get('runtimeFileSha256') == row['runtimeFileSha256']:
                for field in ('contentReview', 'medicalReview', 'reviewReport', 'sourceSectionReview'):
                    if field in old:
                        row[field] = old[field]
                if old_scope.get('baseline', {}).get('gitHead') == start_head:
                    for field in ('runtimeVerification', 'teacherTrial', 'runtimeVerificationEvidence', 'runtimeVerificationExcludes'):
                        if field in old:
                            row[field] = old[field]
            else:
                row['reviewHistory'] = row['reviewHistory'] + [{
                    'runtimeFileSha256': old.get('runtimeFileSha256'),
                    'contentReview': old.get('contentReview'), 'reason': 'runtime_content_changed',
                }]
        cases.append(row)
    case_ids = {item['id'] for item in catalog}
    summary = {
        'schemaVersion': 1, 'generatedAt': now, 'gitHead': start_head,
        'branch': git('branch', '--show-current'), 'teacherCatalogEntries': len(cases),
        'staticPublicEntries': len(public_ids), 'independentSources': len(sources),
        'linkedEntries': len(links), 'noIndependentSourceEntries': sum(not row['sourceFolder'] for row in cases),
        'runtimeFiles': len(runtime), 'orphanRuntimeCases': sorted(set(runtime) - case_ids),
        'emptySectionSourceCases': {key: [s for s in SECTIONS if not value.get('sections', {}).get(s, '').strip()]
                                   for key, value in runtime.items() if any(not value.get('sections', {}).get(s, '').strip() for s in SECTIONS)},
        'materialCounts': dict(sorted(counts.items())), 'totalLedgerEntries': len(materials),
        'duplicateByteGroups': sum(len(ids) > 1 for ids in duplicates.values()),
        'unmappedIntakeMaterials': sum(m['role'] == 'intake_material' and m['sourceCaseId'] is None for m in materials),
        'errors': errors,
        'existingReadinessRegister': 'docs/case-readiness-register.json',
        'boundaries': ['structural_inventory_only', 'no_semantic_or_privacy_approval', 'no_database_or_live_visibility_check', 'no_source_mutation',
                       'scope_is_local_inventory_projection_not_replacement_readiness_register'],
    }
    if git('rev-parse', 'HEAD') != start_head:
        raise SystemExit('Git HEAD changed during inventory. No final ledger published; rerun on a stable baseline.')
    temporary = ledger.with_suffix('.jsonl.tmp')
    with temporary.open('w', encoding='utf-8', newline='\n') as stream:
        for record in materials:
            stream.write(json.dumps(record, ensure_ascii=False) + '\n')
    temporary.replace(ledger)
    write_json(out / 'scope.json', {'baseline': summary, 'cases': cases,
                                   'publicFixtures': [key for key in public_ids if key.startswith('peds-')]})
    write_json(out / 'inventory-summary.json', summary)
    lines = ['# 病例库范围与材料盘点', '', f'基线提交：`{summary["gitHead"]}`。时间：{now}。', '',
             f'- 教师目录：{len(cases)} 项；静态公开目录：{len(public_ids)} 项（不等于线上可见数量）。',
             f'- 独立来源：{len(sources)}；关联条目：{len(links)}；无独立来源：{summary["noIndependentSourceEntries"]}。',
             f'- 本地运行文件：{len(runtime)}；材料总账：{len(materials)} 条。',
             f'- 待绑定的新收材料：{summary["unmappedIntakeMaterials"]} 份；读取/归属错误：{len(errors)}。', '',
             '此处只完成结构盘点；材料语义、脱敏、使用条件、展示触发与实际接诊尚待逐项审核。', '',
             '## 材料类型', '', '| 类型 | 数量 |', '|---|---:|']
    lines.extend(f'| {role} | {count} |' for role, count in sorted(counts.items()))
    (out / 'summary.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    # Print counts only; private paths and patient records stay in ignored outputs.
    print(json.dumps({key: summary[key] for key in ('gitHead', 'teacherCatalogEntries', 'staticPublicEntries',
          'independentSources', 'linkedEntries', 'noIndependentSourceEntries', 'runtimeFiles',
          'totalLedgerEntries', 'materialCounts', 'duplicateByteGroups', 'unmappedIntakeMaterials')}, ensure_ascii=False))
    print(json.dumps({'inventoryErrors': len(errors), 'sourceMutation': False}))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
