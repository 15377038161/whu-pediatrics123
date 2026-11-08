"""Render already fixed objective results; never invent numbers or diagnostic conclusions."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib,os
ROOT=Path(os.environ.get('PEDIATRICS_TRAINING_PACKAGE_ROOT','knowledge/training-packages'))
OUT=Path(os.environ.get('PEDIATRICS_TRAINING_AUTHORING_ROOT','outputs/training-20261107'))
OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',24);small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',19);bold=ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc',31)
index=json.loads((ROOT/'index.json').read_text(encoding='utf-8'));mapped={};cache={};count=0
def wrap(text,draw,max_width=1050):
    lines=[]
    for paragraph in text.splitlines():
        current=''
        for char in paragraph:
            if draw.textlength(current+char,font=font)>max_width:lines.append(current);current=char
            else:current+=char
        lines.append(current)
    return lines
for version in index['entries'].values():
    pack=json.loads((ROOT/'packages'/f'{version}.json').read_text(encoding='utf-8'))
    for test in pack['tests']:
        key=pack['sourceId']+':'+test['label']
        if key in cache:continue
        probe=ImageDraw.Draw(Image.new('RGB',(1,1)));lines=wrap(test['result']+'\n'+test['reference'],probe)
        images=[]

        report=test.get('report')
        if report and report.get('rows'):
            for table_page in range((len(report['rows'])+15)//16):
                rows=report['rows'][table_page*16:table_page*16+16];height=290+len(rows)*54
                im=Image.new('RGB',(1160,height),(250,251,247));d=ImageDraw.Draw(im)
                d.rectangle((0,0,1160,100),fill=(31,78,65));d.text((40,27),test['label']+' 原始数值表',font=bold,fill='white')
                d.text((40,119),'原始报告逐项摘录  非新增测量；完整原文另列',font=small,fill=(110,81,51))
                xs=[40,240,450,710,1120];top=162;d.rectangle((40,top,1120,top+44),fill=(224,236,224))
                for i,label in enumerate(['指标','原始结果','单位','原报告时点']):d.text((xs[i]+10,top+10),label,font=small,fill=(30,65,48))
                y=top+44
                for row in rows:
                    d.line((40,y+54,1120,y+54),fill=(201,216,202),width=1)
                    for i,key_name in enumerate(['item','value','unit','reportedAt']):d.text((xs[i]+10,y+14),row[key_name],font=small,fill=(30,48,42))
                    y+=54
                for x in xs:d.line((x,top,x,y),fill=(201,216,202),width=1)
                d.text((40,y+17),'参考范围与样本条件见对应文字报告，不将参考值当作患者结果。',font=small,fill=(78,100,84))
                d.text((40,height-35),'原始数值表  第 '+str(table_page+1)+' 页',font=small,fill=(78,100,84))
                import io
                buf=io.BytesIO();im.save(buf,format='PNG',optimize=True);raw=buf.getvalue();digest=hashlib.sha256(raw).hexdigest();(ROOT/'media'/f'{digest}.png').write_bytes(raw)
                images.append({'testLabel':test['label'],'fileId':'training-media:'+digest,'kind':'image','caption':test['label']+'原始数值表 第'+str(table_page+1)+'页（固定版本摘录）'});count+=1
        for page in range((len(lines)+19)//20):
            content=lines[page*20:page*20+20];height=max(400,230+len(content)*43)
            im=Image.new('RGB',(1160,height),(250,251,247));d=ImageDraw.Draw(im)
            d.rectangle((0,0,1160,105),fill=(31,78,65));d.text((40,28),test['label']+' 检查信息',font=bold,fill='white')
            origin={'source':'原始结果重新排版','teaching-simulation':'教学模拟结果 非患者原报告','reference':'教学参考说明 非患者测量值'}[test['origin']]
            d.text((42,124),origin,font=small,fill=(110,81,51))
            for row,line in enumerate(content):d.text((42,167+row*43),line,font=font,fill=(30,48,42))
            d.text((42,height-37),f'教学训练材料  第 {page+1} 页  不含诊断答案与身份信息',font=small,fill=(92,109,98))
            import io
            buf=io.BytesIO();im.save(buf,format='PNG',optimize=True);raw=buf.getvalue();digest=hashlib.sha256(raw).hexdigest()
            (ROOT/'media'/f'{digest}.png').write_bytes(raw)
            images.append({'testLabel':test['label'],'fileId':'training-media:'+digest,'kind':'image','caption':f'{test["label"]}报告信息 第{page+1}页（{origin}）'})
            count+=1
        cache[key]=images;mapped.setdefault(pack['sourceId'],[]).extend(images)
(OUT/'report-media.json').write_text(json.dumps(mapped,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'report_pages':count,'sourceCases':len(mapped)}))
