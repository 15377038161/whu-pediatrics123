"""Export only current versions and referenced media; originals and old installed versions stay untouched."""
from pathlib import Path
import csv,hashlib,html,json,shutil,zipfile

ROOT=Path('deliverables/67-cases-20261107');LIB=Path('knowledge/training-packages');OUT=Path('outputs/training-20261107')
for directory in ['runtime/packages','runtime/media','provenance','quality']:(ROOT/directory).mkdir(parents=True,exist_ok=True)
index=json.loads((ROOT/'index.json').read_text(encoding='utf-8'));entries={};media=set();material_index=[]
for entry in index:
    version=entry['version'];pack=json.loads((LIB/'packages'/f'{version}.json').read_text(encoding='utf-8'));entries[pack['caseId']]=version
    shutil.copy2(LIB/'packages'/f'{version}.json',ROOT/'runtime/packages'/f'{version}.json')
    for kind,items in [('test',pack['tests']),('exam',pack['exams'])]:
        for item in items:
            for m in item['media']:
                digest=m['fileId'].split(':')[1];media.add(digest)
                material_index.append({'ordinal':entry['ordinal'],'caseId':pack['caseId'],'kind':kind,'label':item['label'],'origin':item['origin'],'fileId':m['fileId'],'file':'clinical-media/'+digest+'.png','caption':m['caption']})
(ROOT/'runtime/index.json').write_text(json.dumps({'schemaVersion':1,'entries':entries},ensure_ascii=False,indent=2),encoding='utf-8')
for digest in media:shutil.copy2(LIB/'media'/f'{digest}.png',ROOT/'runtime/media'/f'{digest}.png')
# This exporter may be rerun before handoff; remove only obsolete generated export files.
for folder,expected in [(ROOT/'runtime/packages',{v+'.json' for v in entries.values()}),(ROOT/'runtime/media',{d+'.png' for d in media})]:
    if not folder.resolve().is_relative_to(ROOT.resolve()):raise RuntimeError('EXPORT_SCOPE_INVALID')
    for p in folder.glob('*.json' if folder.name=='packages' else '*.png'):
        if p.name not in expected:p.unlink()
(ROOT/'provenance/素材索引.json').write_text(json.dumps(material_index,ensure_ascii=False,indent=2),encoding='utf-8')
reviews=json.loads((OUT/'media-visual-review.json').read_text(encoding='utf-8'));candidates=json.loads((OUT/'media-candidates.json').read_text(encoding='utf-8'))
by_hash={c.get('processedHash'):c for c in candidates}
processing=[]
for review in reviews:
    row=dict(review);candidate=by_hash.get(row.get('processedHash'),{})
    row.update({k:candidate[k] for k in ['frameCrop','redactionCount','width','height'] if k in candidate})
    processing.append(row)
(ROOT/'provenance/原图处理与核对记录.json').write_text(json.dumps(processing,ensure_ascii=False,indent=2),encoding='utf-8')
for source,dest in [('package-validation.json','package-validation.json'),('media-postcheck.json','media-postcheck.json'),('reference-checks.json','reference-checks.json'),('runtime-validation.json','runtime-validation.json')]:
    if (OUT/source).exists():shutil.copy2(OUT/source,ROOT/'quality'/dest)
audit=json.loads((OUT/'docx-qa/render-audit.json').read_text(encoding='utf-8'))
build=json.loads((OUT/'document-build.json').read_text(encoding='utf-8'))
by_ordinal={r['ordinal']:r for r in build}
for row in audit:
    if row.get('sha256')!=by_ordinal.get(row.get('ordinal'),{}).get('sha256'):raise RuntimeError('DOCUMENT_QA_VERSION_MISMATCH')
    if row.get('error') or row.get('pageMismatch') or row.get('blankPages') or row.get('edgeInkPages'):raise RuntimeError('DOCUMENT_QA_FAILED')
