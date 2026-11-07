"""Apply explicit visual selections to immutable hashes, never to unchecked folder contents."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib,io
OUT=Path('outputs/training-20261107');ROOT=Path('knowledge/training-packages')
records=json.loads((OUT/'media-review-order.json').read_text(encoding='utf-8'))
# Each choice was checked on the contact sheets. Uncertain crops, localizers,
# overmasked waveforms, noise maps and mismatched anatomical labels are excluded.
groups={
 '腹部超声':[0,6,7,10,11,21,22,23,27,51,52,53,71,77,162,173,174,182,184,185,188,207,218],
 '头颅MRI':[1,3,14,20,24,54,55,57,58,62,64,65,66,73,95,101,108,113,114,115,116,128,129,138,139,140,145,169,171,172,189],
 '脊髓MRI':[16,17,166,167],
 '腹部MRI':[45,48,177,179,181],
 '胸部CT':[4,30,36,38,78,80,91,93,98,102,110,193,194,198,205,214],
 '胸部X线':[33,37,40,74,85,118,121,122,131,134,141,212],
 '胸部超声':[208,209],
 '骨龄':[26],
 '心脏超声':[61,76,86,132,160,192,219],
 '心脏MRI':[68,70,72,152,153,157],
 '头颅CT':[149,154,156],
 '四肢X线':[176,178,180,220],
 '腹部CT':[99,111,191],
}
chosen={i:label for label,ids in groups.items() for i in ids}
mapped={};reviews=[];seen=set()
for i,item in enumerate(records):
    label=chosen.get(i)
    exam_site='skin' if i in [210,211] else None
    if not label and not exam_site:
        reviews.append({'sourceHash':item['sourceHash'],'processedHash':item['processedHash'],'decision':'excluded','reason':'未通过定位、可读性或去答案图核；保留原件，不向学生释放'})
        continue
    # Deduplicate identical source images within one source, keeping their exact provenance.
    key=(item['sourceId'],item['sourceHash'],label,exam_site)
    if key in seen:continue
    seen.add(key)
    media={'fileId':item['fileId'],'kind':'image','caption':('皮肤所见' if exam_site else label)+'原始材料去身份副本（局部关键图，不代表完整检查序列）'}
    if exam_site:media['examSite']=exam_site
    else:media['testLabel']=label
    mapped.setdefault(item['sourceId'],[]).append(media)
    reviews.append({'sourceHash':item['sourceHash'],'processedHash':item['processedHash'],'decision':'visual-checked','sourceId':item['sourceId'],'testLabel':label,'examSite':exam_site,'reviewScope':'定位、图面可读性和直接答案检查；不冒充专业医学判读'})

# Shared illustrative MRI is installed only on explicitly simulated normal-result requests.
im=Image.open(OUT/'normal-brain-mri-generated.png').convert('RGB');im.thumbnail((1100,1100))
canvas=Image.new('RGB',(im.width,im.height+85),(245,246,240));canvas.paste(im,(0,0));font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',25)
d=ImageDraw.Draw(canvas);d.text((20,im.height+12),'教学模拟影像  非原患者检查',font=font,fill=(38,70,57));d.text((20,im.height+45),'不用于细微影像征象评分',font=font,fill=(85,101,92))
buf=io.BytesIO();canvas.save(buf,format='PNG',optimize=True);raw=buf.getvalue();digest=hashlib.sha256(raw).hexdigest();(ROOT/'media'/f'{digest}.png').write_bytes(raw)
(OUT/'simulated-media.json').write_text(json.dumps({'normalBrainMRI':{'fileId':'training-media:'+digest,'kind':'image','caption':'头颅MRI教学模拟图 非原患者检查 不用于细微征象评分'}},ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'processed-media.json').write_text(json.dumps(mapped,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'media-visual-review.json').write_text(json.dumps(reviews,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'boundImages':sum(len(x) for x in mapped.values()),'sourceCases':len(mapped),'excludedCandidates':sum(x['decision']=='excluded' for x in reviews)}))
