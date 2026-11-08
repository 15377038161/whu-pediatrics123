"""Private Word case manuals from the same validated packages consumed by training."""
from pathlib import Path
from collections import defaultdict
import json,csv,hashlib,os
from io import BytesIO
from PIL import Image
from docx import Document
from docx.shared import Inches,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT=Path(os.environ.get('PEDIATRICS_TRAINING_DELIVERY_ROOT','deliverables/67-cases-20261107'));DOCS=ROOT/'word';DOCS.mkdir(exist_ok=True)
LIB=Path(os.environ.get('PEDIATRICS_TRAINING_PACKAGE_ROOT','knowledge/training-packages'))
index=json.loads((ROOT/'index.json').read_text(encoding='utf-8'))
font_name='宋体'
origins={'source':'原始记录','teaching-simulation':'教学模拟设定','reference':'教学参考说明'}
sections={'chiefComplaint':'主诉','presentIllness':'现病史','pastHistory':'既往史','personalHistory':'个人史','familyHistory':'家族史','physicalExam':'体格检查','auxiliaryTests':'辅助检查','preliminaryDiagnosis':'初步诊断','differentialDiagnosis':'鉴别诊断','treatmentPlan':'诊疗计划'}
tools={'inspection':'视诊','palpation':'触诊','percussion':'叩诊','stethoscope':'听诊器','axillary-thermometer':'腋下电子体温计','infrared-thermometer':'额温枪','tympanic-thermometer':'耳温计','bp-cuff':'儿童血压计','oximeter':'血氧仪','tongue-depressor':'压舌板','flashlight':'手电筒','otoscope':'耳镜','measuring-tape':'软尺','reflex-hammer':'叩诊锤'}
rubric_sections={'history':'问诊','exam':'查体','tests':'辅助检查','diagnosis':'诊断与鉴别','plan':'处置与治疗','note':'病历书写','communication':'沟通'}

def style_font(style,size,bold=False):
    style.font.name=font_name;style.font.size=Pt(size);style.font.bold=bold;style.font.color.rgb=RGBColor(0,0,0)
    style.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),font_name)
def para(doc,text,bold_label=None):
    p=doc.add_paragraph()
    if bold_label and text.startswith(bold_label):p.add_run(bold_label).bold=True;p.add_run(text[len(bold_label):])
    else:p.add_run(text)
    return p
def table(doc,headers,rows,widths=None):
    t=doc.add_table(rows=1,cols=len(headers));t.style='Table Grid';t.autofit=False
    for i,h in enumerate(headers):t.rows[0].cells[i].text=h
    if widths:
        for i,width in enumerate(widths):t.columns[i].width=Inches(width)
    trpr=t.rows[0]._tr.get_or_add_trPr();repeat=OxmlElement('w:tblHeader');repeat.set(qn('w:val'),'true');trpr.append(repeat)
    for row in rows:
        cells=t.add_row().cells
        for i,value in enumerate(row):cells[i].text=str(value)
    for row_index,row in enumerate(t.rows):
        cant=OxmlElement('w:cantSplit');row._tr.get_or_add_trPr().append(cant)
        for i,cell in enumerate(row.cells):
            if widths:cell.width=Inches(widths[i])
            for p in cell.paragraphs:
                p.paragraph_format.space_after=Pt(4);p.paragraph_format.space_before=Pt(4);p.paragraph_format.keep_with_next=len(t.rows)<=10 and row_index<len(t.rows)-1
                for r in p.runs:r.font.size=Pt(10)
    for c in t.rows[0].cells:
        for p in c.paragraphs:
            for r in p.runs:r.bold=True
    return t

def add_picture(doc,media):
    file_id=media['fileId']
    if not file_id.startswith('training-media:'):return
    p=LIB/'media'/(file_id.split(':',1)[1]+'.png')
    if not p.exists():return
    from PIL import Image
    im=Image.open(p);w,h=im.size
    width=min(6.4,5.4*w/h)
    doc.add_picture(str(p),width=Inches(width))
    cap=doc.add_paragraph(media['caption']);cap.paragraph_format.space_after=Pt(9)
    for run in cap.runs:run.font.size=Pt(9);run.italic=True

