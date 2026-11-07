"""Private post-processing QA. OCR findings are kept locally, never printed."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import hashlib,json,re,subprocess
OUT=Path('outputs/training-20261107');ROOT=Path('knowledge/training-packages')
mapped=json.loads((OUT/'processed-media.json').read_text(encoding='utf-8'))
images={m['fileId'] for group in mapped.values() for m in group}
def inspect(file_id):
    digest=file_id.split(':')[1];p=ROOT/'media'/f'{digest}.png';raw=p.read_bytes();im=Image.open(p)
    result={'fileId':file_id,'hashValid':hashlib.sha256(raw).hexdigest()==digest,'pngValid':im.format=='PNG','underLimit':len(raw)<3_000_000,'dimensions':im.size}
    ocr=subprocess.run(['D:/Tesseract-OCR/tesseract.exe',str(p),'stdout','-l','chi_sim+eng','--psm','11'],capture_output=True,timeout=30)
    text=ocr.stdout.decode('utf-8',errors='replace')
    flags=[]
    if re.search(r'姓名|住院号|身份证|病案号|患者姓名|Patient\s*Name|Birth|DOB|Hospital|Impression|Conclusion|影像诊断|出院诊断',text,re.I):flags.append('identity_or_conclusion_label')
    if re.search(r'(?<!\d)\d{8,}(?!\d)',text):flags.append('long_numeric_identifier_candidate')
    result['flags']=flags
    if flags:result['privateOcrText']=text
    return result
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(inspect,sorted(images)))
(OUT/'media-postcheck.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'images':len(results),'invalid':sum(not(r['hashValid'] and r['pngValid'] and r['underLimit']) for r in results),'flaggedForReview':sum(bool(r['flags']) for r in results)}))
