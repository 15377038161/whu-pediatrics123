"""Local synthetic sessions; verifies actual gender/posture image loading, not real auth."""
import argparse,json,re
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:8765');base=parser.parse_args().base
assert re.fullmatch(r'http://(?:127\.0\.0\.1|localhost):\d+',base)
fixture=json.loads(Path('outputs/ui/fixtures.json').read_text(encoding='utf-8'))
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in [390,768,1440]:
        for item in fixture['appearances']:
            page=browser.new_page(viewport={'width':width,'height':1000});errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            def intercept(route):
                url=urlparse(route.request.url)
                if not route.request.url.startswith(base+'/'):return route.abort()
                if not url.path.startswith('/api/'):return route.continue_()
                data= {'user':{'id':'ui-synthetic-student','role':'student','displayName':'合成验收学生','provider':'preview'}} if url.path=='/api/auth/me' else item['session'] if url.path.startswith('/api/sessions/') else []
                route.fulfill(json={'ok':True,'data':data})
            page.route('**/*',intercept);page.goto(base+'/student/training?session='+item['session']['id'])
            page.locator('.patient-stage').wait_for()
            key=item['standing']['key']
            assert page.locator('.patient-stage').get_attribute('data-avatar')==key
            def check_photo(expected):
                if expected['src'] is None:
                    assert page.locator('.patient-photo').count()==0
                    page.get_by_text('病例未注明性别',exact=True).wait_for();return
                photo=page.locator('.patient-photo');photo.wait_for()
                page.wait_for_function("document.querySelector('.patient-photo').complete && document.querySelector('.patient-photo').naturalWidth > 0")
                src=unquote(photo.get_attribute('src'))
                assert expected['src'] in src,(src,expected['src'])
                assert ('女孩' if key.startswith('girl') else '男孩') in photo.get_attribute('alt')
            check_photo(item['standing'])
            if width<1024:page.get_by_role('button',name='检查方法',exact=True).click()
            page.get_by_role('button',name='仰卧',exact=True).click()
            if width<1024:page.get_by_role('button',name='关闭抽屉并返回患儿模型',exact=True).click(position={'x':10,'y':10})
            check_photo(item['supine'])
            assert page.locator('.patient-stage').get_attribute('data-avatar')==key
            buttons=page.locator('.patient-figure .hotspot').all()
            boxes=[button.bounding_box() for button in buttons]
            for i,a in enumerate(boxes):
                for b in boxes[i+1:]:
                    overlap=min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x'])>1 and min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y'])>1
                    assert not overlap,'body-part controls overlap'
            page.screenshot(path=f'outputs/patient-{width}-{key}-supine.png',full_page=True,animations='disabled')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width<1024:page.get_by_role('button',name='检查方法',exact=True).click()
            page.get_by_role('button',name='站立',exact=True).click()
            if width<1024:page.get_by_role('button',name='关闭抽屉并返回患儿模型',exact=True).click(position={'x':10,'y':10})
            check_photo(item['standing'])
            page.reload();check_photo(item['standing'])
            assert not errors,errors
            results.append({'width':width,'key':key,'passed':True});page.close()
    browser.close()
Path('outputs/patient-appearance-verification.json').write_text(json.dumps(results),encoding='utf-8')
print(json.dumps({'checks':len(results),'failed':0}))
