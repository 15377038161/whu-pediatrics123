"""本地合成响应浏览器验收：不替代真实登录/数据库验证，任何非本地请求均拒绝。"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from copy import deepcopy
from uuid import uuid4

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:8765')
args = parser.parse_args()
assert re.fullmatch(r'http://(?:127\.0\.0\.1|localhost):\d+', args.base), '仅允许本地验收'
fixtures = json.loads(Path('outputs/ui/fixtures.json').read_text(encoding='utf-8'))
session = fixtures['session']
report = fixtures['report']
output = Path('outputs/ui')
checks = []
routes = [('/', 'student'), ('/auth/error?reason=oauth_failed', 'student'),
          ('/student', 'student'), ('/student/practice', 'student'), ('/student/osce', 'student'),
          ('/student/training?session=' + session['id'], 'student'), ('/student/quiz', 'student'),
          ('/student/reports', 'student'), ('/student/reports/ui-report', 'student'),
          ('/student/anatomy', 'student'), ('/teacher', 'teacher'),
          ('/teacher/sessions/' + session['id'], 'teacher'), ('/teacher/cases/teacher-肾病综合征', 'teacher'),
          ('/teacher/case-drafts', 'teacher'), ('/teacher/usage-stats', 'teacher'), ('/about/agent', 'student')]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in [390, 768, 1440]:
        context = browser.new_context(viewport={'width': width, 'height': 900})
        page = context.new_page()
        actor = {'role': 'student'}
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        current = deepcopy(session)
        current_report = deepcopy(report)
        sent_events = []
        created_requests = []

        def handle(route):
            url = urlparse(route.request.url)
            if not route.request.url.startswith(args.base + '/'):
                route.abort()
                return
            if not url.path.startswith('/api/'):
                route.continue_()
                return
            user = {'id': 'ui-synthetic-' + actor['role'], 'role': actor['role'], 'displayName': '合成验收用户',
                    'studentNo': None, 'provider': 'preview', 'chaoxingUid': None}
            data = None
            path = url.path
            if path == '/api/auth/me': data = {'user': user}
            elif path == '/api/cases': data = fixtures['catalog']
            elif path == '/api/sessions':
                if route.request.method == 'GET': data = [current]
                else:
                    created_requests.append(route.request.post_data_json)
                    current.update({**deepcopy(session), 'id': str(uuid4()), 'status': 'active', 'decision': None, 'plan': None, 'communication': None, 'viewStage': 'triage'})
                    data = current
            elif path == '/api/reports': data = [report]
            elif path.startswith('/api/reports/'): data = current_report
            elif path.endswith('/finish'):
                current_report.update({**report, 'studentDecision': deepcopy(current.get('decision'))})
                current['status'] = 'completed'
                data = current_report
            elif path.startswith('/api/sessions/'): data = current
            elif path == '/api/agent/turn':
                event = route.request.post_data_json['event']
                sent_events.append(event)
                detail = event['data']
                if event['type'] == 'NAVIGATE_STAGE': current['viewStage'] = detail['stage']
                elif event['type'] == 'SUBMIT_DECISION': current['decision'] = detail
                elif event['type'] == 'SUBMIT_PLAN': current['plan'] = detail
                elif event['type'] == 'EXAM_ACTION':
                    current['examPosture'] = detail.get('posture', 'standing')
                    if detail['toolId'] == 'hand-hygiene': current['unlockedEvidence'] = ['EX_PREP']
                elif event['type'] == 'SEND_COMMUNICATION': current['communication'] = detail['text']
                data = {'session': current, 'newMessages': [], 'feedback': '合成界面反馈：操作已接收', 'trace': []}
            elif path == '/api/teacher/students': data = []
            elif path.startswith('/api/teacher/sessions/'):
                data = {'session': session, 'report': report, 'student': {'id': session['userId'], 'displayName': '合成学生', 'studentNo': None}}
            elif path.endswith('/resources'): data = []
            elif path == '/api/teacher/case-publication': data = {'total': 0, 'unpublished': 0, 'cases': []}
            elif path == '/api/teacher/usage-stats':
                data = {'perStudent': [], 'overall': {'studentCount': 0, 'sessionCount': 0, 'completedCount': 0,
                        'inProgressCount': 0, 'totalTurnCount': 0, 'totalActiveHours': 0}, 'dailyTrend': [],
                        'weeklyTrend': [], 'caseDistribution': [], 'weakAreas': [], 'recentSessions': [], 'scoreBasis': 'practice-only'}
            elif path == '/api/quiz/questions': data = {'questions': [], 'poolExhausted': True}
            elif path == '/api/engagement': data = {'recorded': True}
            if data is None:
                route.fulfill(status=403, content_type='application/json', body=json.dumps({'ok': False, 'error': {'code': 'FORBIDDEN', 'message': '合成验收：此操作需真实授权'}}))
            else:
                route.fulfill(content_type='application/json', body=json.dumps({'ok': True, 'data': data}))

        context.route('**/*', handle)
        for index, (path, role) in enumerate(routes):
            actor['role'] = role
            errors.clear()
            page.goto(args.base + path, wait_until='networkidle')
            # 网络结束后等下一帧，确保异步门控与布局完成。
            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            overflow = page.evaluate('() => document.documentElement.scrollWidth - innerWidth')
            screenshot = output / f'{width}-{index:02d}.png'
            page.screenshot(path=str(screenshot), full_page=True, animations='disabled')
            checks.append({'width': width, 'path': path, 'overflow': overflow, 'pageErrors': len(errors), 'screenshot': str(screenshot)})

        # 交互走查：响应为合成数据；实际引擎/路由由workflow-route与查体单测独立验证。
        actor['role'] = 'student'
        page.goto(args.base + '/student/training?session=' + session['id'], wait_until='networkidle')
        page.get_by_role('button', name='可视化体格检查', exact=True).click()
        if width < 1024:
            page.get_by_role('button', name='检查方法', exact=True).click()
        page.screenshot(path=str(output / f'{width}-debug-exam.png'), full_page=True, animations='disabled')
        page.get_by_role('button', name='仰卧', exact=True).click()
        page.get_by_role('button', name='手卫生', exact=True).click()
        page.get_by_role('button', name='触诊', exact=True).click()
        if width < 1024:
            page.get_by_role('button', name='使用当前器材检查腹部', exact=True).click()
        else:
            page.get_by_role('button', name='使用当前器材检查腹部', exact=True).click()
        assert any(e['type'] == 'EXAM_ACTION' and e['data'].get('posture') == 'supine' for e in sent_events)
        page.screenshot(path=str(output / f'{width}-supine.png'), full_page=True, animations='disabled')
        page.get_by_role('button', name='病情摘要与诊断', exact=True).click()
        page.get_by_label('诊断依据（必填）', exact=True).fill('前端走查：返回前尚未提交的诊断依据草稿')
        page.get_by_role('button', name='辅助检查选择', exact=True).click()
        page.get_by_role('button', name='病情摘要与诊断', exact=True).click()
        assert page.get_by_label('诊断依据（必填）', exact=True).input_value() == '前端走查：返回前尚未提交的诊断依据草稿'
        page.get_by_role('button', name='提交诊断并继续', exact=True).click()
        assert any(e['type'] == 'SUBMIT_DECISION' and '尚未提交' in e['data']['diagnosisBasis'] for e in sent_events)
        page.screenshot(path=str(output / f'{width}-decision.png'), full_page=True, animations='disabled')
        page.get_by_label('首要处置', exact=True).fill('合成测试：进一步评估')
        page.get_by_label('完整计划', exact=True).fill('合成测试：监测病情并说明后续复评安排')
        page.get_by_role('button', name='安全校验并继续', exact=True).click()
        page.get_by_label('输入对患儿和家长的解释', exact=True).fill('合成测试：我理解您担心，会说明下一步评估安排。')
        page.get_by_role('button', name='发送', exact=True).click()
        page.get_by_role('button', name='生成训练报告', exact=True).click()
        page.wait_for_url('**/student/reports/ui-report')
        page.get_by_text('你的诊断与依据', exact=True).wait_for()
        assert '尚未提交' in page.locator('.preserve-lines').inner_text()
        page.screenshot(path=str(output / f'{width}-report.png'), full_page=True, animations='disabled')
        page.get_by_role('button', name='接诊下一位患儿', exact=True).click()
        page.wait_for_url('**/student/training?session=*')
        assert created_requests[-1]['random'] is True
        assert created_requests[-1]['excludeCaseId'] == report['caseId']
        assert current['id'] != session['id']
        checks.append({'width': width, 'path': 'interaction/supine-and-draft', 'overflow': page.evaluate('() => document.documentElement.scrollWidth - innerWidth'), 'pageErrors': len(errors), 'screenshot': str(output / f'{width}-decision.png')})
        context.close()
    browser.close()
output.joinpath('verification.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
failed = [item for item in checks if item['overflow'] > 1 or item['pageErrors']]
print(json.dumps({'pages': len(routes), 'checks': len(checks), 'failed': failed}, ensure_ascii=False))
assert not failed, '存在页面错误或整页横向溢出，见outputs/ui/verification.json'
