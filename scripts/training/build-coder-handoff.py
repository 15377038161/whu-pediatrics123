"""Create a private, conflict-aware Coder handoff; never modifies source cases or repository files."""
from pathlib import Path
import hashlib,json,subprocess,zipfile

ROOT=Path.cwd();OUT=ROOT/'deliverables/Coder接入67例_20261107';UPLOADS=OUT/'uploads'
OUT.mkdir(parents=True,exist_ok=True);UPLOADS.mkdir(exist_ok=True)
sha=lambda data:hashlib.sha256(data).hexdigest()
def git(*args):return subprocess.check_output(['git','-c','core.quotepath=false',*args],cwd=ROOT)
head=git('rev-parse','HEAD').decode().strip()
changed=git('diff','--name-only','-z','HEAD').decode('utf-8').strip('\0').split('\0')
added=git('ls-files','--others','--exclude-standard','-z','src','tests','public/media/clinical','scripts/training').decode('utf-8').strip('\0').split('\0')
docs=['docs/TRAINING_PACKAGE_API.md','docs/TRAINING_PACKAGE_LOCAL.md','docs/TRAINING_CONTENT_AUTHORING.md','docs/67例本地实施验收记录_20261107.md','docs/实施方案/20261107_Coder接入67例_执行提示词.md','docs/实施方案/20261107_Coder接入67例_用户操作.md']
assets=json.loads((ROOT/'deliverables/67-cases-20261107/assets/manifest.json').read_text(encoding='utf-8'))
paths=sorted(set(p for p in changed+added+docs if p and not p.startswith('public/')))
assert all(not p.startswith(('.env/', 'knowledge/','outputs/','backups/')) and p!='.env' and not p.endswith(('.env','.pem','.key')) for p in paths)
manifest=[];payload={};bases={}
for p in paths:
    file=ROOT/p
    if not file.is_file():raise RuntimeError('HANDOFF_FILE_MISSING:'+p)
    data=file.read_bytes();payload[p]=data
    previous=subprocess.run(['git','show',head+':'+p],cwd=ROOT,capture_output=True)
    base=previous.stdout if previous.returncode==0 else None
    if base is not None:bases[p]=base
    manifest.append({'path':p,'sha256':sha(data),'bytes':len(data),'baseSha256':sha(base) if base is not None else None,'changed':base!=data})

preflight='''from pathlib import Path
import argparse,hashlib,json,sys
sys.stdout.reconfigure(encoding='utf-8')
p=argparse.ArgumentParser();p.add_argument('--target',required=True);args=p.parse_args()
root=Path(__file__).resolve().parent;target=Path(args.target).resolve();m=json.loads((root/'code-manifest.json').read_text(encoding='utf-8'));rows=[]
for r in m['files']:
 path=Path(r['path']);assert not path.is_absolute() and '..' not in path.parts
 desired=root/'payload'/path;assert hashlib.sha256(desired.read_bytes()).hexdigest()==r['sha256']
 current=target/path;h=hashlib.sha256(current.read_bytes()).hexdigest() if current.is_file() else None
 status='already-current' if h==r['sha256'] else 'safe-new' if h is None and r['baseSha256'] is None else 'base-matches' if h==r['baseSha256'] else 'needs-merge'
 rows.append({'path':r['path'],'status':status})
print(json.dumps({'readOnly':True,'baseHead':m['baseHead'],'files':rows},ensure_ascii=False,indent=2))
'''
readme='''# 先读本文件，再合并

当前包用于同一个武大儿科学Coder项目，属于用户授权的本地成果接入与发布交接。完整要求见 payload/docs/实施方案/20261107_Coder接入67例_执行提示词.md。

先解压到仓库外独立目录。运行 `python3 preflight.py --target /实际仓库根目录`，仅输出文件比对，不写目标。`base/`为本地基线，`payload/`为目标内容，code-manifest.json为SHA256。needs-merge表示云端有差异，应逐段合并；不能通过reset、clean或直接覆盖解决。changes.patch只含已跟踪文件差异；新增文件在payload。

content和全部media分包解压到同一独立目录。content-manifest.json列明每个文件的哈希和所属ZIP。source-cases仅为缺失原件补齐，现有同名不同内容先保留并调查。runtime对应服务端私有knowledge/training-packages。通用人物/器材图片在assets分包，按public-assets-manifest.json补齐对应public/media文件；病例media仍为私有，不能混入public。已有不可变版本和历史索引先保留，切换只影响新会话。Gitignored文件不保证随部署存在，必须落实私有持久化/恢复并做重启验收，不能把教师答案目录挂public。

本包不含环境秘密、Word、node_modules或构建产物。source-cases、packages与media均为私有教学内容，不入Git，不回显病历原文。只读核对真实平台绑定，不强行替换原始快照，不重算历史成绩。Windows本地OCR/Word工具位置不搬到Linux平台。
'''
asset_files=sorted(set('public'+a['publicPath'] for a in assets if a.get('publicPath'))|{p for p in added if p.startswith('public/')})
asset_groups=[];group=[];size=0
for p in asset_files:
    n=(ROOT/p).stat().st_size
    if size+n>40_000_000 and group:asset_groups.append(group);group=[];size=0
    group.append(p);size+=n
