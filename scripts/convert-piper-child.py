"""PIPER 6YO bone surfaces -> GLB (v2). Model derivatives retain upstream GPLv3+ terms.
Usage: python scripts/convert-piper-child.py outputs/piper-child

v2 changes (2026-10-20), all derived from source topology only -- no invented geometry:
- Prefer 3D when both 2D/3D representations exist. These are not assumed identical:
  audit-anatomy-completeness.py records surface differences for specialist review.
- Drop LS-DYNA rigid connector patches (per-rib *_Rib*_2D_Rigid ~1cm patches and
  TX_BO_Sternum_2D_rigid): they are FE connection artifacts, NOT ribs/sternum.
- Split merged meshes along source connected components (lossless topology split):
  * TX_BO_Ribs_3D -> 22 individual ribs, numbered by 1:1 nearest match against the
    rigid rib patches (authoritative Rib1-11 L/R naming), cross-validated against
    superior->inferior centroid ordering and left/right X sign. Fails loudly on mismatch.
  * PV_BO_Pelvis_3D -> 6 connected surfaces with inferred ilium/ischium/pubis labels.
    Spatial naming rules are provisional, NOT medical approval.
  * UX_BO_*_Forearm_2D -> radius/ulna using source-defined radius styloid node sets.
- Hand (19 comps) / foot (18 comps) components do NOT map 1:1 to the 27/26 anatomical
  bones, so they stay merged and are honestly labelled as merged meshes (no fake names).
- Vertebra multi-components are body+processes of ONE bone -> never split.
- Region fix: lumbar AB_BO_L1..L5 belong to 'spine' (was wrongly 'thorax').
No reshaping, age scaling, artificial bones or medical simulation is performed.
"""
import sys, json, struct, re, hashlib, zipfile
from pathlib import Path
from collections import defaultdict, Counter
import numpy as np

root=Path(sys.argv[1]); source=root/'PIPER_ChildModel_6YO'
age=re.search(r'<anthropometry name="age">.*?<value>(.*?)</value>',(source/'Child_model.pmr').read_text(encoding='utf-8',errors='replace'),re.S)
if not age or float(age.group(1))!=6: raise ValueError('Only verified 6-year-old source is supported')
out=Path('public/models/anatomy'); out.mkdir(parents=True,exist_ok=True)
parts={}; part_files={}
for file in sorted(source.glob('*.k')):
    lines=[x.strip() for x in file.read_text(encoding='utf-8',errors='replace').splitlines() if x.strip() and not x.lstrip().startswith('$')]
    for i,line in enumerate(lines):
        if line=='*PART':
            pid=int(lines[i+2].split()[0])
            if pid in parts: raise ValueError(f'Duplicate part definition: {pid}')
            parts[pid]=lines[i+1];part_files[pid]=file.name
chosen={pid:name for pid,name in parts.items() if '_BO_' in name}
nodes={}; shells=defaultdict(list); solids=defaultdict(list); state=''; skip=0
mesh_files=sorted({'mesh_PIPER_Body.k',*(part_files[pid] for pid in chosen)})
mesh_text='\n'.join((source/name).read_text(encoding='utf-8',errors='replace') for name in mesh_files)
for line in mesh_text.splitlines():
    if not line.strip() or line.startswith('$'): continue
    if line.startswith('*'): state=line.strip();skip=0;continue
    if state=='*NODE':
        # LS-DYNA node fields use 8 + 3*16 columns, even when no whitespace separates floats.
        nid=int(line[:8]);xyz=[float(line[8:24]),float(line[24:40]),float(line[40:56])]
        if nid in nodes and not np.allclose(nodes[nid],xyz,atol=1e-8,rtol=0):raise ValueError(f'Conflicting node: {nid}')
        nodes[nid]=xyz
    elif state in ('*ELEMENT_SOLID','*ELEMENT_SHELL','*ELEMENT_SHELL_THICKNESS'):
        if skip: skip=0;continue
        values=[int(line[i:i+8]) for i in range(0,len(line.rstrip()),8) if line[i:i+8].strip()]
        if state=='*ELEMENT_SHELL_THICKNESS': skip=1
        if len(values)<6 or values[1] not in chosen: continue
        (solids if state=='*ELEMENT_SOLID' else shells)[values[1]].append(values[2:10] if state=='*ELEMENT_SOLID' else values[2:6])

