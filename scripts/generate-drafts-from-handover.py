"""从受控交接的53个完整病例TXT逐例生成未审核草稿（复用既有抽取/脱敏/校验逻辑）。

边界：
- 草稿仅写入 gitignored 的 knowledge/teaching-cases/，不入 git、不入 DB、不发布；
- 只报告缺失字段与证据定位，不从片段补造任何患者事实；
- 3 项无独立来源（新生儿脑梗死/支气管肺炎/格林巴利综合征）不生成草稿；
- 2 个内置演示 fixture 与教师来源分离，不参与统计；
- 原件保持只读，脚本不改 knowledge/受控交接/ 下任何文件。
"""
from pathlib import Path
import json
import re
import hashlib

ROOT = Path(__file__).resolve().parent.parent
HANDOVER = ROOT / 'knowledge' / '受控交接'
OUT = ROOT / 'knowledge' / 'teaching-cases'
MANIFEST = ROOT / 'docs' / 'case-knowledge-map.json'

# 上传附件的命名变体 -> manifest 期望的教学文本名
NAME_FIX = {'肝豆状核变性 (1).txt': '肝豆状核变性.txt'}

# 与 case-draft-import.ts REQUIRED_FIELDS 一致
REQUIRED_FIELDS = ['age', 'sex', 'complaint', 'sections.history', 'sections.exam',
                   'sections.tests', 'sections.diagnosis', 'sections.plan']

# 与 case-draft-import.ts / prepare-teacher-cases.py 一致的身份信息模式（用于脱敏状态提示）
PII_PATTERNS = [
    re.compile(r'(?:姓名|住院号|门诊号|病案号|身份证(?:号)?|联系电话|联系方式|家庭住址|家长姓名)[：:]\s*\S'),
    re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)'),
    re.compile(r'(?<!\d)\d{17}[\dXx](?!\d)'),
]

# 章节标题定位（与 prepare-teacher-cases.py sections() 判定同源，仅用于证据行号）
SECTION_HEADERS = {
    'history': r'(?:现病史|既往史|个人史|家族史|主诉|入院情况|病史特点)',
    'exam': r'(?:入院查体|体格检查|体检|体查|查体|专科检查|PE\s*[:：])',
    'tests': r'(?:辅助检查|辅检|入院(?:前|后)?[^:：]{0,10}(?:辅检|辅助检查|相关检查)|相关检查|实验室检查|检查结果|入院检查)',
    'diagnosis': r'(?:入院诊断|出院诊断|初步诊断|最后诊断|诊断依据|诊断\s*[:：]|诊断\s*$|鉴别诊断)',
    'plan': r'(?:诊疗经过|诊治经过|治疗经过|治疗方案|诊疗计划|治疗\s*[:：]|治疗\s*$|出院医嘱)',
}


# 以下三个函数逐字复用 prepare-teacher-cases.py 的 clean/sections/number 实现（原脚本依赖 docx/pypdf，
# 本场景仅处理 TXT，为避免引入重依赖在此内联，逻辑保持一致）。


def clean(text):
    text = re.sub(r'(?:姓名|住院号|门诊号|病案号|身份证(?:号)?|联系电话|联系方式|电话|家庭住址|地址|籍贯|家长姓名|签名|医师姓名|记录医师)[：:\s]*[^\n，；。|]+', '[身份信息已隐去]', text)
    text = re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)', '[身份信息已隐去]', text)
    return text.strip()


def sections(text):
    result = {key: [] for key in ['history', 'exam', 'tests', 'diagnosis', 'plan']}
    current = 'history'
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        normalized = re.sub(r'^[一二三四五六七八九十\d、.．（）()\s]+', '', line)
        if re.match(r'(?:入院查体|体格检查|体检|体查|查体|专科检查|PE\s*[:：])', normalized, re.I):
            current = 'exam'
        elif re.match(r'(?:辅助检查|辅检|入院(?:前|后)?[^:：]{0,10}(?:辅检|辅助检查|相关检查)|相关检查|实验室检查|检查结果|入院检查)', normalized):
            current = 'tests'
        elif re.match(r'(?:入院诊断|出院诊断|初步诊断|最后诊断|诊断依据|诊断\s*[:：]|诊断\s*$|鉴别诊断)', normalized):
            current = 'diagnosis'
        elif re.match(r'(?:诊疗经过|诊治经过|治疗经过|治疗方案|诊疗计划|治疗\s*[:：]|治疗\s*$|出院医嘱)', normalized):
            current = 'plan'
        elif re.match(r'(?:现病史|既往史|个人史|家族史|主诉|入院情况|病史特点)', normalized):
            current = 'history'
        # A document section labelled e.g. "二、诊断 肾病综合征" is a diagnosis too.
        elif re.match(r'^[一二三四五六七八九十]+[、.．]\s*诊断', line):
            current = 'diagnosis'
        if current == 'history':
            line = re.sub(r'(?:门诊以|门诊拟|考虑诊断为|外院诊断为).*(?:收入院|入院|住院)[。；;]?', '', line)
        result[current].append(line)
    return {key: '\n'.join(value).strip() for key, value in result.items()}


