"""Source section boundaries shared by both case import scripts.

An admission-test narrative inside a treatment course is not a new test heading.
No medical facts are generated or changed here.
"""
import re


def split_case_sections(text):
    result = {key: [] for key in ('history', 'exam', 'tests', 'diagnosis', 'plan')}
    current = 'history'
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        normalized = re.sub(r'^[一二三四五六七八九十\d、.．（）()\s]+', '', line)
        if re.match(r'(?:入院查体|体格检查|体检|体查|查体|专科检查|PE\s*[:：])', normalized, re.I):
            current = 'exam'
        elif re.match(r'(?:辅助检查|辅检|相关检查|实验室检查|检查结果|入院检查)\s*(?:[:：]|$)', normalized):
            current = 'tests'
        elif current != 'plan' and re.match(
            r'(?:辅助检查|辅检|入院(?:前|后)?[^:：]{0,10}(?:辅检|辅助检查|相关检查)|相关检查|实验室检查|检查结果|入院检查)', normalized
        ):
            current = 'tests'
        elif re.match(r'(?:入院诊断|出院诊断|初步诊断|最后诊断|诊断依据|诊断\s*[:：]|诊断\s*$|鉴别诊断)', normalized):
            current = 'diagnosis'
        elif re.match(r'(?:诊疗经过|诊治经过|治疗经过|治疗方案|诊疗计划|治疗\s*[:：]|治疗\s*$|出院医嘱)', normalized):
            current = 'plan'
        elif re.match(r'(?:现病史|既往史|个人史|家族史|主诉|入院情况|病史特点)', normalized):
            current = 'history'
        elif re.match(r'^[一二三四五六七八九十]+[、.．]\s*诊断', line):
            current = 'diagnosis'
        result[current].append(line)
    return {key: '\n'.join(lines).strip() for key, lines in result.items()}