# --- v2: classify parts -------------------------------------------------------
RIB_PATCH=re.compile(r'_Rib\d+_2D_Rigid$')
def is_patch(name):
    """LS-DYNA rigid connector artifacts (~1cm), not real bone geometry."""
    return bool(RIB_PATCH.search(name)) or name=='TX_BO_Sternum_2D_rigid'
def norm_key(name):
    """Anatomical identity: strip representation suffixes (_2D/_3D/_Rigid/_rigid)."""
    k=re.sub(r'_(2[Dd]|3[Dd])(_[Rr]igid)?$','',name)
    return re.sub(r'_[Rr]igid$','',k)
by_key=defaultdict(list)
for pid,name in chosen.items():
    if is_patch(name): continue
    by_key[norm_key(name)].append((pid,name))
selected={}   # pid -> name (one representation per anatomical bone)
patches={}    # pid -> name (kept only as rib numbering ground truth)
for pid,name in chosen.items():
    if is_patch(name): patches[pid]=name
for key,items in by_key.items():
    solid=[it for it in items if '_3D' in it[1]]
    pick=(solid or sorted(items))[0]
    selected[pick[0]]=pick[1]

def exterior(elements):
    faces={};counts=Counter()
    for n in elements:
        # Hexahedron faces; degenerate repeated nodes are reduced to triangles.
        for ids in ((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):
            f=list(dict.fromkeys(n[i] for i in ids));k=tuple(sorted(f))
            if len(f)>=3: faces[k]=f;counts[k]+=1
    return [faces[k] for k,count in counts.items() if count==1]

def triangulate(faces):
    triangles=[]
    for f in faces:
        f=list(dict.fromkeys(f))
        if len(f)>=3: triangles.extend((f[0],f[i],f[i+1]) for i in range(1,len(f)-1))
    return triangles

def part_geometry(pid):
    """Return (positions Nx3 float64 in GLB metres Y-up, triangles Mx3 int)."""
    faces=shells.get(pid) or exterior(solids[pid])
    triangles=triangulate(faces)
    if not triangles: return None,None
    used=sorted(set(n for t in triangles for n in t));lookup={n:i for i,n in enumerate(used)}
    # Z-up millimetres -> Y-up metres: no geometry/proportion changes.
    pos=np.array([[nodes[n][1]/1000,nodes[n][2]/1000,nodes[n][0]/1000] for n in used],dtype=np.float64)
    idx=np.array([[lookup[n] for n in t] for t in triangles],dtype=np.int64)
    return pos,idx

def connected_components(n,idx):
    parent=list(range(n))
    def find(x):
        while parent[x]!=x: parent[x]=parent[parent[x]];x=parent[x]
        return x
    for a,b,c in idx:
        ra,rb,rc=find(int(a)),find(int(b)),find(int(c))
        if ra!=rb: parent[ra]=rb
        if find(int(a))!=rc: parent[find(int(a))]=rc
    groups=defaultdict(list)
    for v in range(n): groups[find(v)].append(v)
    return [np.array(g) for g in groups.values()]

def submesh(pos,idx,verts):
    keep=np.zeros(len(pos),dtype=bool);keep[verts]=True
    sel=np.all(keep[idx],axis=1)
    sub=idx[sel]
    remap=-np.ones(len(pos),dtype=np.int64);remap[verts]=np.arange(len(verts))
    return np.ascontiguousarray(pos[verts]),remap[sub]

def centroid(pos,idx,name):
    # area-weighted centroid of triangles for robust part centroids
    tri=pos[idx]
    w=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)
    c=(tri.mean(axis=1)*w[:,None]).sum(axis=0)/max(w.sum(),1e-12)
    return c

