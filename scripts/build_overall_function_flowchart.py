from pathlib import Path
from html import escape


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "实施方案" / "assets"
OUT.mkdir(parents=True, exist_ok=True)
SVG_OUT = OUT / "整体功能流程图.svg"
HTML_OUT = OUT / "整体功能流程图_预览.html"

W, H = 2400, 6740
parts = []
routes = []


def add(value):
    parts.append(value)


def wrap(text, limit=16):
    lines, line = [], ""
    for char in text:
        if char == "\n":
            lines.append(line)
            line = ""
        elif len(line) >= limit:
            lines.append(line)
            line = char
        else:
            line += char
    if line or not lines:
        lines.append(line)
    return lines


def text(cx, cy, value, size=27, weight=500, color="#202124", limit=16, gap=36):
    lines = wrap(value, limit)
    start_y = cy - (len(lines) - 1) * gap / 2
    add(f'<text x="{cx}" y="{start_y}" text-anchor="middle" dominant-baseline="middle" font-size="{size}" font-weight="{weight}" fill="{color}">')
    for index, line in enumerate(lines):
        add(f'<tspan x="{cx}" y="{start_y + index * gap}">{escape(line)}</tspan>')
    add('</text>')


def rect(cx, cy, width, height, value, kind="student", limit=16):
    add(f'<rect x="{cx-width/2}" y="{cy-height/2}" width="{width}" height="{height}" rx="3" class="node {kind}"/>')
    text(cx, cy, value, limit=limit)


def ellipse(cx, cy, width, height, value):
    add(f'<ellipse cx="{cx}" cy="{cy}" rx="{width/2}" ry="{height/2}" class="node terminal"/>')
    text(cx, cy, value, color="#202124", limit=18)


def diamond(cx, cy, width, height, value, limit=14):
    points = f"{cx},{cy-height/2} {cx+width/2},{cy} {cx},{cy+height/2} {cx-width/2},{cy}"
    add(f'<polygon points="{points}" class="node decision"/>')
    text(cx, cy, value, size=25, limit=limit, gap=33)


def document(cx, cy, width, height, value, limit=16):
    x, y = cx - width / 2, cy - height / 2
    path_data = (
        f"M{x},{y} H{x+width} V{y+height-22} "
        f"C{x+width*0.76},{y+height+7} {x+width*0.56},{y+height-40} {x+width*0.33},{y+height-15} "
        f"C{x+width*0.18},{y+height+2} {x+width*0.07},{y+height-5} {x},{y+height-18} Z"
    )
    add(f'<path d="{path_data}" class="node output"/>')
    text(cx, cy - 5, value, limit=limit)


def cylinder(cx, cy, width, height, value, limit=16):
    x, y = cx - width / 2, cy - height / 2
    add(f'<path d="M{x},{y+18} C{x},{y-6} {x+width},{y-6} {x+width},{y+18} V{y+height-18} C{x+width},{y+height+8} {x},{y+height+8} {x},{y+height-18} Z" class="node store"/>')
    add(f'<ellipse cx="{cx}" cy="{y+18}" rx="{width/2}" ry="18" class="store-top"/>')
    text(cx, cy + 5, value, limit=limit)


def flow(points):
    routes.append(tuple(points))
    d = "M" + " L".join(f"{x},{y}" for x, y in points)
    add(f'<path d="{d}" class="flow" marker-end="url(#arrow)"/>')


def branch_label(cx, cy, value):
    width = max(58, len(value) * 25 + 26)
    add(f'<rect x="{cx-width/2}" y="{cy-19}" width="{width}" height="38" rx="11" class="edge-label"/>')
    text(cx, cy + 1, value, size=21, weight=500, color="#333333", limit=12, gap=26)


