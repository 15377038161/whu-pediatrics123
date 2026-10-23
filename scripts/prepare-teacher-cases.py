"""Build source-backed teaching cases; keep all original files untouched."""
from pathlib import Path
import json
import re
import importlib.util
from case_source_sections import split_case_sections

spec = importlib.util.spec_from_file_location('case_extractor', Path(__file__).with_name('extract-case-drafts.py'))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)
OUTPUT = Path('knowledge/teaching-cases')
LINKS = Path('src/domain/teacher-case-links.ts')


def clean(text):
    text = re.sub(r'(?:姓名|住院号|门诊号|病案号|身份证(?:号)?|联系电话|联系方式|电话|家庭住址|地址|籍贯|家长姓名|签名|医师姓名|记录医师)[：:\s]*[^\n，；。|]+', '[身份信息已隐去]', text)
    text = re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)', '[身份信息已隐去]', text)
    return text.strip()


def sections(text):
    result = split_case_sections(text)
    # Preserve the existing history projection; section classification is shared.
    result['history'] = re.sub(r'(?:门诊以|门诊拟|考虑诊断为|外院诊断为).*(?:收入院|入院|住院)[。；;]?', '', result['history']).strip()
    return result


def number(text, pattern):
    match = re.search(pattern, text, re.I)
    return float(match.group(1)) if match else None


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    catalog = extractor.read_catalog()
    links = {key: source for key, source in re.findall(r"'([^']+)': \{ sourceId: '([^']+)'", LINKS.read_text(encoding='utf-8'))}
    count = 0
    for item in catalog:
        if not item['folder']:
            continue
        draft = json.loads((extractor.OUTPUT / f"{item['id']}.json").read_text(encoding='utf-8'))
        documents = [doc for doc in draft['documents'] if doc.get('text')]
        candidates = [doc for doc in documents if Path(doc['source']).suffix.lower() in {'.doc', '.docx'}]
        candidates.sort(key=lambda doc: (len(Path(doc['source']).parts), -len(doc['text'])))
        primary = candidates[0] if candidates else (documents[0] if documents else None)
        text = clean(primary['text']) if primary else ''
        facts = sections(text)
        age = re.search(r'(\d+(?:\.\d+)?\s*(?:岁(?:\s*\d+\s*(?:个)?月)?(?:\s*\d+\s*天)?|个?月(?:\s*\d+\s*天)?|天|小时|分钟))', facts['history'][:500])
        sex = re.search(r'(?:性别\s*[:：]?\s*|患儿[，,\s]*)(男|女)', facts['history'][:500])
        chief = re.search(r'(?:主诉\s*[:：]|^\s*2[.．、])\s*([^\n]+)', facts['history'], re.M)
        complaint = re.sub(r'^主诉\s*[:：]\s*', '', chief.group(1)).strip('；;。') if chief else '请向家长了解本次就诊的主要不适。'
        exam = facts['exam']
        record = {
            'caseId': item['id'], 'sourceName': item['name'], 'sourceDocument': '病例正文' if primary else '',
            'age': age.group(1).replace(' ', '') if age else '年龄未记录', 'sex': sex.group(1) if sex else '性别未记录',
            'complaint': complaint, 'sections': facts,
            'vitals': {'temperature': number(exam, r'(?:\bT|体温)\s*[:：]?\s*(\d{2}(?:\.\d+)?)\s*(?:℃|°?C)'),
                       'heartRate': number(exam, r'(?:\bP|\bHR|心率|脉搏)\s*[:：]?\s*(\d{2,3})'),
                       'respiratoryRate': number(exam, r'(?:\bR|\bRR|呼吸频率|呼吸)\s*[:：]?\s*(\d{1,3})\s*(?:次|/|bpm)'),
                       'spo2': number(exam, r'(?:SpO[₂2]|血氧饱和度|氧饱和度)\s*[:：]?\s*(\d{2,3})\s*%')},
            'documents': [{'source': Path(doc['source']).relative_to(Path(item['folder'])).as_posix(), 'text': clean(doc['text']), 'sha256': doc['sha256']} for doc in documents],
        }
        (OUTPUT / f"{item['id']}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        count += 1
    print(json.dumps({'sourceCases': count, 'linkedCatalogEntries': len(links), 'catalogEntries': len(catalog), 'output': str(OUTPUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
