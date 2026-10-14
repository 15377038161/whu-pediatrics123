"""Local-only browser verification; synthetic auth, actual child GLB/WebGL rendering."""
import json, argparse, re
from io import BytesIO
from PIL import Image, ImageChops
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:8765');base=parser.parse_args().base
assert re.fullmatch(r'http://(?:127\.0\.0\.1|localhost):\d+',base),'local testing only'
part_count=len(json.loads(Path('public/models/anatomy/manifest.json').read_text(encoding='utf-8'))['parts'])
def intercept(route):
    if not route.request.url.startswith(base+'/'): return route.abort()
    if '/api/' not in route.request.url:return route.continue_()
    data={'user':{'id':'synthetic-anatomy','role':'student','displayName':'合成学生','provider':'preview'}} if '/api/auth/me' in route.request.url else []
    route.fulfill(json={'ok':True,'data':data})
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    for width in [390,768,1440]:
        page=browser.new_page(viewport={'width':width,'height':1000}); errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/*',intercept);page.goto(base+'/student/anatomy')
        page.get_by_text('儿童模型已加载',exact=False).wait_for(timeout=90000)
        page.locator('canvas').wait_for();page.wait_for_timeout(1500)
        assert page.locator('.anatomy-part').count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        bounds=page.locator('canvas').bounding_box();hint=page.locator('.anatomy-model-status').bounding_box()
        assert bounds['y']+bounds['height']<=hint['y'],'status must not cover the model canvas'
        page.screenshot(path=f'outputs/anatomy-{width}.png',full_page=True,animations='disabled')
        page.locator('#anatomy-region').select_option('left-leg')
        assert page.locator('.anatomy-part-list button').count()>0
        page.locator('.anatomy-part-list button').first.click()
        before=Image.open(BytesIO(page.locator('canvas').screenshot())).convert('RGB')
        page.get_by_role('button',name='只看选中部件',exact=True).click()
        page.get_by_role('button',name='恢复区域显示',exact=True).wait_for()
        page.wait_for_timeout(500)
        after=Image.open(BytesIO(page.locator('canvas').screenshot())).convert('RGB')
        assert ImageChops.difference(before,after).getbbox(), 'isolation must change actual WebGL pixels'
        # 在单部件模式点空白，必须恢复区域，不能留下无骨骼且无法退出的状态。
        blank=page.locator('canvas').bounding_box()
        page.locator('canvas').click(position={'x':4,'y':blank['height']*.5})
        assert page.get_by_role('button',name='恢复区域显示',exact=True).count()==0
        assert page.locator('.anatomy-info h2').inner_text()=='选择一个骨骼部件'
        page.locator('.anatomy-part-list button').first.click()
        before_focus=Image.open(BytesIO(page.locator('canvas').screenshot())).convert('RGB')
        page.get_by_role('button',name='聚焦所选',exact=True).click();page.wait_for_timeout(400)
        focused=Image.open(BytesIO(page.locator('canvas').screenshot())).convert('RGB')
        assert ImageChops.difference(before_focus,focused).getbbox(),'focus must move actual camera'
        page.get_by_role('button',name='放大模型',exact=True).click()
        page.get_by_role('button',name='缩小模型',exact=True).click()
        page.locator('input[aria-label="结构分离"]').fill('0.7')
        assert page.locator('output').inner_text()=='70%'
        page.get_by_role('button',name='背面',exact=True).click()
        page.get_by_role('button',name='重置',exact=True).click()
        assert page.locator('output').inner_text()=='0%'
        assert page.locator('.anatomy-part-list button').count()==part_count
        page.get_by_placeholder('输入骨骼名称或部件编号').fill('第1肋骨')
        assert page.locator('.anatomy-part-list button').count()==2
        page.get_by_placeholder('输入骨骼名称或部件编号').fill('不存在结构')
        page.get_by_text('当前区域没有匹配结构',exact=False).wait_for()
        page.get_by_role('button',name='重置',exact=True).click()
        canvas=page.locator('canvas');box=canvas.bounding_box();picked=False
        for y in [.5,.55,.6,.45]:
            canvas.click(position={'x':box['width']/2,'y':box['height']*y})
            if page.locator('.anatomy-info h2').inner_text()!='选择一个骨骼部件':picked=True;break
        assert picked,'3D raycast selection must reach bone info'
        assert not errors,errors
        page.close()
    # Failure is explicit, retry is available, old schematic never appears as fallback.
    page=browser.new_page();page.route('**/*',intercept);requests={'count':0}
    def transient(route):
        requests['count']+=1
        if requests['count']==1:route.fulfill(status=404,body='missing')
        else:route.continue_()
    page.route('**/piper-child-6yo.glb*',transient)
    page.goto(base+'/student/anatomy');page.get_by_role('button',name='重新加载',exact=True).wait_for(timeout=30000)
    page.get_by_text('模型不可用，请重试',exact=True).wait_for()
    page.screenshot(path='outputs/anatomy-error.png')
    page.get_by_role('button',name='重新加载',exact=True).click()
    page.get_by_text('儿童模型已加载',exact=False).wait_for(timeout=30000)
    assert requests['count']==2
    page.evaluate("document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
    page.get_by_text('模型不可用，请重试',exact=True).wait_for()
    page.get_by_role('button',name='重新加载',exact=True).click()
    page.get_by_text('儿童模型已加载',exact=False).wait_for(timeout=30000)
    page.close();browser.close()
    unsupported=p.chromium.launch(args=['--disable-webgl','--disable-webgl2'])
    page=unsupported.new_page();page.route('**/*',intercept);page.goto(base+'/student/anatomy')
    page.get_by_text('模型不可用，请重试',exact=True).wait_for(timeout=30000)
    unsupported.close()
result={'widths':[390,768,1440],'actualModel':True,'parts':part_count,'interaction':'passed','retry':'recovered','contextLoss':'recovered','noWebGL':'explicit error'}
Path('outputs/anatomy-verification.json').write_text(json.dumps(result),encoding='utf-8')
print(json.dumps(result))