def validate_graph():
    graph = {
        "preset_start": ["configure"], "configure": ["medical_review"],
        "medical_review": ["configure", "publish"], "publish": ["version_store"],
        "version_store": ["session"],
        "student_start": ["login"], "login": ["preset_list"], "preset_list": ["select_test"],
        "select_test": ["start_test"], "start_test": ["session"], "session": ["question"],
        "question": ["intent"], "intent": ["capability"],
        "capability": ["parent_proxy", "speaker_order"], "parent_proxy": ["behavior_check"],
        "speaker_order": ["behavior_check"], "behavior_check": ["normal_reply", "abnormal_reply"],
        "normal_reply": ["reply_list"], "abnormal_reply": ["reply_list"],
        "reply_list": ["intervene"], "intervene": ["turn_record", "send_intervention"],
        "send_intervention": ["validate_intervention"], "validate_intervention": ["turn_record"],
        "turn_record": ["history_done"], "history_done": ["question", "exam_action"],
        "exam_action": ["exam_validate"], "exam_validate": ["exam_process"],
        "exam_process": ["exam_validate", "exam_result"], "exam_result": ["aux_action"],
        "aux_action": ["aux_validate"], "aux_validate": ["aux_process"],
        "aux_process": ["aux_validate", "aux_result"], "aux_result": ["diagnosis"],
        "diagnosis": ["evidence_check"], "evidence_check": ["evidence_ok", "evidence_gap"],
        "evidence_ok": ["treatment"], "evidence_gap": ["treatment"],
        "treatment": ["safety_check"], "safety_check": ["safety_process"],
        "safety_process": ["safety_check", "treatment_result"], "treatment_result": ["communication"],
        "communication": ["communication_check"], "communication_check": ["communication_process"],
        "communication_process": ["communication_check", "lock_session"],
        "lock_session": ["report"], "report": ["weakness"],
        "weakness": ["practice", "profile"], "practice": ["profile"], "profile": ["student_end"],
        "student_end": [],
        "teacher_start": ["teacher_login"], "teacher_login": ["student_list"],
        "student_list": ["select_student"], "select_student": ["test_list"],
        "test_list": ["readonly_boundary"], "readonly_boundary": ["select_report"],
        "select_report": ["report_detail"],
        "report_detail": ["answer_record"], "answer_record": ["event_replay"],
        "event_replay": ["teacher_end"], "teacher_end": [],
    }
    terminals = {"student_end", "teacher_end"}
    starts = ["preset_start", "student_start", "teacher_start"]
    reachable, stack = set(), list(starts)
    while stack:
        node = stack.pop()
        if node in reachable:
            continue
        reachable.add(node)
        stack.extend(graph[node])
    assert reachable == set(graph), f"不可达节点: {set(graph)-reachable}"
    for node, targets in graph.items():
        assert node in terminals or targets, f"非终点缺少出口: {node}"
    reverse = {node: [] for node in graph}
    for source, targets in graph.items():
        for target in targets:
            reverse[target].append(source)
    can_finish, stack = set(terminals), list(terminals)
    while stack:
        node = stack.pop()
        for previous in reverse[node]:
            if previous not in can_finish:
                can_finish.add(previous)
                stack.append(previous)
    # Preconfiguration terminates by enabling the student session, so it reaches student_end.
    assert can_finish == set(graph), f"无法到达终点: {set(graph)-can_finish}"
    return len(graph)


def interior_crossings():
    segments = []
    for route_id, route in enumerate(routes):
        for first, second in zip(route, route[1:]):
            segments.append((route_id, first, second))
    found = []
    for index, (route_a, a1, a2) in enumerate(segments):
        for route_b, b1, b2 in segments[index + 1:]:
            if route_a == route_b:
                continue
            a_horizontal = a1[1] == a2[1]
            b_horizontal = b1[1] == b2[1]
            if a_horizontal == b_horizontal:
                continue
            h1, h2, v1, v2 = (a1, a2, b1, b2) if a_horizontal else (b1, b2, a1, a2)
            ix, iy = v1[0], h1[1]
            if min(h1[0], h2[0]) < ix < max(h1[0], h2[0]) and min(v1[1], v2[1]) < iy < max(v1[1], v2[1]):
                found.append((route_a, route_b, (ix, iy)))
    return found


