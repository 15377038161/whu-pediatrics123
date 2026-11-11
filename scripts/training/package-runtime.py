"""Package a verified private runtime only; no code, credentials or deployment instructions."""
from pathlib import Path
import argparse,hashlib,json,zipfile

p=argparse.ArgumentParser()
p.add_argument('--runtime',required=True)
p.add_argument('--knowledge',required=True)
p.add_argument('--output',required=True)
a=p.parse_args()
runtime=Path(a.runtime).resolve();knowledge=Path(a.knowledge).resolve();out=Path(a.output).resolve()
if out.exists():raise RuntimeError('OUTPUT_ALREADY_EXISTS')
index=json.loads((runtime/'index.json').read_text(encoding='utf-8'))
assert index['schemaVersion']==1 and len(index['entries'])==67
sha=lambda raw:hashlib.sha256(raw).hexdigest()
generation=sha((runtime/'index.json').read_bytes())[:20]
content_name=f'peds-training-content-{generation}.zip'
payload={};media={};sources=set()
for case_id,version in index['entries'].items():
    assert len(version)==20 and all(c in '0123456789abcdef' for c in version)
    name=f'runtime/packages/{version}.json';raw=(runtime/'packages'/f'{version}.json').read_bytes()
    record=json.loads(raw);assert record['caseId']==case_id and record['version']==version
    sources.add(record['sourceId']);payload[name]=raw
    for item in record['tests']+record['exams']:
        for image in item.get('media',[]):
            file_id=image['fileId'];assert file_id.startswith('training-media:')
            digest=file_id.split(':')[1];assert len(digest)==64 and all(c in '0123456789abcdef' for c in digest)
            raw_image=(runtime/'media'/f'{digest}.png').read_bytes()
            assert sha(raw_image)==digest and len(raw_image)<3_000_000
            media[f'runtime/media/{digest}.png']=raw_image
assert len(sources)==53
source_root=knowledge/'teaching-cases'
if not source_root.is_dir():source_root=knowledge/'source-cases'
assert source_root.is_dir(),'SOURCE_CASE_DIRECTORY_MISSING'
for case_id in sorted(sources):
    assert case_id.startswith('teacher-') and not any(c in case_id for c in '/\\') and '..' not in case_id
    payload[f'source-cases/{case_id}.json']=(source_root/f'{case_id}.json').read_bytes()
payload['runtime/index.json']=(runtime/'index.json').read_bytes()
out.mkdir(parents=True)
files=[];archives=[]
def make_archive(name,items,include_manifest=False):
    with zipfile.ZipFile(out/name,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for file_path,raw in items:
            z.writestr(file_path,raw)
            files.append({'path':file_path,'bytes':len(raw),'sha256':sha(raw),'archive':name})
        if include_manifest:
            z.writestr('content-manifest.json',json.dumps({'schemaVersion':1,'entries':67,'sources':53,'media':len(media),'files':files},ensure_ascii=False,indent=2))
    raw=(out/name).read_bytes()
    with zipfile.ZipFile(out/name) as z:assert z.testzip() is None
    archives.append({'file':name,'bytes':len(raw),'sha256':sha(raw)})
group=[];size=0;part=1
for name,raw in sorted(media.items()):
    if group and size+len(raw)>40_000_000:
        make_archive(f'peds-training-media-{generation}-{part:02}.zip',group);group=[];size=0;part+=1
    group.append((name,raw));size+=len(raw)
if group:make_archive(f'peds-training-media-{generation}-{part:02}.zip',group)
make_archive(content_name,sorted(payload.items()),True)
manifest={'schemaVersion':1,'generation':generation,'contentArchive':content_name,'entries':67,'sources':53,'media':len(media),'archives':archives}
(out/'peds-training-upload-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'generation':generation,'entries':67,'sources':53,'media':len(media),'archiveCount':len(archives),'bytes':sum(x['bytes'] for x in archives)}))
