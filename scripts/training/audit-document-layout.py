"""All-page PDF bounds check plus reproducible visual-review sheets; never prints clinical text."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,subprocess,xml.etree.ElementTree as ET
from pypdf import PdfReader
from PIL import Image,ImageDraw,ImageFont

ROOT=Path('outputs/training-20261107/docx-qa');OUT=Path('outputs/training-20261107/visual-qa');OUT.mkdir(exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)
def inspect(folder):
    ordinal=int(folder.name);pdf=next(folder.glob('*.pdf'));reader=PdfReader(pdf)
    result={'ordinal':ordinal,'pages':len(reader.pages),'outOfPageWords':0,'totalWords':0,'glyphBoxPages':[],'samplePages':{'first':1}}
    phrases={'tests':'辅助检查与对应材料','rubric':'逐步评分与可接受简答'}
    positioned=subprocess.run(['pdftotext','-layout',str(pdf),'-'],capture_output=True,timeout=120).stdout.decode('utf-8',errors='replace').split('\f')
    for i,page_text in enumerate(positioned,1):
        compact=''.join(page_text.split())
        for key,phrase in phrases.items():
            if key not in result['samplePages'] and (phrase in compact or key=='rubric' and '逐步' in compact and '合计' in compact):result['samplePages'][key]=i
    for i,page in enumerate(reader.pages,1):
        text=page.extract_text() or '';compact=''.join(text.split())
        for key,phrase in phrases.items():
            if key not in result['samplePages'] and phrase in compact:result['samplePages'][key]=i
        if '\ufffd' in text:result['glyphBoxPages'].append(i)
    bbox=subprocess.run(['pdftotext','-bbox',str(pdf),'-'],capture_output=True,timeout=120)
    xml=ET.fromstring(bbox.stdout)
    for page in xml.iter():
        if not page.tag.endswith('page'):continue
        w=float(page.attrib['width']);h=float(page.attrib['height'])
        for word in page.iter():
            if not word.tag.endswith('word'):continue
            result['totalWords']+=1
            a=word.attrib
            if float(a['xMin'])<-.1 or float(a['yMin'])<-.1 or float(a['xMax'])>w+.1 or float(a['yMax'])>h+.1:result['outOfPageWords']+=1
    return result
folders=sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name.isdigit())
with ThreadPoolExecutor(max_workers=2) as pool:records=list(pool.map(inspect,folders))
(OUT/'bounds-audit.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
samples=[]
for purpose in ['first','tests','rubric']:
    for record in records:
        number=record['samplePages'].get(purpose)
        if not number:continue
        folder=ROOT/f'{record["ordinal"]:02}';pages={int(p.stem.split('-')[-1]):p for p in folder.glob('page-*.png')}
        samples.append({'ordinal':record['ordinal'],'purpose':purpose,'page':number,'path':str(pages[number])})
(OUT/'sample-pages.json').write_text(json.dumps(samples,indent=2),encoding='utf-8')
for start in range(0,len(samples),16):
    sheet=Image.new('RGB',(1080,1480),(220,225,218));d=ImageDraw.Draw(sheet)
    for i,sample in enumerate(samples[start:start+16]):
        im=Image.open(sample['path']).convert('RGB');im.thumbnail((250,335));x=(i%4)*270+10;y=(i//4)*370+25
        sheet.paste(im,(x,y));d.text((x,y-21),f'{sample["ordinal"]:02} {sample["purpose"]} p{sample["page"]}',font=font,fill='black')
    sheet.save(OUT/f'review-{start//16+1:02}.jpg',quality=88)
print(json.dumps({'documents':len(records),'pages':sum(r['pages'] for r in records),'outOfPageWords':sum(r['outOfPageWords'] for r in records),'glyphFlaggedPages':sum(len(r['glyphBoxPages']) for r in records),'reviewSamples':len(samples)}))