# --- v2: rib numbering ground truth from rigid patches ------------------------
def rib_assignment(rib_pos,rib_idx,patch_centroids):
    """Match 22 rib components 1:1 to numbered rigid patches; cross-check Y order."""
    comps=connected_components(len(rib_pos),rib_idx)
    if len(comps)!=22: raise ValueError(f'Ribs_3D must have 22 components, got {len(comps)}')
    cc=[rib_pos[c].mean(axis=0) for c in comps]
    used={}
    for pname,pc in patch_centroids.items():
        dists=sorted(((np.linalg.norm(cc[i]-pc),i) for i in range(22) if i not in used.values()))
        if not dists: raise ValueError('rib patch matching exhausted components')
        d,i=dists[0]
        if d>0.10: raise ValueError(f'rib patch {pname} too far from nearest component ({d:.3f}m)')
        used[pname]=i
    if len(set(used.values()))!=22: raise ValueError('rib patch matching is not 1:1')
    # cross-validation: per side, component superior->inferior order must equal rib 1..11
    result={}
    for pname,ci in used.items():
        m=re.search(r'_(L|R)_Rib(\d+)_',pname);side,num=m.group(1),int(m.group(2))
        result[ci]=(side,num)
    for side in ('L','R'):
        items=[(ci,num) for ci,(s,num) in result.items() if s==side]
        yorder=[num for ci,num in sorted(items,key=lambda t:-cc[t[0]][1])]
        if yorder!=list(range(1,12)): raise ValueError(f'rib Y-order cross-check failed for {side}: {yorder}')
        xs=[cc[ci][0] for ci,_ in items]
        if side=='L' and not all(x>0 for x in xs): raise ValueError('left ribs must have X>0')
        if side=='R' and not all(x<0 for x in xs): raise ValueError('right ribs must have X<0')
    return comps,result

# --- v2: pelvis component identification (ilium/pubis/ischium per side) -------
def pelvis_assignment(pos,idx):
    comps=connected_components(len(pos),idx)
    if len(comps)!=6: raise ValueError(f'Pelvis_3D must have 6 components, got {len(comps)}')
    info=[(c,pos[c].mean(axis=0)) for c in comps]
    left=[t for t in info if t[1][0]>0];right=[t for t in info if t[1][0]<0]
    if len(left)!=3 or len(right)!=3: raise ValueError('pelvis components not symmetric L/R')
    result={}
    for side,items in (('L',left),('R',right)):
        by_y=sorted(items,key=lambda t:-t[1][1])
        ilium=by_y[0]
        rest=by_y[1:]
        # pubis is the anterior pair member (largest mean Z); ischium postero-inferior
        pub,isch=max(rest,key=lambda t:t[1][2]),min(rest,key=lambda t:t[1][2])
        if pub is isch: raise ValueError('pubis/ischium identification degenerate')
        result[id(ilium[0])]=(side,'髂骨');result[id(pub[0])]=(side,'耻骨');result[id(isch[0])]=(side,'坐骨')
    return comps,result

def forearm_assignment(pos,idx,side):
    comps=connected_components(len(pos),idx)
    if len(comps)!=2: raise ValueError(f'Forearm must have 2 components, got {len(comps)}')
    # Use upstream named landmark rather than guessing anatomy from current pose.
    lines=[line.strip() for line in (source/'landmarks_ISB.k').read_text(encoding='utf-8').splitlines()
           if line.strip() and not line.lstrip().startswith('$')]
    title=f'Styloid_process_of_{"left" if side=="L" else "right"}_radius'
    landmark=int(lines[lines.index(title)+2].split()[0])
    coordinate=nodes[landmark]
    target=np.array([coordinate[1],coordinate[2],coordinate[0]])/1000
    candidates=[c for c in comps if np.any(np.linalg.norm(pos[c]-target,axis=1)<1e-8)]
    if len(candidates)!=1: raise ValueError(f'Radius source landmark is ambiguous/missing: {title}')
    radius=candidates[0]
    ulna=next(c for c in comps if c is not radius)
    return [(radius,f'桡骨（{"左" if side=="L" else "右"}）'),(ulna,f'尺骨（{"左" if side=="L" else "右"}）')]

def region(name):
    if name.startswith('HE_'):return 'skull'
    if name.startswith('NK_') or re.search(r'TX_BO_[TL]\d',name):return 'spine'
    if re.match(r'AB_BO_L\d',name):return 'spine'   # v2 fix: lumbar vertebrae are spine
    if name.startswith('PV_'):return 'pelvis'
    if name.startswith('UX_') or 'Scapula' in name or 'Clavicle' in name:return 'left-arm' if '_L_' in name else 'right-arm'
    if name.startswith('LX_'):return 'left-leg' if '_L_' in name else 'right-leg'
    return 'thorax'

