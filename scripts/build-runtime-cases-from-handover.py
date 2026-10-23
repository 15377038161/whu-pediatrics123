"""53受控交接来源 -> 运行时教学事实（knowledge/teaching-cases/{id}.json，recordSchema 兼容格式）。

用户已确认：53 份来源为老师提供的已审核教学材料（人工确认，见 reviewEvidence）。
边界：
- 仅处理 knowledge/受控交接/ 下 53 个 TXT（2 演示 fixture、3 无独立来源项不涉及）；
- 事实全部来自原件 TXT 程序化抽取（复用 generate-drafts-from-handover.py 的 clean/sections/number），
  不从召回片段/模型补造任何患者事实；
- documents 携带原件证据（脱敏后全文 + sha256 + 行号证据定位），与 recordSchema 一致；
- 缺失字段保持 unknown 语义（如 teacher-肝豆状核变性 sex=null 不推断）；
- 14 别名由 TEACHER_CASE_LINKS 显式映射到 53 canonical 来源，不做额外归并；
- 输出目录 gitignored，不入 git、不入 DB、不发布。
"""
from pathlib import Path
import json
import re
import hashlib
from case_source_sections import split_case_sections

ROOT = Path(__file__).resolve().parent.parent
HANDOVER = ROOT / 'knowledge' / '受控交接'
DRAFTS = ROOT / 'knowledge' / 'teaching-cases'
LINKS_TS = ROOT / 'src' / 'domain' / 'teacher-case-links.ts'
CATALOG_TS = ROOT / 'src' / 'domain' / 'teacher-case-catalog.ts'

# 上传附件命名变体 -> catalog id 期望的归一名（空格/全角括号/大小写差异）
NAME_FIX = {
    '肝豆状核变性 (1).txt': '肝豆状核变性.txt',
    '儿童 肥胖症.txt': '儿童-肥胖症.txt',
    '婴儿胆汁淤积症（巨细胞病毒感染）.txt': '婴儿胆汁淤积症-巨细胞病毒感染.txt',
    '心律失常 室上性心动过速.txt': '心律失常-室上性心动过速.txt',
    '新生儿ABO溶血性黄疸.txt': '新生儿abo溶血性黄疸.txt',
    '新生儿RH溶血性黄疸.txt': '新生儿rh溶血性黄疸.txt',
    '糖原贮积病IV型.txt': '糖原贮积病iv型.txt',
}

SECTION_HEADERS = {
    'history': r'(?:现病史|既往史|个人史|家族史|主诉|入院情况|病史特点)',
    'exam': r'(?:入院查体|体格检查|体检|体查|查体|专科检查|PE\s*[:：])',
    'tests': r'(?:辅助检查|辅检|入院(?:前|后)?[^:：]{0,10}(?:辅检|辅助检查|相关检查)|相关检查|实验室检查|检查结果|入院检查)',
    'diagnosis': r'(?:入院诊断|出院诊断|初步诊断|最后诊断|诊断依据|诊断\s*[:：]|诊断\s*$|鉴别诊断)',
    'plan': r'(?:诊疗经过|诊治经过|治疗经过|治疗方案|诊疗计划|治疗\s*[:：]|治疗\s*$|出院医嘱)',
}


def clean(text):
    text = re.sub(r'(?:姓名|住院号|门诊号|病案号|身份证(?:号)?|联系电话|联系方式|电话|家庭住址|地址|籍贯|家长姓名|签名|医师姓名|记录医师)[：:\s]*[^\n，；。|]+', '[身份信息已隐去]', text)
    text = re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)', '[身份信息已隐去]', text)
    return text.strip()


def sections(text):
    return split_case_sections(text)


def number(text, pattern):
    match = re.search(pattern, text, re.I)
    return float(match.group(1)) if match else None


def find_line(lines, pattern):
    for index, line in enumerate(lines, start=1):
        if re.search(pattern, line):
            return index
    return None


def read_links():
    source = LINKS_TS.read_text(encoding='utf-8')
    return {key: value for key, value in re.findall(r"'([^']+)': \{ sourceId: '([^']+)'", source)}