summary=[]
for entry in index:
    pack=json.loads((ROOT/'json'/(entry['filename']+'.json')).read_text(encoding='utf-8'))
    doc=Document();section=doc.sections[0]
    section.page_width=Inches(8.5);section.page_height=Inches(11);section.top_margin=Inches(.72);section.bottom_margin=Inches(.68);section.left_margin=Inches(.85);section.right_margin=Inches(.85)
    style_font(doc.styles['Normal'],11)
    doc.styles['Normal'].paragraph_format.line_spacing=1.3;doc.styles['Normal'].paragraph_format.space_after=Pt(5)
    for name,size in [('Title',22),('Heading 1',16),('Heading 2',13),('Heading 3',11)]:
        style_font(doc.styles[name],size,True);doc.styles[name].paragraph_format.space_before=Pt(12);doc.styles[name].paragraph_format.space_after=Pt(7)
        ppr=doc.styles[name].element.get_or_add_pPr()
        for border in list(ppr.findall(qn('w:pBdr'))):ppr.remove(border)
    header=section.header.paragraphs[0];header.text='珞珈儿科智训  病例教学与交互手册'
    for run in header.runs:run.font.size=Pt(9)
    footer=section.footer.paragraphs[0];footer.alignment=2;footer.add_run('第 ')
    field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field);footer.add_run(' 页')
    doc.add_paragraph(f'{entry["ordinal"]:02d} {pack["title"]}',style='Title')
    para(doc,'本手册将现有病例整理为可核对的教学事实、自然问诊内容、查体交互、检查材料、诊疗参考及分层评分。原始事实与补充设定分别标记；自动整理内容未医学审定，作为教学练习资料使用。')
    table(doc,['项目','内容'],[['年龄与性别',f'{pack["age"]}  {pack["sex"]}'],['主诉',pack['complaint']],['入口关系',{'independent':'独立来源','alias':'别名关联入口','subtype':'关联亚型入口'}[pack['relation']]],['关联说明',pack.get('relationNote','同一来源患者事实，不表示新增患者。')],['资料版本',pack['sourceVersion']],['教学版本',pack['version']],['评分口径','基础80分，提高20分；每点100%、50%、0%三档；不可评价项不算学生错误。']],[1.1,5.5])
    doc.add_heading('人物与交流设定',level=1)
    if pack.get('appearanceAssets'):
        asset=next((a for a in pack['appearanceAssets'] if a['posture']=='supine'),pack['appearanceAssets'][0])
        photo=Path('public')/asset['publicPath'].lstrip('/')
        if photo.exists():
            if photo.suffix.lower()=='.webp':
                compatible=BytesIO()
                Image.open(photo).save(compatible,format='PNG')
                compatible.seek(0)
                doc.add_picture(compatible,width=Inches(2.6))
            else:
                doc.add_picture(str(photo),width=Inches(2.6))
            para(doc,'通用虚拟示教形象，非原患者照片；不代表病理体征。体位、年龄档与性别用于交互匹配。')

    for key,label in [('appearance','形象与外观'),('caregiver','照护者'),('speaking','表达方式'),('cooperation','配合与动作'),('knowledgeBoundary','知情边界')]:
        para(doc,label+'：'+pack['persona'][key],label+'：')
    para(doc,'人物图为通用虚拟样板，不表现病历未记载的异常；实际精神、肤色、呼吸及运动表现以下文原记录为准。')
    doc.add_heading('参考病历与原始临床记录',level=1)
    para(doc,'以下保留原材料中的临床事实和诊疗经过。鉴别提示为另列教学补充；未记录事项不改成阴性或正常。')
    for key,label in sections.items():
        doc.add_heading(label,level=2)
        text=pack['referenceNote'].get(key,'')
        for line in text.splitlines() or ['原材料未单独记录。']:para(doc,line)
    doc.add_heading('自然问诊与可获得的信息',level=1)
    para(doc,'学生可以使用自己的措辞。追问结合上一轮主题理解，不要求逐字匹配。只记录实际回答出的事实；患儿不知情时由了解情况的照护者补充。')
    for q in pack['questions']:
        doc.add_heading(q['topic'],level=2)
        para(doc,'建议问法：'+q['prompt'],'建议问法：');para(doc,'其他问法：'+'；'.join(q['variants']),'其他问法：')
        para(doc,'连续追问：'+'；'.join(q['followups']),'连续追问：')
        para(doc,'家长可答：'+q['parentAnswer'],'家长可答：');para(doc,'患儿可答：'+q['childAnswer'],'患儿可答：')
        para(doc,'不能直接获得：'+q['unavailable'],'不能直接获得：')
        para(doc,'证据定位：'+'、'.join(q['factIds']),'证据定位：')
    doc.add_heading('查体部位与操作反馈',level=1)
    para(doc,'操作顺序为大部位、小部位、方法或器材、准备与体位、执行、观察和记录。局部示意的前后面切换不代表患者已改变体位；患者左右侧按界面标记识别。')
    grouped=defaultdict(list)
    for e in pack['exams']:
        # Same source observation is written once, with all applicable local selections named.
        key=(e['toolId'],e['evidenceCode'] if e['origin']=='source' else e['sourceLocator']+'|'+e['interpretation'],e['origin'],tuple(e.get('allowedPositions',e['postures'])))
        grouped[key].append(e)
    for number,group in enumerate(grouped.values(),1):
        e=group[0];sites='、'.join(dict.fromkeys(x['label'] for x in group))
        doc.add_heading(f'{number} {tools.get(e["toolId"],e["toolId"])}',level=2)
        para(doc,'适用定位：'+sites,'适用定位：');para(doc,'内容性质：'+origins[e['origin']],'内容性质：')
        para(doc,'准备与体位：完成手卫生、解释检查并采用'+'、'.join({'standing':'站立位','supine':'仰卧位','sitting':'坐位','lateral':'侧卧位','prone':'俯卧位'}[p] for p in e.get('allowedPositions',e['postures']))+'。','准备与体位：')
        para(doc,'操作要领：'+e['technique'],'操作要领：');para(doc,'患儿反应：'+e['reaction'],'患儿反应：')
        para(doc,'本例所见或补充设定：'+e['result'],'本例所见或补充设定：')
        para(doc,'一般正常参照与解释：'+e['interpretation'],'一般正常参照与解释：')
        if e['scope']=='whole-region':para(doc,'定位限制：原记录为整体描述。相关局部按钮可以引用该整体资料，但不能把整体异常自动判为每个局部都异常。')
    doc.add_heading('辅助检查与对应材料',level=1)
    para(doc,'检查时提供客观结果，不提前显示必要性或标准诊断。以下必要性说明供教师资料和训练结束后的反馈使用，不在开单前提示学生。')
    for test in pack['tests']:
        doc.add_heading(test['label'],level=2)
        para(doc,'常用名称：'+'、'.join(test['aliases'] or [test['label']]),'常用名称：')
        para(doc,'检查目的：'+test['objective'],'检查目的：');para(doc,'资料性质：'+origins[test['origin']],'资料性质：')
        for line in test['result'].splitlines():para(doc,line)
        if test.get('report') and test['report']['rows']:
            table(doc,['指标','原始结果','单位','原报告时点'],[[r['item'],r['value'],r['unit'],r['reportedAt']] for r in test['report']['rows']],[1.35,1.2,1.45,2.3])
        para(doc,'参考与局限：'+test['reference'],'参考与局限：')
        para(doc,'最终复盘依据：'+test['rationale'],'最终复盘依据：')
        for media in test['media'][:2]:add_picture(doc,media)
        if len(test['media'])>2:para(doc,'本项目其余图页保存在配套图片包和JSON中，可在训练检查记录中继续翻阅。')
    doc.add_heading('处置治疗与复评步骤',level=1)
    for step in pack['management']:
        doc.add_heading(step['title'],level=2);para(doc,'性质：'+origins[step['origin']]);para(doc,step['detail'])
    para(doc,'剂量安全：原文记载的数值保留为该病例既往诊疗记录。新的用药计算必须具备体重、途径、适应证和必要器官功能条件；缺少这些条件时不编造固定剂量，也不把历史方案直接当作所有患儿的处方。')
    doc.add_heading('逐步评分与可接受简答',level=1).paragraph_format.page_break_before=True
    table(doc,['环节','基础分','提高分','合计'],[['问诊',16,4,20],['查体',20,5,25],['辅助检查',8,2,10],['诊断与鉴别',12,3,15],['处置与治疗',16,4,20],['病历书写',4,1,5],['沟通',4,1,5],['合计',80,20,100]],[2.1,1.4,1.4,1.4])
    para(doc,'判分原则：核心意思准确且必要条件到位得本点满分；方向正确但缺必要限定得本点一半分；未答、错误或仅有空泛套话得0分。关键安全条件属于基础要求。不同要点独立计分，同一证据或错误不重复计分。')
    for section_name,label in rubric_sections.items():
        doc.add_heading(label,level=2)
        for point in [r for r in pack['rubric'] if r['section']==section_name]:
            para(doc,f'{point["label"]}  {point["maxScore"]:.2f}分  '+('基础要求' if point['level']=='basic' else '提高要求'))
            para(doc,'满分核心表达：'+point['fullAnswer'],'满分核心表达：');para(doc,'部分得分：'+point['partialAnswer'],'部分得分：')
            para(doc,'不得分：'+point['incorrectAnswer'],'不得分：')
            if point['evidenceCodes']:para(doc,'实际证据：'+'、'.join(point['evidenceCodes']))
    doc.add_heading('结束后的反馈内容',level=1)
    para(doc,'学生完成病历和诊疗提交后，报告逐项解释得分、关键遗漏及可接受简答；对检查区分必要、合理可选、重复或缺少指征，并说明应该优先获得什么证据。正常结果不等于检查多余，未申请不意味着必须补做全部项目。')
    para(doc,'报告同时列明原始记录、教学模拟与参考说明的使用情况。材料读取失败、未提供可核验结果或模拟图不能支持的细微识别能力，均不作为学生能力0分。')
    doc.add_heading('来源与使用说明',level=1)
    for ref in pack['references']:para(doc,ref['title']+'  '+ref['url']+'  核对日期 '+ref['accessedAt'])
    para(doc,'配套JSON：'+entry['filename']+'.json。其完整查体矩阵逐项保留位置、器材、动作、所见、来源和证据码；本Word对同一原记录的多个局部入口合并说明，避免把同一整体所见误作多份独立测量。')
    path=DOCS/(entry['filename']+'.docx');doc.save(path)
    summary.append({'ordinal':entry['ordinal'],'word':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'paragraphs':len(doc.paragraphs),'tables':len(doc.tables),'images':len(doc.inline_shapes)})
with (ROOT/'病例总索引.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.writer(f);writer.writerow(['序号','病例','关联类型','来源ID','原始版本','教学版本','Word','JSON'])
    for e in index:writer.writerow([e['ordinal'],e['title'],e['relation'],e['sourceId'],e['sourceVersion'],e['version'],'word/'+e['filename']+'.docx','json/'+e['filename']+'.json'])
(Path('outputs/training-20261107')/'document-build.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'documents':len(summary),'paragraphs':sum(r['paragraphs'] for r in summary),'pictures':sum(r['images'] for r in summary)}))
