"""Local deterministic redaction authorized by the user. No raw pixels or OCR text leave this process.

Produces candidates, not an automatic claim of medical/visual approval. Only reviewed hashes are bound.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import csv, io, json, hashlib, subprocess, zipfile, collections, re
from concurrent.futures import ThreadPoolExecutor, as_completed

OUT=Path('outputs/training-20261107'); DEST=Path('knowledge/training-packages/media')
OUT.mkdir(parents=True,exist_ok=True);DEST.mkdir(parents=True,exist_ok=True)
TMP=OUT/'media-work';TMP.mkdir(exist_ok=True)
sources=json.loads((OUT/'media-sources.json').read_text(encoding='utf-8'))
diseases=[s['sourceId'].replace('teacher-','') for s in sources]
TESS=r'D:\Tesseract-OCR\tesseract.exe'
labels=[('头颅MRI',r'头.{0,5}(MRI|磁共振)|脑.{0,5}(MRI|磁共振)|颅.{0,5}(MRI|磁共振)|(?:MRI|MR)[_ -]?(?:HEAD|BRAIN)'),('头颅影像',r'头.{0,5}(CT|超声)|脑.{0,5}CT|颅.{0,5}CT|(?:CT)[_ -]?(?:HEAD|BRAIN)'),('胸部影像',r'胸|肺|CHEST|THORAX|LUNG'),('心脏超声',r'心脏|心超|超声心动|ECHO'),('心电图',r'心电|ECG|EKG'),('腹部超声',r'腹部|肝胆|泌尿|盆腔|肾脏|ABDOMEN|ABDOMINAL'),('骨龄',r'骨龄|BONE.?AGE'),('脑电图',r'脑电|EEG'),('骨髓检查',r'骨髓|外周血涂片'),('血常规',r'血常规|血细胞|WBC|PLT')]

def central_component(image):
    """Crop a frame to anatomy, instead of treating texture/lesions as OCR words."""
    small=image.convert('L');small.thumbnail((220,220));w,h=small.size;pixels=list(small.getdata())
    visited=set();components=[]
    for y in range(h):
        for x in range(w):
            start=y*w+x
            if start in visited or pixels[start]<35:continue
            stack=[start];visited.add(start);points=[]
            while stack:
                q=stack.pop();points.append((q%w,q//w))
                for n in (q-1,q+1,q-w,q+w):
                    if n<0 or n>=w*h or n in visited or pixels[n]<35:continue
                    if abs((n%w)-(q%w))+abs((n//w)-(q//w))!=1:continue
                    visited.add(n);stack.append(n)
            if len(points)>w*h*.018 and any(w*.35<px<w*.65 and h*.2<py<h*.8 for px,py in points):components.append(points)
    if not components:return image,None
    points=max(components,key=len);xs=[x for x,y in points];ys=[y for x,y in points]
    sx,sy=image.width/w,image.height/h
    box=(max(0,int((min(xs)-5)*sx)),max(0,int((min(ys)-5)*sy)),min(image.width,int((max(xs)+6)*sx)),min(image.height,int((max(ys)+6)*sy)))
    return image.crop(box),box

def candidates(s):
    groups=collections.defaultdict(list)
    for name in s['files']:
        p=Path(name)
        if p.suffix.lower() in ['.png','.jpg','.jpeg']:
            groups[str(p.parent)].append(p)
    chosen=[]
    for key,images in sorted(groups.items()):
        images.sort()
        count=min(3,len(images))
        for i in range(count):chosen.append(('file',images[round((i+1)*(len(images)-1)/(count+1))],None))
    for name in s['files']:
        if not name.lower().endswith('.docx'):continue
        try:
            with zipfile.ZipFile(name) as z:
                names=[n for n in z.namelist() if n.startswith('word/media/') and n.lower().endswith(('.png','.jpg','.jpeg'))]
                for n in names[:4]:chosen.append(('docx',Path(name),n))
        except Exception:pass
    return chosen[:12]

def process(s,choice):
    kind,p,member=choice
    try:
        if kind=='docx':
            with zipfile.ZipFile(p) as z:raw=z.read(member)
        else:raw=p.read_bytes()
        source_hash=hashlib.sha256(raw).hexdigest();image=Image.open(io.BytesIO(raw)).convert('RGB')
        if min(image.size)<150:return None
        image.thumbnail((1300,1300));w,h=image.size
        # Remove acquisition banners first. Remaining text is still OCR checked.
        image=image.crop((int(w*.035),int(h*.12),int(w*.965),int(h*.90)))
        w,h=image.size
        work=TMP/f'{source_hash}.png';image.save(work)
        completed=subprocess.run([TESS,str(work),'stdout','-l','chi_sim+eng','--psm','11','tsv'],capture_output=True,timeout=45)
        if completed.returncode:return {'sourceId':s['sourceId'],'sourceHash':source_hash,'status':'ocr-failed'}
        rows=list(csv.DictReader(io.StringIO(completed.stdout.decode('utf-8',errors='replace')),delimiter='\t'))
        text=' '.join(row.get('text','') for row in rows)
        relative=str(p.relative_to(Path(s['folder']))) if s.get('folder') else ''
        # Only anatomical/modality hints, never disease names alone, determine the trigger.
        hint=relative+' '+text
        matches=[label for label,pattern in labels if re.search(pattern,hint,re.I)]
        test_label=matches[0] if len(matches)==1 else None
        # A sole report in the case is not proof that a different image belongs to it.
        draw=ImageDraw.Draw(image);redactions=0
        # On radiology frames all textual annotations are removed except orientation and short measurements.
        # On mixed screenshots, whole text lines containing identity/diagnosis are removed as well.
        lines=collections.defaultdict(list)
        for r in rows:
            if r.get('text','').strip():lines[(r.get('block_num'),r.get('par_num'),r.get('line_num'))].append(r)
        sensitive=re.compile(r'姓名|患者|住院|门诊|病案|床号|身份证|电话|地址|诊断|印象|结论|考虑|提示|审核|医师|医生|报告者|申请科室|科别|Name|Patient|ID|DOB|Accession|Birth|Hospital',re.I)
        for line in lines.values():
            line_text=''.join(r['text'] for r in line)
            whole=bool(sensitive.search(line_text) or any(d in line_text for d in diseases) or re.search(r'1[3-9]\d{9}|\d{17}[\dXx]|\b(?:19|20)\d{2}[-/年]',line_text))
            for r in line:
                token=r['text'].strip()
                keep_numeric=bool(re.fullmatch(r'(?:[LR]|[\d.]{1,6}\s*(?:mm|cm|HU|Hz|mV|s|ms|%)?)',token,re.I))
                # Conservative text removal on frames prevents unrecognized names from remaining in banners.
                if whole or not keep_numeric:
                    x,y,rw,rh=[int(r[k]) for k in ['left','top','width','height']]
                    draw.rectangle((max(0,x-3),max(0,y-3),min(w,x+rw+3),min(h,y+rh+3)),fill=(22,27,29))
                    redactions+=1
        # OCR can mistake anatomy and waveforms for words. Frames are recropped from
        # the untouched image, preserving the central anatomical component.
        original=Image.open(io.BytesIO(raw)).convert('RGB');original.thumbnail((1300,1300))
        ow,oh=original.size;original=original.crop((int(ow*.035),int(oh*.12),int(ow*.965),int(oh*.90)))
        sample=original.convert('L').resize((100,100));dark=sum(v<45 for v in sample.getdata())/10000
        frame_crop=None
        if dark>.35:
            image,frame_crop=central_component(original);redactions=0
        else:
            # Extract ultrasound panels from a report screenshot; diagnostic prose stays outside the crop.
            scaled=original.convert('L').resize((200,max(1,round(original.height*200/original.width))))
            vals=list(scaled.getdata());runs=[];start=None
            for yy in range(scaled.height):
                ratio=sum(v<45 for v in vals[yy*200:(yy+1)*200])/200
                if ratio>.25 and start is None:start=yy
                if (ratio<=.25 or yy==scaled.height-1) and start is not None:
                    if yy-start>scaled.height*.065:runs.append((start,yy))
                    start=None
            if runs:
                a,b=max(runs,key=lambda r:r[1]-r[0]);y1=int(a*original.height/scaled.height);y2=int(b*original.height/scaled.height)
                if y2-y1>50:image=original.crop((0,y1,original.width,y2));frame_crop=[0,y1,original.width,y2];redactions=0
            # Photographic findings are not OCR text. Preserve tissue; no facial portraits are auto-approved.
            colors=original.resize((50,50)).getdata();saturated=sum(max(c)-min(c)>45 for c in colors)/2500
            if saturated>.35 and dark<.2:image=original;frame_crop=[0,0,original.width,original.height];redactions=0
        w,h=image.size
        # Reapply only confidently recognized textual annotations to the final crop.
        # Low-confidence OCR inside anatomy is not allowed to destroy tissue pixels.
        draw=ImageDraw.Draw(image)
        ox,oy=(frame_crop[0],frame_crop[1]) if frame_crop else (0,0)
        for line in lines.values():
            line_text=''.join(r['text'] for r in line)
            whole=bool(sensitive.search(line_text) or re.search(r'\d{7,}|(?:19|20)\d{2}[-/年]',line_text))
            for r in line:
                token=r['text'].strip();conf=float(r.get('conf','-1'))
                x,y,rw,rh=[int(r[k]) for k in ['left','top','width','height']];x-=ox;y-=oy
                letters=bool(re.search(r'[A-Za-z]{3,}|[\u4e00-\u9fff]{2,}',token))
                border=x<w*.25 or x+rw>w*.85 or y<h*.12 or y+rh>h*.9
                if whole or (letters and conf>(35 if border else 90)) or (re.search(r'\d{7,}',token) and conf>30):
                    if x+rw>0 and y+rh>0 and x<w and y<h:
                        draw.rectangle((max(0,x-2),max(0,y-2),min(w,x+rw+2),min(h,y+rh+2)),fill=(20,24,26));redactions+=1
        # Final small banner is explanatory and carries no diagnosis or source filename.
        canvas=Image.new('RGB',(w,h+28),(244,245,240));canvas.paste(image,(0,0))
        ImageDraw.Draw(canvas).text((8,h+8),'SOURCE IMAGE - REDACTED TEACHING COPY',fill=(45,65,57))
        buffer=io.BytesIO();canvas.save(buffer,format='PNG',optimize=True);output=buffer.getvalue();digest=hashlib.sha256(output).hexdigest()
        (DEST/f'{digest}.png').write_bytes(output)
        return {'sourceId':s['sourceId'],'sourceHash':source_hash,'processedHash':digest,'fileId':'training-media:'+digest,'testLabel':test_label,'width':w,'height':h,'redactionCount':redactions,'frameCrop':frame_crop,'status':'candidate','sourcePath':str(p),'member':member}
    except Exception as error:return {'sourceId':s['sourceId'],'status':'processing-failed','errorKind':type(error).__name__}

tasks=[(s,choice) for s in sources for choice in candidates(s)]
results=[]
with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(process,s,c) for s,c in tasks]
    for future in as_completed(futures):
        item=future.result()
        if item:results.append(item)
        if len(results)%20==0:
            (OUT/'media-candidates.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({'processed':len(results),'total':len(tasks)}),flush=True)
(OUT/'media-candidates.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'complete':True,'candidates':sum(r.get('status')=='candidate' for r in results),'sources':len(set(r['sourceId'] for r in results if r.get('status')=='candidate'))}),flush=True)
