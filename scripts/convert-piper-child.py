"""PIPER 6YO bone surfaces -> GLB. Model derivatives retain upstream GPLv3+ terms.
Usage: python scripts/convert-piper-child.py outputs/piper-child
No reshaping, age scaling, artificial bones or medical simulation is performed.
"""
import sys, json, struct, re, hashlib, zipfile
from pathlib import Path
from collections import defaultdict, Counter
import numpy as np

root=Path(sys.argv[1]); source=root/'PIPER_ChildModel_6YO'
out=Path('public/models/anatomy'); out.mkdir(parents=True,exist_ok=True)
parts={}
for file in source.glob('*.k'):
    lines=[x.strip() for x in file.read_text(errors='replace').splitlines() if x.strip() and not x.lstrip().startswith('$')]
    for i,line in enumerate(lines):
        if line=='*PART': parts[int(lines[i+2].split()[0])]=lines[i+1]
chosen={pid:name for pid,name in parts.items() if '_BO_' in name}
nodes={}; shells=defaultdict(list); solids=defaultdict(list); state=''; skip=0
mesh_text='\n'.join((source/name).read_text() for name in ('mesh_PIPER_Body.k','main_Head_Skull.k','main_Neck.k'))
for line in mesh_text.splitlines():
    if not line.strip() or line.startswith('$'): continue
    if line.startswith('*'): state=line.strip();skip=0;continue
    if state=='*NODE':
        # LS-DYNA node fields use 8 + 3*16 columns, even when no whitespace separates floats.
        nodes[int(line[:8])]=[float(line[8:24]),float(line[24:40]),float(line[40:56])]
    elif state in ('*ELEMENT_SOLID','*ELEMENT_SHELL','*ELEMENT_SHELL_THICKNESS'):
        if skip: skip=0;continue
        values=[int(line[i:i+8]) for i in range(0,len(line.rstrip()),8) if line[i:i+8].strip()]
        if state=='*ELEMENT_SHELL_THICKNESS': skip=1
        if len(values)<6 or values[1] not in chosen: continue
        (solids if state=='*ELEMENT_SOLID' else shells)[values[1]].append(values[2:10] if state=='*ELEMENT_SOLID' else values[2:6])

def exterior(elements):
    faces={};counts=Counter()
    for n in elements:
        # Hexahedron faces; degenerate repeated nodes are reduced to triangles.
        for ids in ((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):
            f=list(dict.fromkeys(n[i] for i in ids));key=tuple(sorted(f))
            if len(f)>=3: faces[key]=f;counts[key]+=1
    return [faces[k] for k,count in counts.items() if count==1]

def region(name):
    if name.startswith('HE_'):return 'skull'
    if name.startswith('NK_') or re.search(r'TX_BO_[TL]\d',name):return 'spine'
    if name.startswith('PV_'):return 'pelvis'
    if name.startswith('UX_'):return 'left-arm' if '_L_' in name else 'right-arm'
    if name.startswith('LX_'):return 'left-leg' if '_L_' in name else 'right-leg'
    return 'thorax'

labels={'skull':'颅骨','spine':'脊柱','pelvis':'骨盆','left-arm':'左上肢','right-arm':'右上肢','left-leg':'左下肢','right-leg':'右下肢','thorax':'胸廓'}
translations={'Humerus':'肱骨','Forearm':'前臂骨','Hand':'手骨','Femur':'股骨','Tibia':'胫骨','Fibula':'腓骨','Foot':'足骨','Patella':'髌骨','Scapula':'肩胛骨','Clavicle':'锁骨','Sternum':'胸骨','Ribs':'肋骨','Pelvis':'骨盆','Sacrum':'骶骨','CranialSuture':'颅缝','SkullDiploe':'颅骨板障','InternalTable':'颅骨内板','ExternalTable':'颅骨外板'}
blob=bytearray();views=[];accessors=[];meshes=[];gltf_nodes=[];manifest=[]
def accessor(array,component,typ,target):
    while len(blob)%4:blob.append(0)
    offset=len(blob);blob.extend(array.tobytes());views.append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes,'target':target})
    a={'bufferView':len(views)-1,'componentType':component,'count':len(array),'type':typ}
    if typ=='VEC3':a.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    accessors.append(a);return len(accessors)-1