def read_catalog_folders():
    source = CATALOG_TS.read_text(encoding='utf-8')
    start = source.index('= [') + 2
    catalog = json.loads(source[start:source.rindex(']') + 1])
    return {item['id']: item for item in catalog if item.get('folder')}


def main():
    links = read_links()
    catalog = read_catalog_folders()
    manifest_files = sorted(p.name for p in HANDOVER.glob('*.txt'))
    records = {}
    stats = {'cases': 0, 'missingFields': {}, 'evidenceAll': 0, 'vitalsExtracted': 0}
    for name in manifest_files:
        canonical = NAME_FIX.get(name, name)
        case_id = f"teacher-{canonical[:-4]}"
        if case_id not in catalog:
            continue
        raw = (HANDOVER / name).read_bytes()
        text = clean(raw.decode('utf-8'))
        lines = [clean(line) for line in raw.decode('utf-8').splitlines()]
        facts = sections(text)
        history_head = facts['history'][:500]
        age = re.search(r'(\d+(?:\.\d+)?\s*(?:岁(?:\s*\d+\s*(?:个)?月)?(?:\s*\d+\s*天)?|个?月(?:\s*\d+\s*天)?|天|小时|分钟))', history_head)
        sex = re.search(r'(?:性别\s*[:：]?\s*|患儿[，,\s]*)(男|女)', history_head)
        chief = re.search(r'(?:主诉\s*[:：]|^\s*2[.．、])\s*([^\n]+)', facts['history'], re.M)
        complaint = re.sub(r'^主诉\s*[:：]\s*', '', chief.group(1)).strip('；;。') if chief else '请向家长了解本次就诊的主要不适。'
        vitals = {'temperature': number(facts['exam'], r'(?:\bT|体温)\s*[:：]?\s*(\d{2}(?:\.\d+)?)\s*(?:℃|°?C)'),
                  'heartRate': number(facts['exam'], r'(?:\bP|(?:\bHR)|心率|脉搏)\s*[:：]?\s*(\d{2,3})'),
                  'respiratoryRate': number(facts['exam'], r'(?:\bR|(?:\bRR)|呼吸频率|呼吸)\s*[:：]?\s*(\d{1,3})\s*(?:次|/|bpm)'),
                  'spo2': number(facts['exam'], r'(?:SpO[₂2]|血氧饱和度|氧饱和度)\s*[:：]?\s*(\d{2,3})\s*%')}
        evidence = {key: find_line(lines, pattern) for key, pattern in SECTION_HEADERS.items()}
        missing = [field for field, value in [('sex', sex), ('age', age), ('complaint', chief)] if not value]
        missing += [f'sections.{key}' for key, value in facts.items() if not value]
        record = {
            'caseId': case_id,
            'sourceName': catalog[case_id]['name'],
            'sourceDocument': canonical,
            'age': age.group(1).replace(' ', '') if age else '年龄未记录',
            'sex': (sex.group(1) if sex else '性别未记录'),
            'complaint': complaint,
            'sections': facts,
            'vitals': vitals,
            'documents': [{
                'source': canonical,
                'text': text,
                'sha256': hashlib.sha256(raw).hexdigest(),
            }],
            'sourceEvidence': {
                'file': name,
                'bytes': len(raw),
                'sectionLine': evidence,
                'reviewEvidence': 'user-confirmed-teacher-reviewed',
                'handoverVersion': 'handover-v1',
            },
            'missingFields': missing,
        }
        records[case_id] = record
        stats['cases'] += 1
        if missing:
            stats['missingFields'][case_id] = missing
        if all(evidence.values()):
            stats['evidenceAll'] += 1
        if any(vitals.values()):
            stats['vitalsExtracted'] += 1
    DRAFTS.mkdir(parents=True, exist_ok=True)
    for case_id, record in records.items():
        (DRAFTS / f"{case_id}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    alias_check = {alias: target for alias, target in links.items() if target in records}
    print(json.dumps({'casesWritten': stats['cases'], 'missingFields': stats['missingFields'],
                      'evidenceAllSections': stats['evidenceAll'], 'vitalsExtracted': stats['vitalsExtracted'],
                      'aliasTargetsCovered': len(alias_check), 'aliasTotal': len(links),
                      'output': str(DRAFTS)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