def number(text, pattern):
    match = re.search(pattern, text, re.I)
    return float(match.group(1)) if match else None


def locate_evidence(raw: str) -> dict:
    """记录各章节首次出现的行号（1-based），仅元数据不记正文。"""
    evidence = {}
    lines = raw.splitlines()
    for key, pattern in SECTION_HEADERS.items():
        for index, line in enumerate(lines, start=1):
            normalized = re.sub(r'^[一二三四五六七八九十\d、.．（）()\s]+', '', line.strip())
            if re.match(pattern, normalized, re.I):
                evidence[key] = {'line': index, 'preview': line.strip()[:24]}
                break
    return evidence


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    folder_cases = [c for c in manifest['cases'] if c.get('folder')]

    txt_files = {p.name for p in HANDOVER.glob('*.txt')} - {'病例目录与调用交接.txt'}
    fixed = {NAME_FIX.get(name, name): name for name in txt_files}

    results, unmatched = [], []
    for item in folder_cases:
        expected = Path(item['folder']).name + '.txt'
        actual = fixed.get(expected)
        if not actual:
            unmatched.append(item['caseId'])
            continue
        path = HANDOVER / actual
        raw = path.read_text(encoding='utf-8', errors='replace')
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        cleaned = clean(raw)
        facts = sections(cleaned)

        history_head = facts['history'][:500]
        age = re.search(r'(\d+(?:\.\d+)?\s*(?:岁(?:\s*\d+\s*(?:个)?月)?(?:\s*\d+\s*天)?|个?月(?:\s*\d+\s*天)?|天|小时|分钟))', history_head)
        sex = re.search(r'(?:性别\s*[:：]?\s*|患儿[，,\s]*)(男|女)', history_head)
        chief = re.search(r'(?:主诉\s*[:：]|^\s*2[.．、])\s*([^\n]+)', facts['history'], re.M)
        complaint = re.sub(r'^主诉\s*[:：]\s*', '', chief.group(1)).strip('；;。') if chief else None
        exam = facts['exam']
        record = {
            'caseId': item['caseId'],
            'sourceName': item.get('caseName') or item['caseId'],
            'sourceFile': actual,
            'sourceBytes': path.stat().st_size,
            'sourceSha256': sha,
            'draftVersion': 'handover-v1',
            'reviewStatus': 'unreviewed',
            'aliasSourceId': None,
            'aliasRelation': None,
            'age': age.group(1).replace(' ', '') if age else None,
            'sex': sex.group(1) if sex else None,
            'complaint': complaint,
            'sections': facts,
            'vitals': {
                'temperature': number(exam, r'(?:\bT|体温)\s*[:：]?\s*(\d{2}(?:\.\d+)?)\s*(?:℃|°?C)'),
                'heartRate': number(exam, r'(?:\bP|\bHR|心率|脉搏)\s*[:：]?\s*(\d{2,3})'),
                'respiratoryRate': number(exam, r'(?:\bR|\bRR|呼吸频率|呼吸)\s*[:：]?\s*(\d{1,3})\s*(?:次|/|bpm)'),
                'spo2': number(exam, r'(?:SpO[₂2]|血氧饱和度|氧饱和度)\s*[:：]?\s*(\d{2,3})\s*%'),
            },
            'evidence': locate_evidence(raw),
            'piiFlags': [i + 1 for i, p in enumerate(PII_PATTERNS) if p.search(raw)],
        }
        provided = {
            'age': bool(record['age']), 'sex': bool(record['sex']), 'complaint': bool(record['complaint']),
            'sections.history': bool(facts['history']), 'sections.exam': bool(facts['exam']),
            'sections.tests': bool(facts['tests']), 'sections.diagnosis': bool(facts['diagnosis']),
            'sections.plan': bool(facts['plan']),
        }
        record['missingFields'] = [f for f in REQUIRED_FIELDS if not provided[f]]
        record['providedCount'] = sum(provided.values())
        (OUT / f"{item['caseId']}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        # 脱敏摘要（进 git 的矩阵只用这些字段，绝不写正文）
        results.append({
            'caseId': item['caseId'], 'caseName': item.get('caseName') or item['caseId'], 'status': item['status'],
            'sourceFile': actual, 'bytes': record['sourceBytes'], 'sha16': sha[:16],
            'missingFields': record['missingFields'], 'provided': record['providedCount'],
            'piiFlagged': bool(record['piiFlags']), 'aliasSourceId': None,
        })

    summary = {
        'handoverTxt': len(txt_files),
        'manifestFolderCases': len(folder_cases),
        'draftsWritten': len(results),
        'unmatched': unmatched,
        'allFieldsComplete': sum(1 for r in results if not r['missingFields']),
        'piiFlaggedCount': sum(1 for r in results if r['piiFlagged']),
        'missingFieldHistogram': {},
        'output': 'knowledge/teaching-cases',
    }
    for r in results:
        for f in r['missingFields']:
            key = f.split('.')[-1]
            summary['missingFieldHistogram'][key] = summary['missingFieldHistogram'].get(key, 0) + 1

    Path('docs/case-draft-matrix.json').write_text(json.dumps(
        {'summary': summary, 'cases': results}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