for pid,name in sorted(chosen.items()):
    faces=shells.get(pid) or exterior(solids[pid])
    triangles=[]
    for f in faces:
        f=list(dict.fromkeys(f))
        if len(f)>=3:triangles.extend((f[0],f[i],f[i+1]) for i in range(1,len(f)-1))
    if not triangles:continue
    used=sorted(set(n for t in triangles for n in t));lookup={n:i for i,n in enumerate(used)}
    # Z-up millimetres -> Y-up metres: no geometry/proportion changes.
    pos=np.array([[nodes[n][1]/1000,nodes[n][2]/1000,nodes[n][0]/1000] for n in used],dtype='<f4')
    idx=np.array([[lookup[n] for n in t] for t in triangles],dtype='<u4')
    normals=np.zeros_like(pos)
    for face in idx:
        normal=np.cross(pos[face[1]]-pos[face[0]],pos[face[2]]-pos[face[0]])
        for n in face:normals[n]+=normal
    lengths=np.linalg.norm(normals,axis=1);normals/=np.maximum(lengths[:,None],1e-12)
    p=accessor(pos,5126,'VEC3',34962);n=accessor(normals.astype('<f4'),5126,'VEC3',34962);i=accessor(idx.flatten(),5125,'SCALAR',34963)
    r=region(name);label=next((v for k,v in translations.items() if k in name),labels[r])
    vertebra=re.search(r'_([CTL]\d+)_',name)
    if vertebra:label=vertebra[1]+'椎骨'
    if '_L_' in name:label+='（左）'
    elif '_R_' in name:label+='（右）'
    suffix='骨骺' if 'Epiph' in name else '干骺端' if 'Metaph' in name else '骨干' if 'Diaph' in name else ''
    label+=('近端' if 'Proximal' in name else '远端' if 'Distal' in name else '')+suffix
    item={'id':str(pid),'label':label,'region':r,'sourcePart':name,'triangles':len(idx)};manifest.append(item)
    meshes.append({'name':name,'primitives':[{'attributes':{'POSITION':p,'NORMAL':n},'indices':i,'material':0}]})
    gltf_nodes.append({'name':'part-'+str(pid),'mesh':len(meshes)-1,'extras':item})
doc={'asset':{'version':'2.0','generator':'PIPER 6YO surface extraction','copyright':'PIPER project contributors; GPLv3 + liability/open science clauses'},'scene':0,'scenes':[{'nodes':list(range(len(gltf_nodes)))}],'nodes':gltf_nodes,'meshes':meshes,'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.88,.82,.7,1],'metallicFactor':0,'roughnessFactor':.65}}],'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':accessors}
j=json.dumps(doc,separators=(',',':')).encode();j+=b' ' *((-len(j))%4);blob.extend(b'\0'*((-len(blob))%4))
glb=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(blob))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(blob),0x004e4942)+blob
(out/'piper-child-6yo.glb').write_bytes(glb)
(out/'manifest.json').write_text(json.dumps({'age':6,'posture':'原始研究模型姿势','parts':manifest,'regions':labels,'meshSha256':hashlib.sha256(glb).hexdigest()},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Corresponding source is supplied together with derived mesh, not fetched at runtime.
with zipfile.ZipFile(out/'piper-corresponding-source.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for file in source.rglob('*'):
        if file.is_file():archive.write(file,'PIPER_ChildModel_6YO/'+str(file.relative_to(source)))
    for name in ('LICENSE','License_gpl-3.0.txt','README.md'):archive.write(root/name,name)
    archive.write(__file__,'convert-piper-child.py')
print(json.dumps({'parts':len(manifest),'triangles':sum(x['triangles'] for x in manifest),'glbBytes':len(glb)}))