labels={'skull':'颅骨','spine':'脊柱','pelvis':'骨盆','left-arm':'左上肢','right-arm':'右上肢','left-leg':'左下肢','right-leg':'右下肢','thorax':'胸廓'}
translations={'Humerus':'肱骨','Forearm':'前臂骨','Hand':'手骨','Femur':'股骨','Tibia':'胫骨','Fibula':'腓骨','Foot':'足骨','Patella':'髌骨','Scapula':'肩胛骨','Clavicle':'锁骨','Sternum':'胸骨','Ribs':'肋骨','Pelvis':'骨盆','Sacrum':'骶骨','CranialSuture':'颅缝','SkullDiploe':'颅骨板障','InternalTable':'颅骨内板','ExternalTable':'颅骨外板'}
def part_label(name):
    r=region(name);label=next((v for k,v in translations.items() if k in name),labels[r])
    vertebra=re.search(r'_([CTL]\d+)_',name)
    if vertebra:label=vertebra[1]+'椎骨'
    rib=re.search(r'_Rib(\d+)_',name)
    if rib:label=f'第{rib.group(1)}肋骨'
    if '_L_' in name:label+='（左）'
    elif '_R_' in name:label+='（右）'
    suffix='骨骺' if 'Epiph' in name else '干骺端' if 'Metaph' in name else '骨干' if 'Diaph' in name else ''
    label+=('近端' if 'Proximal' in name else '远端' if 'Distal' in name else '')+suffix
    if name.endswith('_Hand_2D'):label='手骨（%s）'%('左' if '_L_' in name else '右')
    if name.endswith('_Foot_2D_Rigid'):label='足骨（%s）'%('左' if '_L_' in name else '右')
    return label

# --- emit meshes --------------------------------------------------------------
blob=bytearray();views=[];accessors=[];meshes=[];gltf_nodes=[];manifest=[]
def accessor(array,component,typ,target):
    while len(blob)%4:blob.append(0)
    offset=len(blob);blob.extend(array.tobytes());views.append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes,'target':target})
    a={'bufferView':len(views)-1,'componentType':component,'count':len(array),'type':typ}
    if typ=='VEC3':a.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    accessors.append(a);return len(accessors)-1

def emit(pid_str,name,pos,idx,label,region_id,surface_kind,split_from=None):
    normals=np.zeros_like(pos);fallback=np.zeros_like(pos)
    for face in idx:
        normal=np.cross(pos[face[1]]-pos[face[0]],pos[face[2]]-pos[face[0]])
        for n in face:
            normals[n]+=normal
            if np.linalg.norm(normal)>1e-12:fallback[n]=normal
    lengths=np.linalg.norm(normals,axis=1)
    # 相反绕序的相邻面可能抵消法线；只修正渲染法线，不更改骨骼顶点。
    weak=lengths<1e-12;normals[weak]=fallback[weak]
    lengths=np.linalg.norm(normals,axis=1)
    if np.any(lengths<1e-12):raise ValueError(f'No valid normal for part {pid_str}')
    normals/=lengths[:,None]
    p=accessor(np.ascontiguousarray(pos,dtype='<f4'),5126,'VEC3',34962)
    n=accessor(np.ascontiguousarray(normals,dtype='<f4'),5126,'VEC3',34962)
    i=accessor(np.ascontiguousarray(idx.flatten(),dtype='<u4'),5125,'SCALAR',34963)
    item={'id':str(pid_str),'label':label,'region':region_id,'sourcePart':name,'surfaceKind':surface_kind,'triangles':int(len(idx))}
    if split_from:item['splitFrom']=split_from
    manifest.append(item)
    meshes.append({'name':name,'primitives':[{'attributes':{'POSITION':p,'NORMAL':n},'indices':i,'material':0}]})
    gltf_nodes.append({'name':'part-'+str(pid_str),'mesh':len(meshes)-1,'extras':item})

# rib patch centroids (ground truth, computed before patches are discarded)
patch_centroids={}
for pid,name in patches.items():
    if RIB_PATCH.search(name):
        p,i=part_geometry(pid)
        if p is None: raise ValueError(f'rib patch {name} has no geometry')
        patch_centroids[name]=p.mean(axis=0)