add(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">
<title id="title">珞珈儿科智训完整功能流程图</title>
<desc id="desc">教师只读学情、学生医生操作、系统预置任务以及动态患儿家长答题的完整功能流程。</desc>
<defs>
  <marker id="arrow" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="9" markerHeight="9" orient="auto">
    <path d="M1,1 L11,6 L1,11 Z" fill="#747474"/>
  </marker>
  <style>
    text {{ font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif; }}
    .lane {{ stroke:#e4e4e4; stroke-width:1.5; }}
    .node {{ stroke-width:1.8; }}
    .student, .agent, .teacher {{ fill:#ffffff; stroke:#d0d0d0; }}
    .terminal {{ fill:#ffffff; stroke:#bdbdbd; }}
    .decision {{ fill:#ffffff; stroke:#c9c9c9; }}
    .output {{ fill:#ffffff; stroke:#c7c7c7; }}
    .store {{ fill:#ffffff; stroke:#c7c7c7; stroke-width:1.8; }}
    .store-top {{ fill:#fafafa; stroke:#c7c7c7; stroke-width:1.8; }}
    .flow {{ fill:none; stroke:#747474; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }}
    .edge-label {{ fill:#f7f7f7; stroke:none; }}
  </style>
</defs>
<rect width="{W}" height="{H}" fill="#f7f7f7"/>
<line x1="775" y1="250" x2="775" y2="6490" stroke="#e2e2e2" stroke-width="1.5"/>
<line x1="1825" y1="250" x2="1825" y2="6490" stroke="#e2e2e2" stroke-width="1.5"/>
''')

text(1200, 70, "珞珈儿科智训｜完整功能流程图", size=44, weight=500, color="#202124", limit=30, gap=46)
text(1200, 128, "教师只读学情 · 任务预置上线 · 动态患儿/家长答题 · 医生干预 · 证据化评价", size=24, weight=400, color="#666666", limit=52)

for center, title, fill, border in [
    (400, "学生医生端", "#ffffff", "#c9c9c9"),
    (1300, "主智能体与系统预置服务", "#ffffff", "#c9c9c9"),
    (2100, "教师只读学情端", "#ffffff", "#c9c9c9"),
]:
    add(f'<rect x="{center-250}" y="270" width="500" height="70" rx="3" fill="{fill}" stroke="{border}" stroke-width="1.5"/>')
    text(center, 305, title, size=27, weight=500, color="#202124", limit=22)

# Top-level connectors: system preset, student entry, and teacher read-only entry.
flow([(1300, 460), (1300, 500)])
flow([(1300, 610), (1300, 645)])
flow([(1300, 815), (1300, 850)])
flow([(1040, 730), (930, 730), (930, 900), (1010, 900)])
branch_label(960, 700, "否")
flow([(1580, 900), (1765, 900), (1765, 555), (1610, 555)])
flow([(1300, 950), (1300, 985)])
branch_label(1380, 965, "是")
flow([(1300, 1105), (1300, 1150)])

flow([(400, 460), (400, 500)])
flow([(400, 610), (400, 650)])
flow([(400, 750), (400, 790)])
flow([(400, 890), (400, 930)])
flow([(650, 985), (760, 985), (760, 1380), (990, 1380)])

flow([(2100, 460), (2100, 500)])
flow([(2100, 610), (2100, 650)])
flow([(2100, 750), (2100, 790)])
flow([(2100, 890), (2100, 930)])
flow([(2100, 1030), (2100, 1110)])
flow([(2100, 1210), (2100, 5735)])

# Unified session and dynamic interview.
flow([(1300, 1275), (1300, 1325)])
flow([(650, 1540), (990, 1540)])
flow([(1300, 1435), (1300, 1485)])
flow([(1040, 1720), (990, 1720), (990, 1880), (1090, 1880)])
branch_label(1000, 1690, "否")
flow([(1560, 1720), (1610, 1720), (1610, 1880), (1510, 1880)])
branch_label(1600, 1690, "是")
flow([(1090, 1935), (1090, 1975), (1300, 1975)])
flow([(1510, 1935), (1510, 1975), (1300, 1975)])
flow([(1040, 2060), (1010, 2060), (1010, 2230), (1090, 2230)])
branch_label(1010, 2030, "否")
flow([(1560, 2060), (1590, 2060), (1590, 2230), (1510, 2230)])
branch_label(1590, 2030, "是")
flow([(1090, 2285), (1090, 2330), (1300, 2330)])
flow([(1510, 2285), (1510, 2330), (1300, 2330)])
flow([(1300, 2330), (1300, 2340)])
flow([(1300, 2460), (1300, 2580), (610, 2580)])
flow([(190, 2580), (100, 2580), (100, 2920), (990, 2920)])
branch_label(135, 2550, "否")
flow([(400, 2665), (400, 2705)])
branch_label(480, 2685, "是")
flow([(650, 2760), (990, 2760)])
flow([(1300, 2815), (1300, 2865)])
flow([(1300, 2975), (1300, 3015)])
flow([(1040, 3100), (75, 3100), (75, 1540), (150, 1540)])
branch_label(720, 3068, "否：继续问诊")
flow([(1300, 3185), (1300, 3235)])
branch_label(1380, 3208, "是")

# Examination.
flow([(650, 3290), (990, 3290)])
flow([(1300, 3345), (1300, 3375)])
flow([(1560, 3460), (1610, 3460), (1610, 3550), (1510, 3550)])
branch_label(1605, 3430, "否")
flow([(1510, 3605), (1765, 3605), (1765, 3290), (1610, 3290)])
flow([(1300, 3545), (1300, 3580)])
branch_label(1380, 3560, "是")
flow([(1300, 3700), (1300, 3775)])

# Auxiliary tests.
flow([(650, 3830), (990, 3830)])
flow([(1300, 3885), (1300, 3915)])
flow([(1560, 4000), (1610, 4000), (1610, 4090), (1510, 4090)])
branch_label(1605, 3970, "否")
flow([(1510, 4145), (1765, 4145), (1765, 3830), (1610, 3830)])
flow([(1300, 4085), (1300, 4120)])
branch_label(1380, 4100, "是")
flow([(1300, 4240), (1300, 4315)])

# Diagnosis and evidence.
flow([(650, 4370), (990, 4370)])
flow([(1300, 4425), (1300, 4455)])
flow([(1040, 4540), (1010, 4540), (1010, 4710), (1090, 4710)])
branch_label(1010, 4510, "否")
flow([(1560, 4540), (1590, 4540), (1590, 4710), (1510, 4710)])
branch_label(1590, 4510, "是")
flow([(1090, 4765), (1090, 4805), (1300, 4805)])
flow([(1510, 4765), (1510, 4805), (1300, 4805)])
flow([(1300, 4805), (1300, 4845)])

# Treatment safety.
flow([(650, 4900), (990, 4900)])
flow([(1300, 4955), (1300, 4985)])
flow([(1560, 5070), (1610, 5070), (1610, 5160), (1510, 5160)])
branch_label(1605, 5040, "是：拦截")
flow([(1510, 5215), (1765, 5215), (1765, 4900), (1610, 4900)])
flow([(1300, 5155), (1300, 5190)])
branch_label(1380, 5170, "否")
flow([(1300, 5310), (1300, 5385)])

# Communication, report, weakness, and teacher read-only views.
flow([(650, 5440), (990, 5440)])
flow([(1300, 5495), (1300, 5525)])
flow([(1560, 5610), (1610, 5610), (1610, 5700), (1510, 5700)])
branch_label(1605, 5580, "否")
flow([(1510, 5755), (1765, 5755), (1765, 5440), (1610, 5440)])
flow([(1300, 5695), (1300, 5735)])
branch_label(1380, 5710, "是")
flow([(1300, 5845), (1300, 5885)])
flow([(1600, 5950), (1885, 5950)])
flow([(1300, 6015), (1300, 6045)])
flow([(1040, 6130), (650, 6130)])
branch_label(820, 6100, "是")
flow([(400, 6185), (400, 6300), (990, 6300)])
flow([(1300, 6215), (1300, 6245)])
branch_label(1380, 6225, "否")
flow([(1300, 6355), (1300, 6415)])
flow([(990, 6460), (650, 6460)])

flow([(2100, 5845), (2100, 5885)])
flow([(2100, 6015), (2100, 6055)])
flow([(2100, 6165), (2100, 6205)])
flow([(2100, 6315), (2100, 6385)])

# Student nodes.
ellipse(400, 415, 360, 90, "学生医生开始")
rect(400, 555, 500, 110, "登录并进入训练系统", "student")
rect(400, 700, 500, 100, "查看系统预置测试", "student")
rect(400, 840, 500, 100, "选择病例与训练模式", "student")
rect(400, 985, 500, 110, "开始测试", "student")
rect(400, 1540, 500, 110, "以医生身份输入问诊问题", "student")
diamond(400, 2580, 420, 170, "是否需要对答题过程进行干预？", 13)
rect(400, 2760, 500, 110, "发送引导指令或情绪安抚内容", "student", 15)
rect(400, 3290, 500, 110, "选择部位、器材并执行查体", "student", 15)
rect(400, 3830, 500, 110, "选择辅助检查并说明理由", "student", 15)
rect(400, 4370, 500, 110, "提交诊断、鉴别诊断与依据", "student", 15)
rect(400, 4900, 500, 110, "提交处置与安全计划", "student")
rect(400, 5440, 500, 110, "与患儿或家长完成沟通", "student")
rect(400, 6130, 500, 110, "进入对应专项补练", "student")
ellipse(400, 6460, 360, 90, "本轮学习结束")

# Agent and preset nodes.
ellipse(1300, 415, 500, 90, "系统预置端开始")
rect(1300, 555, 620, 110, "预置病例、任务、模式、量表与异常行为", "agent", 17)
diamond(1300, 730, 520, 170, "医学内容和系统配置审核通过？", 14)
rect(1300, 900, 580, 100, "退回系统配置人员修订", "teacher")
document(1300, 1045, 600, 120, "发布不可变任务版本", 16)
cylinder(1300, 1220, 620, 110, "读取病例、知识、量表与任务版本", 17)
rect(1300, 1380, 620, 110, "创建唯一病例会话并锁定版本", "agent", 17)
rect(1300, 1540, 620, 110, "识别问题意图与当前上下文", "agent", 17)
diamond(1300, 1720, 520, 170, "患儿是否具备回答能力？", 14)
rect(1090, 1880, 360, 110, "家长代答", "agent")
rect(1510, 1880, 360, 110, "动态排序患儿回答、家长补充或插话", "agent", 14)
diamond(1300, 2060, 520, 170, "是否触发异常答题状态？", 14)
rect(1090, 2230, 360, 110, "生成正常年龄化回答", "agent", 14)
rect(1510, 2230, 360, 110, "应用答非所问、隐瞒、冗余、拒绝或负面情绪", "teacher", 14)
document(1300, 2400, 620, 120, "按顺序输出患儿/家长一条或多条回复", 17)
rect(1300, 2760, 620, 110, "校验干预是否适龄、适用且表达恰当", "agent", 17)
rect(1300, 2920, 620, 110, "更新回答优先级、插话概率、情绪与配合度并记录证据", "agent", 18)
diamond(1300, 3100, 520, 170, "问诊阶段是否完成？", 14)

rect(1300, 3290, 620, 110, "校验器材、部位、准备和操作顺序", "agent", 17)
diamond(1300, 3460, 520, 170, "查体规则是否通过？", 14)
rect(1510, 3550, 360, 110, "错误提示并返回重新操作", "teacher", 14)
document(1300, 3640, 600, 120, "解锁体征并更新病例状态", 16)

rect(1300, 3830, 620, 110, "校验检查适宜性与选择时机", "agent", 16)
diamond(1300, 4000, 520, 170, "辅助检查选择是否合理？", 14)
rect(1510, 4090, 360, 110, "拒绝并提示重新选择", "teacher", 14)
document(1300, 4180, 600, 120, "返回检查结果并绑定证据", 16)

rect(1300, 4370, 620, 110, "读取学生诊断与已获得证据", "agent", 16)
diamond(1300, 4540, 520, 170, "诊断是否有充分证据支持？", 14)
rect(1090, 4710, 360, 110, "记录证据缺口", "teacher")
rect(1510, 4710, 360, 110, "确认诊断证据链", "agent")

rect(1300, 4900, 620, 110, "执行危重、感染、禁忌和转诊校验", "agent", 17)
diamond(1300, 5070, 520, 170, "是否触发安全规则？", 14)
rect(1510, 5160, 360, 110, "安全拦截并要求重拟", "teacher", 14)
document(1300, 5250, 600, 120, "锁定可接受处置方案", 16)

rect(1300, 5440, 620, 110, "模拟回应并评价沟通与情绪安抚", "agent", 17)
diamond(1300, 5610, 520, 170, "沟通目标是否完成？", 14)
rect(1510, 5700, 360, 110, "继续沟通", "teacher")
rect(1300, 5790, 620, 110, "锁定会话并封存事件证据", "agent", 16)
document(1300, 5950, 600, 130, "生成个体测试报告、答题记录与改进建议", 17)
diamond(1300, 6130, 520, 170, "是否存在薄弱能力？", 14)
rect(1300, 6300, 620, 110, "更新个人能力画像与学习记录", "agent", 17)
ellipse(1300, 6460, 460, 90, "本次智能体会话完成")

# Teacher read-only nodes.
ellipse(2100, 415, 360, 90, "教师开始查询")
rect(2100, 555, 420, 110, "登录教师学情端", "teacher")
rect(2100, 700, 420, 100, "查看学生列表", "teacher")
rect(2100, 840, 420, 100, "选择学生", "teacher")
rect(2100, 980, 420, 100, "查看历次测试", "teacher")
rect(2100, 1160, 430, 100, "仅支持查询，无任务编辑、参数修改或改分权限", "teacher", 13)
rect(2100, 5790, 420, 110, "选择已完成测试报告", "teacher", 14)
rect(2100, 5950, 430, 130, "查看个人测试报告和分项成绩", "teacher", 14)
rect(2100, 6110, 420, 110, "查看逐轮答题记录", "teacher")
rect(2100, 6260, 420, 110, "查看查体、检查、诊断、处置和干预过程", "teacher", 14)
ellipse(2100, 6430, 360, 90, "教师查询结束")

add('<rect x="800" y="6545" width="1000" height="78" rx="15" fill="#ffffff" stroke="#c8d5dc" stroke-width="2"/>')
text(1300, 6584, "标准符号：椭圆=起止｜矩形=操作｜菱形=判断｜波浪底=输出｜圆柱=版本化数据", size=21, weight=500, color="#526a78", limit=55)
add('</svg>')

node_count = validate_graph()
crossings = interior_crossings()
assert not crossings, f"检测到流程线内部交叉: {crossings}"

svg = "\n".join(parts)
SVG_OUT.write_text(svg, encoding="utf-8")
HTML_OUT.write_text(
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f8fafb}svg{display:block}</style></head><body>'
    + svg + '</body></html>',
    encoding="utf-8",
)
print(SVG_OUT)
print(HTML_OUT)
print(f"业务节点校验通过: {node_count}；流程线内部交叉: {len(crossings)}")