if group:asset_groups.append(group)
asset_manifest=[]
for i,group in enumerate(asset_groups,1):
    name=f'peds-training-assets-20261107-{i:02}.zip'
    with zipfile.ZipFile(UPLOADS/name,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in group:
            data=(ROOT/p).read_bytes();z.writestr(p,data)
            asset_manifest.append({'path':p,'sha256':sha(data),'bytes':len(data),'archive':name})

code=UPLOADS/'peds-training-code-20261107.zip'
with zipfile.ZipFile(code,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    z.writestr('START_HERE.md',readme);z.writestr('preflight.py',preflight)
    z.writestr('code-manifest.json',json.dumps({'schemaVersion':1,'baseHead':head,'observedCloudPageHead':'15eeb3b6f540a7949bbc017143b8cb732cfe0163','files':manifest},ensure_ascii=False,indent=2))
    z.writestr('public-assets-manifest.json',json.dumps(asset_manifest,ensure_ascii=False,indent=2))
    z.writestr('changes.patch',git('diff','--binary','HEAD','--',*changed))
    for p,data in payload.items():z.writestr('payload/'+p,data)
    for p,data in bases.items():z.writestr('base/'+p,data)

library=ROOT/'deliverables/67-cases-20261107/runtime';inventory=json.loads((library/'index.json').read_text(encoding='utf-8'))
assert len(inventory['entries'])==67
source_files=sorted((ROOT/'knowledge/teaching-cases').glob('*.json'));assert len(source_files)==53
baseline=json.loads((ROOT/'backups/20261107-training/baseline.json').read_text(encoding='utf-8'))
for r in baseline['sources']:assert sha(Path(r['path']).read_bytes()).upper()==r['sha256']
content=[];core=[]
def register(file,arc,bundle):
    data=file.read_bytes();content.append({'path':arc,'sha256':sha(data),'bytes':len(data),'archive':bundle});return (file,arc)
content_name='peds-training-content-20261107.zip'
core.append(register(library/'index.json','runtime/index.json',content_name))
for file in sorted((library/'packages').glob('*.json')):core.append(register(file,'runtime/packages/'+file.name,content_name))
for file in source_files:core.append(register(file,'source-cases/'+file.name,content_name))
media=sorted((library/'media').glob('*.png'));assert len(media)==1032
parts=[];group=[];size=0
for file in media:
    if size+file.stat().st_size>40_000_000 and group:parts.append(group);group=[];size=0
    group.append(file);size+=file.stat().st_size
if group:parts.append(group)
for i,group in enumerate(parts,1):
    name=f'peds-training-media-20261107-{i:02}.zip'
    with zipfile.ZipFile(UPLOADS/name,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for file in group:
            _,arc=register(file,'runtime/media/'+file.name,name);z.write(file,arc)
with zipfile.ZipFile(UPLOADS/content_name,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for file,arc in core:z.write(file,arc)
    z.writestr('content-manifest.json',json.dumps({'schemaVersion':1,'entries':67,'sources':53,'media':1032,'files':content},ensure_ascii=False,indent=2))

prompt='''请接续当前武大儿科学项目，合并本次67例病例内容与训练体验代码、安装私有资料，完成真实验收后发布当前项目。请直接执行，不重复出方案。

先读取本次代码包START_HERE.md及payload/docs/实施方案/20261107_Coder接入67例_执行提示词.md，核验全部ZIP的SHA256与分包文件清单。附件包含代码、53源JSON、67教学版本、1032媒体；不需要上传或重做Word。

本地基线5ab8a89，页面最近记录15eeb3b，云端已有首页双端地图/13入口和其他更新：先查实际HEAD和工作区，使用base与payload逐段合并，保留云端已有功能，禁止整批覆盖、reset或clean。先核实现有1440px和5项缺原件待办，不通过跳过测试凑通过。

落实8大部位61位置、三种正确体温计图片及部位、连续角色问诊、详细检查表格和处理后的图片、80+20分逐项宽严评分及最终报告。新会话固定源/教学双版本；原件和答案仅服务端私有，现有不同源文件先保留并核对；不改旧会话绑定、不重算正式成绩、不把病例目录或图片包挂public。尤其检查Gitignored私有文件在部署后是否真实存在，复用现有私有存储/恢复并重启验收，不能只在沙箱临时可用。

本地60轮均因模型未配置降级；请复用平台已有invokeCozeAI及服务配置，做DKA/新生儿/呼吸各20轮真实模型测试，分别记录model/fallback；完成真实手机/桌面、报告刷新、媒体权限、67/67版本绑定及重启恢复后再发布。合成UI适配器不是登录功能，不部署它，不索取或输出任何密钥，不扩大权限。补充内容未医学审定标识保留。给出实际提交号、发布地址和逐项验收；遇到真登录/额度阻断明确说明，同时继续独立工作，不把构建通过当作全部完成。
'''
(OUT/'01_复制给Coder.txt').write_text(prompt,encoding='utf-8')
(OUT/'02_你要怎样操作.md').write_bytes((ROOT/'docs/实施方案/20261107_Coder接入67例_用户操作.md').read_bytes())
archives=[]
for file in sorted(UPLOADS.glob('*.zip')):
    with zipfile.ZipFile(file) as z:assert z.testzip() is None
    if file.stat().st_size>50_000_000:raise RuntimeError('UPLOAD_PART_TOO_LARGE')
    archives.append({'file':file.name,'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())})
upload_manifest=json.dumps({'codeFiles':len(paths),'sourceFiles':53,'teachingVersions':67,'media':1032,'archives':archives},ensure_ascii=False,indent=2)
(OUT/'上传包校验清单.json').write_text(upload_manifest,encoding='utf-8')
(UPLOADS/'peds-training-upload-manifest.json').write_text(upload_manifest,encoding='utf-8')
print(json.dumps({'codeFiles':len(paths),'sources':53,'entries':67,'media':1032,'uploads':[{**r,'sha256':r['sha256'][:12]} for r in archives]}))
