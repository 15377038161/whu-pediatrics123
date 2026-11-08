"""Render every Word with the bundled document renderer and audit every PDF page.

Clinical text stays in private outputs. Console output contains counts only.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib,json,os,subprocess,sys,time
from PIL import Image,ImageDraw,ImageFont
from pypdf import PdfReader

ROOT=Path(os.environ.get('PEDIATRICS_TRAINING_DELIVERY_ROOT','deliverables/67-cases-20261107'))
OUT=Path(os.environ.get('PEDIATRICS_TRAINING_AUTHORING_ROOT','outputs/training-20261107'))/'docx-qa'
RENDER=Path('C:/Users/Administrator/.codex/plugins/cache/openai-primary-runtime/documents/26.1105.12137/skills/documents/render_docx.py')
OUT.mkdir(parents=True,exist_ok=True)
env=dict(os.environ);env['PATH']='C:/Program Files/LibreOffice/program;'+env['PATH']
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)

def render(doc):
    ordinal=doc.name[:2];folder=OUT/ordinal;folder.mkdir(exist_ok=True)
    digest=hashlib.sha256(doc.read_bytes()).hexdigest();stamp=folder/'audit.json'
    if stamp.exists():
        previous=json.loads(stamp.read_text(encoding='utf-8'))
        if previous.get('sha256')==digest and not previous.get('error') and not previous.get('pageMismatch') and len(list(folder.glob('page-*.png')))==previous.get('pages'):return previous
    # Only generated preview files inside this verified output folder are removed.
    if not folder.resolve().is_relative_to(OUT.resolve()):raise RuntimeError('OUTPUT_SCOPE_INVALID')
    for pattern in ['page-*.png','contact-*.jpg','*.pdf']:
        for generated in folder.glob(pattern):generated.unlink()
    result=subprocess.run([sys.executable,str(RENDER),str(doc.resolve()),'--output_dir',str(folder.resolve()),'--emit_pdf','--dpi','110'],env=env,capture_output=True,timeout=600)
    record={'ordinal':int(ordinal),'sha256':digest,'exitCode':result.returncode}
    if result.returncode:
        record['error']='RENDER_FAILED';(folder/'render.log').write_bytes(result.stdout+result.stderr)
    else:
        pdfs=list(folder.glob('*.pdf'));reader=PdfReader(pdfs[0]);pages=sorted(folder.glob('page-*.png'),key=lambda p:int(p.stem.split('-')[-1]))
        record['pages']=len(reader.pages);record['renderedPages']=len(pages);record['blankPages']=[];record['edgeInkPages']=[]
        for number,page in enumerate(pages,1):
            im=Image.open(page).convert('L');w,h=im.size
            middle=im.crop((int(w*.08),int(h*.08),int(w*.92),int(h*.92)))
            ink=sum(middle.histogram()[:190]);ratio=ink/(middle.width*middle.height)
            if ratio<.0002:record['blankPages'].append(number)
            bands=[im.crop((0,0,int(w*.015),h)),im.crop((int(w*.985),0,w,h))]
            if any(sum(b.histogram()[:150])>20 for b in bands):record['edgeInkPages'].append(number)
        for start in range(0,len(pages),24):
            selected=pages[start:start+24];sheet=Image.new('RGB',(1080,6*260),(220,225,218));draw=ImageDraw.Draw(sheet)
            for i,page in enumerate(selected):
                im=Image.open(page).convert('RGB');im.thumbnail((250,232));x=(i%4)*270+10;y=(i//4)*260+24
                sheet.paste(im,(x,y));draw.text((x,y-21),f'{ordinal} / {start+i+1}',font=font,fill='black')
            sheet.save(folder/f'contact-{start//24+1:02}.jpg',quality=86)
        record['pageMismatch']=record['pages']!=record['renderedPages']
    stamp.write_text(json.dumps(record,indent=2),encoding='utf-8');return record

records=[];start=time.time()
with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(render,p) for p in sorted((ROOT/'word').glob('*.docx'))]
    for future in as_completed(futures):
        try:records.append(future.result())
        except Exception as error:records.append({'error':type(error).__name__})
        (OUT/'render-audit.json').write_text(json.dumps(sorted(records,key=lambda r:r.get('ordinal',99)),indent=2),encoding='utf-8')
        print(json.dumps({'done':len(records),'pages':sum(r.get('pages',0) for r in records),'errors':sum('error' in r for r in records)}),flush=True)
print(json.dumps({'documents':len(records),'seconds':round(time.time()-start)}))
if len(records)!=67 or any(r.get('error') or r.get('pageMismatch') for r in records):
    raise SystemExit(1)