(ROOT/'quality/document-render-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
dialogue=json.loads((OUT/'dialogue-evaluation.json').read_text(encoding='utf-8'))
(ROOT/'quality/dialogue-summary.json').write_text(json.dumps({'configured':dialogue['configured'],'executions':dialogue['executions'],'cases':len(dialogue['records']),'turns':sum(len(r['turns']) for r in dialogue['records']),'refreshAt':10,'realModelAccepted':False},indent=2),encoding='utf-8')
shutil.copy2(OUT/'visual-qa/bounds-audit.json',ROOT/'quality/all-page-bounds-audit.json')
for name in ['browser-validation.json','visual-review.json','delivery-structure-check.json']:
    if (OUT/name).exists():shutil.copy2(OUT/name,ROOT/'quality'/name)
(ROOT/'quality/screenshots').mkdir(exist_ok=True)
for shot in OUT.glob('ui-*.png'):shutil.copy2(shot,ROOT/'quality/screenshots'/shot.name)
for name in ['test-suite','lint','typecheck','build']:
    log=OUT/(name+'.log')
    if log.exists():(ROOT/'quality'/(name+'-tail.txt')).write_text('\n'.join(log.read_text(encoding='utf-8',errors='replace').splitlines()[-18:]),encoding='utf-8')
for name in ['TRAINING_PACKAGE_LOCAL.md','TRAINING_PACKAGE_API.md','TRAINING_CONTENT_AUTHORING.md']:
    shutil.copy2(Path('docs')/name,ROOT/name)
acceptance=Path('docs/67例本地实施验收记录_20261107.md')
if acceptance.exists():shutil.copy2(acceptance,ROOT/'验收记录.md')
rows=[]
for e in index:
    relation={'independent':'独立来源','alias':'名称关联','subtype':'上位/亚型关联'}[e['relation']]
    label=html.escape(e['filename']);rows.append(f'<tr><td>{e["ordinal"]:02}</td><td>{html.escape(e["title"])}</td><td>{relation}</td><td><a href="word/{label}.docx">Word</a>　<a href="json/{label}.json">JSON</a></td><td><code>{e["version"]}</code></td></tr>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>67例教学资料总索引</title><style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f6f5ee;color:#24493d;margin:0;padding:clamp(18px,4vw,54px)}main{max-width:1200px;margin:auto}h1{font-size:clamp(24px,4vw,38px)}p{line-height:1.8}input{width:min(90%,450px);padding:14px;border:1px solid #a4bbaa;border-radius:10px;font:inherit;margin:18px 0}table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:13px;text-align:left;border-bottom:1px solid #dce5db}th{background:#e5eee1}a{color:#216a51}code{font-size:11px;overflow-wrap:anywhere}.scroll{overflow:auto}.tag{border-left:4px solid #b57745;padding:12px 18px;background:#fff8e9}</style><main><p>珞珈儿科智训 · 本地教师资料</p><h1>67例病例教学资料总索引</h1><p>53份独立来源，67个完整入口；关联入口沿用同一患者事实。Word、JSON和运行时使用同一教学版本。原始记录、教学模拟和参考说明分别标记。</p><p class="tag">自动整理内容未医学审定。此目录包含教师参考病历与答案，不可作为学生开放目录或部署到public。真实模型、登录和物理设备验收边界见验收记录。</p><p><a href="验收记录.md">验收记录</a>　<a href="病例总索引.csv">CSV索引</a>　<a href="TRAINING_PACKAGE_LOCAL.md">本地运行说明</a>　<a href="assets/manifest.json">人物与器材清单</a></p><label>搜索病例 <input id="search" placeholder="输入编号、病名或关联类型"></label><div class="scroll"><table><thead><tr><th>编号</th><th>病例</th><th>来源关系</th><th>文件</th><th>教学版本</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table></div></main><script>document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))})</script></html>'''
(ROOT/'index.html').write_text(page,encoding='utf-8')
pages=sum(r['pages'] for r in audit)
(ROOT/'README.md').write_text(f'''# 67例病例本地教学资料包

从 `index.html` 或 `病例总索引.csv` 打开67份Word及67份JSON。53份独立来源和14个关联入口分别登记；不虚构新增患者。

- `word/`：67份完整病例教学手册，共{pages}页已渲染。包括人物/照护者、原始病历、问法与知情边界、局部查体/体位/器材/反应、检查与图片、诊疗及逐点评分。
- `json/`：67份对应完整数据，供核对和后续制作。
- `runtime/`：当前67个不可变教学版本及其引用的{len(media)}个去重媒体文件。目录保持私有；按运行说明安装，不复制到public，不覆盖原始病例或历史绑定。
- `assets/`：11类实体器材、手卫生及视触叩示意、20基础人物组合及实际用到的备选人物、9张局部示意SVG。
- `provenance/`：素材绑定、原件哈希、处理副本哈希、裁剪与遮挡记录；原件仍在项目原位置。
- `quality/`：逐文档渲染、版本与业务规则、媒体OCR复检、工程和浏览器证据。真实模型与合成测试分开。

自动整理内容未医学审定。原始病情与固定教学补充分别标明，不在每次申请时随机生成检查结果。无法可靠模拟的项目提供评估及参考，不伪造患者数值。一例原材料未记录性别，使用中性占位，不猜男女。

本轮未发布线上、未覆盖线上病例、未重算历史成绩。真实模型服务尚未配置，本机60轮代表对话为受控降级；真实登录、多身份数据库与物理语音另列待验。参阅 `验收记录.md` 和三份运行/接口/制作说明。
''',encoding='utf-8')
manifest=[]
for p in sorted(ROOT.rglob('*')):
    if p.is_file() and p.name!='文件校验清单.json':manifest.append({'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(ROOT/'文件校验清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
archive=ROOT.parent/'67例病例_本地教学资料包_20261107.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(ROOT.rglob('*')):
        if p.is_file():z.write(p,(Path(ROOT.name)/p.relative_to(ROOT)).as_posix())
pictures=ROOT.parent/'图片素材包_20261107.zip'
with zipfile.ZipFile(pictures,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted((ROOT/'assets').rglob('*')):
        if p.is_file():z.write(p,p.relative_to(ROOT).as_posix())
    for p in sorted((ROOT/'runtime/media').glob('*.png')):z.write(p,'clinical-media/'+p.name)
    for p in sorted((ROOT/'provenance').glob('*.json')):z.write(p,'provenance/'+p.name)
for p in [archive,pictures]:(p.parent/(p.name+'.sha256')).write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n',encoding='utf-8')
print(json.dumps({'word':67,'json':67,'renderedPages':pages,'runtimeMedia':len(media),'archiveMB':round(archive.stat().st_size/1024**2,1),'picturesMB':round(pictures.stat().st_size/1024**2,1)}))