emitted=0
for pid,name in sorted(selected.items()):
    pos,idx=part_geometry(pid)
    if pos is None: continue   # empty FE parts (e.g. TX_BO_T1_2D) carry no geometry
    kind='壳单元表面' if shells.get(pid) else '实体外表面'
    if name=='TX_BO_Ribs_3D':
        comps,assign=rib_assignment(pos,idx,patch_centroids)
        for ci,(side,num) in sorted(assign.items(),key=lambda t:(t[1][0],t[1][1])):
            sp,si=submesh(pos,idx,comps[ci])
            emit(f'{pid}-{side}{num}',f'TX_BO_Rib{num}_{side}_split',sp,si,
                 f'第{num}肋骨（{"左" if side=="L" else "右"}）','thorax','实体外表面',split_from=name)
            emitted+=1
        continue
    if name=='PV_BO_Pelvis_3D':
        comps,assign=pelvis_assignment(pos,idx)
        order={'髂骨':0,'耻骨':1,'坐骨':2}
        items=sorted(((i,)+assign[id(c)] for i,c in enumerate(comps)),key=lambda t:(t[1],order[t[2]]))
        for ci,side,bone in items:
            sp,si=submesh(pos,idx,comps[ci])
            emit(f'{pid}-{side}-{bone}',f'PV_BO_Pelvis_{side}_{bone}_split',sp,si,
                 f'{bone}（{"左" if side=="L" else "右"}）','pelvis','实体外表面',split_from=name)
            emitted+=1
        continue
    m=re.match(r'UX_BO_([LR])_Forearm_2D$',name)
    if m:
        side=m.group(1)
        for comp,label in forearm_assignment(pos,idx,side):
            sp,si=submesh(pos,idx,comp)
            tag='Radius' if label.startswith('桡') else 'Ulna'
            emit(f'{pid}-{tag}',f'UX_BO_{side}_{tag}_split',sp,si,label,
                 'left-arm' if side=='L' else 'right-arm','壳单元表面',split_from=name)
            emitted+=1
        continue
    emit(pid,name,pos,idx,part_label(name),region(name),kind)
    emitted+=1

if emitted!=len(manifest): raise ValueError('emit/manifest mismatch')
uniq_labels=[p['label'] for p in manifest]
if len(set(uniq_labels))!=len(uniq_labels):
    dup=[l for l,c in Counter(uniq_labels).items() if c>1]
    raise ValueError(f'duplicate anatomical labels remain: {dup}')

doc={'asset':{'version':'2.0','generator':'PIPER 6YO surface extraction v2','copyright':'PIPER project contributors; GPLv3 + liability/open science clauses'},'scene':0,'scenes':[{'nodes':list(range(len(gltf_nodes)))}],'nodes':gltf_nodes,'meshes':meshes,'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.88,.82,.7,1],'metallicFactor':0,'roughnessFactor':.65}}],'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':accessors}
j=json.dumps(doc,separators=(',',':')).encode();j+=b' ' *((-len(j))%4);blob.extend(b'\0'*((-len(blob))%4))
glb=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(blob))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(blob),0x004e4942)+blob
(out/'piper-child-6yo.glb').write_bytes(glb)
(out/'manifest.json').write_text(json.dumps({'age':6,'posture':'原始研究模型姿势','schemaVersion':2,'sourceFiles':{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in mesh_files},'parts':manifest,'regions':labels,'meshSha256':hashlib.sha256(glb).hexdigest()},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Corresponding source is supplied together with derived mesh, not fetched at runtime.
with zipfile.ZipFile(out/'piper-corresponding-source.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for file in source.rglob('*'):
        if file.is_file():archive.write(file,'PIPER_ChildModel_6YO/'+str(file.relative_to(source)))
    for name in ('LICENSE','License_gpl-3.0.txt','README.md'):archive.write(root/name,name)
    archive.write(__file__,'convert-piper-child.py')
print(json.dumps({'parts':len(manifest),'triangles':sum(x['triangles'] for x in manifest),'glbBytes':len(glb),'splitParts':sum(1 for x in manifest if 'splitFrom' in x)},ensure_ascii=False))
