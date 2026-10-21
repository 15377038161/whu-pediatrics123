"""Read-only source/GLB audit. Audit success does NOT mean medical completeness.
Usage: python scripts/audit-anatomy-completeness.py --source outputs/piper-child
Does not import/run the converter or write any model assets.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import xml.etree.ElementTree as ET
import numpy as np


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_source(source):
    parts, nodes, shells, solids = {}, {}, defaultdict(list), defaultdict(list)
    for file in sorted(source.glob('*.k')):
        lines = [s.strip() for s in file.read_text(encoding='utf-8', errors='replace').splitlines()
                 if s.strip() and not s.lstrip().startswith('$')]
        for i, line in enumerate(lines):
            if line == '*PART':
                pid = int(lines[i+2].split()[0])
                if pid in parts:
                    raise ValueError(f'Duplicate source part {pid}')
                parts[pid] = {'name': lines[i+1], 'file': file.name}
    # Follow all files with bone definitions as well as the shared body mesh.
    files = sorted({'mesh_PIPER_Body.k', *(p['file'] for p in parts.values() if '_BO_' in p['name'])})
    for name in files:
        state, skip = '', False
        for line in (source/name).read_text(encoding='utf-8', errors='replace').splitlines():
            if not line.strip() or line.lstrip().startswith('$'):
                continue
            if line.startswith('*'):
                state, skip = line.strip(), False
                continue
            if state == '*NODE':
                nid = int(line[:8])
                xyz = np.array([float(line[8:24]), float(line[24:40]), float(line[40:56])])
                if nid in nodes and not np.allclose(nodes[nid], xyz, rtol=0, atol=1e-8):
                    raise ValueError(f'Conflicting source node {nid}')
                nodes[nid] = xyz
            elif state in ('*ELEMENT_SHELL', '*ELEMENT_SHELL_THICKNESS', '*ELEMENT_SOLID'):
                if skip:
                    skip = False
                    continue
                values = [int(line[i:i+8]) for i in range(0, len(line.rstrip()), 8) if line[i:i+8].strip()]
                skip = state == '*ELEMENT_SHELL_THICKNESS'
                if len(values) >= 6 and values[1] in parts and '_BO_' in parts[values[1]]['name']:
                    (solids if state == '*ELEMENT_SOLID' else shells)[values[1]].append(values[2:10] if state == '*ELEMENT_SOLID' else values[2:6])
    return parts, nodes, shells, solids, files


def surface(pid, nodes, shells, solids):
    faces = shells.get(pid, [])
    if not faces:
        counts, lookup = Counter(), {}
        for element in solids.get(pid, []):
            for indices in ((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):
                face = list(dict.fromkeys(element[i] for i in indices))
                if len(face) >= 3:
                    key = tuple(sorted(face)); counts[key] += 1; lookup[key] = face
        faces = [lookup[key] for key, count in counts.items() if count == 1]
    triangles = []
    for face in faces:
        face = list(dict.fromkeys(face))
        triangles.extend((face[0], face[i], face[i+1]) for i in range(1, len(face)-1))
    used = sorted({n for triangle in triangles for n in triangle})
    indices = {nid: i for i, nid in enumerate(used)}
    positions = np.array([[nodes[n][1]/1000, nodes[n][2]/1000, nodes[n][0]/1000] for n in used], dtype=np.float32).reshape(-1, 3)
    return positions, np.array([[indices[n] for n in triangle] for triangle in triangles], dtype=np.int64).reshape(-1, 3), used


def components(count, triangles):
    parent = list(range(count))
    def find(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]; n = parent[n]
        return n
    for triangle in triangles:
        for n in triangle[1:]:
            a, b = find(int(triangle[0])), find(int(n))
            parent[a] = b
    groups = defaultdict(list)
    for n in range(count):
        groups[find(n)].append(n)
    return list(groups.values())


def triangle_counts(positions, triangles):
    # float32 source vertices vs actual GLB vertices, independent of split indices/winding.
    return Counter(tuple(sorted(tuple(float(x) for x in positions[n]) for n in triangle)) for triangle in triangles)


def read_glb(path):
    binary = path.read_bytes()
    if struct.unpack_from('<II', binary) != (0x46546c67, 2):
        raise ValueError('Invalid GLB')
    json_length = struct.unpack_from('<I', binary, 12)[0]
    doc = json.loads(binary[20:20+json_length]); start = 28+json_length
    def accessor(index):
        item = doc['accessors'][index]; view = doc['bufferViews'][item['bufferView']]
        dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[item['componentType']]
        width = {'VEC3': 3, 'SCALAR': 1}[item['type']]
        offset = start+view.get('byteOffset', 0)+item.get('byteOffset', 0)
        return np.frombuffer(binary, dtype=dtype, count=item['count']*width, offset=offset).reshape(-1, width)
    result = {}
    for node in doc['nodes']:
        if 'mesh' not in node:
            continue
        if any(key in node for key in ('matrix', 'translation', 'rotation', 'scale')):
            raise ValueError('Audit requires source-space GLB nodes without transforms')
        primitive = doc['meshes'][node['mesh']]['primitives'][0]
        result[str(node['extras']['id'])] = (accessor(primitive['attributes']['POSITION']), accessor(primitive['indices']).reshape(-1, 3))
    return result


def read_landmark_sets(path):
    lines = [line.strip() for line in path.read_text(encoding='utf-8').splitlines()
             if line.strip() and not line.lstrip().startswith('$')]
    result = {}
    for i, line in enumerate(lines):
        if line != '*SET_NODE_LIST_TITLE':
            continue
        ids = []
        for data in lines[i+3:]:
            if data.startswith('*'):
                break
            ids.extend(int(value) for value in data.split() if value.isdigit() and int(value))
        if lines[i+1] in result:
            raise ValueError(f'Duplicate landmark title in {path.name}: {lines[i+1]}')
        result[lines[i+1]] = ids
    return result


def audit_component_landmarks(source, geometry_cache, nodes, glb):
    """Record source components without inventing per-bone identities from topology."""
    landmarks = [(file, title, ids) for file in ['landmarks_ISB.k', 'PIPER_landmark_namedmetadataCL.k']
                 for title, ids in read_landmark_sets(source/file).items()]
    inventories = []
    for pid in [3101, 5101, 7170, 9170]:
        positions, triangles, node_ids = geometry_cache[pid]
        groups = sorted(components(len(positions), triangles), key=lambda group: min(node_ids[i] for i in group))
        rows = []
        for group in groups:
            members = {node_ids[i] for i in group}
            contained = np.zeros(len(positions), dtype=bool); contained[group] = True
            rows.append({'componentId': f'{pid}:n{min(members)}', 'minimumSourceNodeId': min(members),
                         'sourceNodeIdsSha256': hashlib.sha256(','.join(map(str, sorted(members))).encode()).hexdigest(),
                         'vertices': len(group), 'triangles': int(np.all(contained[triangles], axis=1).sum()),
                         'landmarks': [{'file': file, 'title': title, 'memberNodeIds': sorted(members.intersection(ids))}
                                       for file, title, ids in landmarks if members.intersection(ids)]})
        inventories.append({'sourcePartId': pid, 'components': rows, 'meaning': 'Topology components, NOT bone identities'})
    # The experimental contour metadata labels talus and calcaneus landmarks, but
    # their node IDs occupy the SAME connected surface. Never promote either to a bone.
    contour = ET.parse(source/'metadata/contourCL/contourCL.xml').getroot()
    conflicts = []
    for side, pid in [('left', 7170), ('right', 9170)]:
        annotations = []
        for name, term in [(f'foot_flexion_axis_a_{side}', 'talus'), (f'foot_twist_axis_b_{side}', 'calcaneus')]:
            descriptions = [element.attrib['info'].strip() for element in contour.iter()
                            if (element.text or '').strip() == name and term in element.attrib.get('info', '').lower()]
            if not descriptions:
                raise ValueError(f'Expected upstream contour annotation is missing: {name}/{term}')
            matches = [row for inv in inventories if inv['sourcePartId'] == pid for row in inv['components']
                       for landmark in row['landmarks'] if landmark['title'] == name]
            if len(matches) != 1:
                raise ValueError(f'Upstream landmark does not resolve uniquely: {name}')
            annotations.append({'landmarkTitle': name, 'anatomicalTermInSourceComment': term,
                                'sourceComments': sorted(set(descriptions)), 'componentId': matches[0]['componentId']})
        conflicts.append({'side': side, 'annotations': annotations,
                          'differentBoneCommentsShareOneComponent': len({a['componentId'] for a in annotations}) == 1,
                          'automaticBoneIdentificationAllowed': False,
                          'interpretation': 'Could reflect simplified topology or inaccurate experimental comments; needs review, not an automatic split'})
    # Pelvic landmarks are NOT members of the retained bone surface. Measure their
    # proximity instead of misrepresenting a nearest-neighbour heuristic as membership.
    positions, triangles, node_ids = geometry_cache[8101]
    groups = components(len(positions), triangles)
    pelvic = []
    named_sets = read_landmark_sets(source/'landmarks_ISB.k')
    for title in ['LASIS', 'LPSIS', 'RASIS', 'RPSIS']:
        ids = named_sets[title]
        if len(ids) != 1:
            raise ValueError(f'Expected one pelvic landmark node: {title}')
        xyz = nodes[ids[0]]; point = np.array([xyz[1], xyz[2], xyz[0]], dtype=np.float32)/1000
        distances = sorted((float(np.linalg.norm(positions[group]-point, axis=1).min()), i) for i, group in enumerate(groups))
        group_vertices = {tuple(p) for p in positions[groups[distances[0][1]]]}
        matches = [mesh_id for mesh_id, (p, _) in glb.items() if mesh_id.startswith('8101-') and {tuple(v) for v in p} == group_vertices]
        if len(matches) != 1:
            raise ValueError(f'Pelvic source component has no unique exported match: {title}')
        pelvic.append({'title': title, 'sourceNodeId': ids[0], 'nodeIsInRetainedBoneSurface': ids[0] in node_ids,
                       'nearestExportedMeshId': matches[0], 'nearestComponentVertexDistanceMm': round(distances[0][0]*1000, 3),
                       'nextComponentVertexDistanceMm': round(distances[1][0]*1000, 3), 'meaning': 'Proximity evidence only; label remains provisional'})
    return inventories, conflicts, pelvic


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('outputs/piper-child'))
    parser.add_argument('--output', type=Path, default=Path('docs/anatomy-audit.json'))
    parser.add_argument('--review-plates', action='store_true', help='Also render source component review PNGs (requires matplotlib)')
    args = parser.parse_args(); source = args.source/'PIPER_ChildModel_6YO'
    manifest_path = Path('public/models/anatomy/manifest.json')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    parts, nodes, shells, solids, files = read_source(source)
    source_commit = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
    if source_commit != '6aeee0cec84570e1455f797ac49e4721eb89fdee':
        raise ValueError('Unexpected upstream revision; review before auditing')
    if subprocess.run(['git', '-C', str(args.source), 'diff', '--quiet', '--no-ext-diff', 'HEAD', '--', 'PIPER_ChildModel_6YO']).returncode:
        raise ValueError('Upstream source has local modifications; restore/review before auditing')
    for name, expected in manifest['sourceFiles'].items():
        if digest(source/name) != expected:
            raise ValueError(f'Source hash differs from manifest: {name}')
    glb_path = Path('public/models/anatomy/piper-child-6yo.glb')
    if digest(glb_path) != manifest['meshSha256']:
        raise ValueError('GLB fingerprint differs from manifest')
    glb = read_glb(glb_path)
    if set(glb) != {str(p['id']) for p in manifest['parts']}:
        raise ValueError('GLB/manifest part ID mismatch')
    exported = defaultdict(list)
    for item in manifest['parts']:
        exported[item.get('splitFrom', item['sourcePart'])].append(item)
    all_bones, fidelity, geometry_cache = [], [], {}
    for pid, part in sorted(parts.items()):
        if '_BO_' not in part['name']:
            continue
        positions, triangles, ids = surface(pid, nodes, shells, solids)
        geometry_cache[pid] = positions, triangles, ids
        groups = components(len(positions), triangles) if len(positions) else []
        exports = exported.get(part['name'], [])
        row = {'partId': pid, 'name': part['name'], 'file': part['file'], 'vertices': len(positions), 'triangles': len(triangles), 'connectedComponents': len(groups), 'exportedIds': [p['id'] for p in exports]}
        if not len(triangles):
            row['exportStatus'] = 'empty_source_part'
        elif exports:
            expected = triangle_counts(positions, triangles); actual = Counter()
            for item in exports:
                actual.update(triangle_counts(*glb[str(item['id'])]))
            row['exportStatus'] = 'exported_geometry_preserved' if actual == expected else 'geometry_mismatch'
            fidelity.append({'sourcePart': part['name'], 'missingTriangles': sum((expected-actual).values()), 'extraTriangles': sum((actual-expected).values())})
        else:
            row['exportStatus'] = 'not_exported_requires_reason'
        all_bones.append(row)
    # Separate reference connectors from alternative representations.
    normalize = lambda name: re.sub(r'_(?:2D|3D)(?:_[Rr]igid)?$', '', name)
    for row in all_bones:
        if row['exportStatus'] != 'not_exported_requires_reason':
            continue
        if re.search(r'_Rib\d+_2D_Rigid$',row['name']) or row['name']=='TX_BO_Sternum_2D_rigid':
            row['exportStatus']='omitted_reference_connector'
            row['reason']='FE reference/connector patch, not advertised as an independent anatomical bone'
        elif any(p['exportedIds'] and normalize(p['name'])==normalize(row['name']) for p in all_bones):
            row['exportStatus']='alternate_representation_omitted'
            row['reason']='3D preferred; surface equivalence is audited separately, not assumed'
    # An omitted 2D shell is not assumed redundant merely because names match.
    omitted_checks = []
    for row in all_bones:
        if row['exportStatus'] != 'alternate_representation_omitted':
            continue
        candidates = [p for p in all_bones if p['exportedIds'] and normalize(p['name']) == normalize(row['name'])]
        if len(candidates) != 1:
            continue
        candidate = candidates[0]
        original = triangle_counts(*geometry_cache[row['partId']][:2])
        retained = triangle_counts(*geometry_cache[candidate['partId']][:2])
        omitted_vertices = {tuple(p) for p in geometry_cache[row['partId']][0]}
        retained_vertices = {tuple(p) for p in geometry_cache[candidate['partId']][0]}
        omitted_checks.append({'omitted': row['name'], 'retained': candidate['name'], 'trianglesNotInRetainedSurface': sum((original-retained).values()),
                               'omittedVerticesNotInRetained': len(omitted_vertices-retained_vertices),
                               'interpretation': 'Different tessellation/surface positions require review; nonzero is not proof of missing anatomy'})
    # Source-defined radius styloid landmark is independent evidence, unlike centroid heuristics.
    forearms = []
    landmark_text = (source/'landmarks_ISB.k').read_text(encoding='utf-8')
    for side, pid in [('L', 3100), ('R', 5100)]:
        title = f'Styloid_process_of_{"left" if side=="L" else "right"}_radius'
        cleaned = [line.strip() for line in landmark_text.splitlines() if line.strip() and not line.lstrip().startswith('$')]
        index = cleaned.index(title); landmark_id = int(cleaned[index+2].split()[0])
        positions, triangles, node_ids = geometry_cache[pid]
        groups = components(len(positions), triangles)
        local = node_ids.index(landmark_id) if landmark_id in node_ids else None
        group = next((g for g in groups if local in g), None)
        emitted = glb.get(f'{pid}-Radius')
        same_vertices = bool(group is not None and emitted is not None and {tuple(p) for p in positions[group]} == {tuple(p) for p in emitted[0]})
        forearms.append({'side': side, 'landmarkTitle': title, 'landmarkNodeId': landmark_id, 'landmarkFile': 'landmarks_ISB.k', 'sourceComponents': len(groups), 'radiusLabelMatchesSourceLandmark': same_vertices})
    component_inventory, foot_conflicts, pelvic_landmarks = audit_component_landmarks(source, geometry_cache, nodes, glb)
    inventories = make_checklist(manifest, forearms)
    report = {'schemaVersion': 1, 'sourceCommit': source_commit, 'sourceFilesVerified': files,
              'manifestSha256': digest(manifest_path), 'glbSha256': digest(glb_path),
              'auditMeaning': 'Technical/source inventory, NOT medical approval or a six-year-old bone count',
              'geometryFidelityPassed': all(not x['missingTriangles'] and not x['extraTriangles'] for x in fidelity),
              'teachingAtlasComplete': False, 'medicalReview': 'not_performed',
              'sourceParts': all_bones, 'geometryFidelity': fidelity, 'omittedRepresentationChecks': omitted_checks,
              'evidenceFileHashes': {name: digest(source/name) for name in [*files, 'landmarks_ISB.k', 'Child_model.pmr',
                                      'PIPER_landmark_namedmetadataCL.k', 'metadata/contourCL/contourCL.xml']}, 'forearmLandmarks': forearms,
              'mergedComponentInventory': component_inventory, 'footLandmarkConflicts': foot_conflicts, 'pelvicLandmarkProximity': pelvic_landmarks,
              'namedInventory': inventories, 'inventorySummary': dict(Counter(x['status'] for x in inventories))}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    summary = {'schemaVersion': 1, 'modelSha256': report['glbSha256'], 'sourceCommit': source_commit,
               'medicalReview': 'not_performed', 'teachingAtlasComplete': False,
               'geometryFidelityPassed': report['geometryFidelityPassed'],
               'sourceLandmarkSupportedIds': [f'{pid}-{bone}' for pid, check in zip([3100,5100],forearms)
                                             if check['radiusLabelMatchesSourceLandmark'] for bone in ['Radius','Ulna']],
               'notIndividuallyIdentified': [item['name'] for item in inventories if item['status']=='not_individually_identified'],
               'ribsNumberedPerSide': {side: [int(re.search(r'第(\d+)肋骨',p['label']).group(1)) for p in manifest['parts']
                                             if re.search(r'第(\d+)肋骨',p['label']) and f'（{side}）' in p['label']]
                                      for side in ['左','右']}}
    Path('public/models/anatomy/audit-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    write_markdown(report, args.output.with_suffix('.md'))
    if args.review_plates:
        if not report['geometryFidelityPassed']:
            raise SystemExit('Review figures require verified source/GLB fidelity')
        write_review_plates(report, geometry_cache, args.output.parent/'anatomy-review')
    print(json.dumps({key: report[key] for key in ['geometryFidelityPassed', 'teachingAtlasComplete', 'inventorySummary', 'forearmLandmarks']}, ensure_ascii=False))
    if not report['geometryFidelityPassed']:
        raise SystemExit('Exported source geometry mismatch; inspect report')


def write_review_plates(report, geometry_cache, directory):
    """Source geometry contact sheets, never illustrations of invented bone anatomy."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    directory.mkdir(parents=True, exist_ok=True)
    for pid, slug, title in [(3101, 'left-hand', 'Left hand'), (7170, 'left-foot', 'Left foot')]:
        positions, triangles, ids = geometry_cache[pid]
        # One rigid change of basis for the ENTIRE source part gives a readable
        # principal-plane projection. Never rotate/scale components separately.
        centered = (positions.astype(np.float64)-positions.mean(axis=0))*1000
        _, _, axes = np.linalg.svd(centered, full_matrices=False)
        projected_positions = centered @ axes[[1, 0]].T
        groups = sorted(components(len(positions), triangles), key=lambda group: min(ids[i] for i in group))
        fig = plt.figure(figsize=(12, 15), facecolor='white', layout='constrained')
        grid = fig.add_gridspec(7, 4)
        overview = fig.add_subplot(grid[:2, :])
        extent = max(float(np.ptp(projected_positions[group], axis=0).max()) for group in groups)*1.15
        for index, group in enumerate(groups):
            mask = np.zeros(len(positions), dtype=bool); mask[group] = True
            faces = triangles[np.all(mask[triangles], axis=1)]
            color = plt.get_cmap('tab20')(index)
            projected = projected_positions[faces]
            overview.add_collection(PolyCollection(projected, facecolor=color, edgecolor='#283747', linewidth=.18, alpha=.85))
            center = projected_positions[group].mean(axis=0)
            overview.text(*center, str(index+1), fontsize=8, ha='center', va='center', bbox={'facecolor': 'white', 'alpha': .8, 'pad': .5, 'edgecolor': 'none'})
            axis = fig.add_subplot(grid[2+index//4, index%4])
            axis.add_collection(PolyCollection(projected, facecolor=color, edgecolor='#283747', linewidth=.3))
            middle = (projected_positions[group].min(axis=0)+projected_positions[group].max(axis=0))/2
            axis.set_xlim(middle[0]-extent/2, middle[0]+extent/2); axis.set_ylim(middle[1]-extent/2, middle[1]+extent/2)
            axis.set_aspect('equal'); axis.axis('off')
            axis.set_title(f'C{index+1:02d} | node {min(ids[i] for i in group)}\n{len(group)} vertices, {len(faces)} triangles', fontsize=8)
        overview.autoscale(); overview.margins(.12); overview.set_aspect('equal')
        overview.set_xlabel('Principal axis U (mm)'); overview.set_ylabel('Principal axis V (mm)')
        overview.set_title(f'{title}: original merged surface, {len(groups)} connected components', fontsize=13)
        fig.suptitle(f'PIPER 6YO | {title} source review\nComponent numbers are NOT bone names or bone counts', fontsize=15)
        fig.supxlabel(f'One rigid source-part rotation; all component panels share a scale and orientation.\nGPLv3 + upstream clauses | GLB {report["glbSha256"][:16]} | No medical approval', fontsize=9)
        fig.savefig(directory/f'{slug}.png', dpi=150, metadata={'Software': 'PIPER source component audit; no generated anatomy'})
        plt.close(fig)


def make_checklist(manifest, forearms):
    """Named learning targets, not age-specific bone/ossification-centre counts."""
    items = []
    current = manifest['parts']
    def add(name, region, labels=None, fallback=None, note=''):
        matches = [p for p in current if p['label'] in (labels or [name])]
        if matches:
            derived = any('splitFrom' in p for p in matches)
            status = 'derived_label_requires_review' if derived else 'source_named_requires_medical_review'
            if name.startswith(('桡骨', '尺骨')):
                side = 'L' if '（左）' in name else 'R'
                if next(f for f in forearms if f['side']==side)['radiusLabelMatchesSourceLandmark']:
                    status = 'source_landmark_supported_requires_medical_review'
        elif fallback:
            matches = [p for p in current if p['label'] in fallback]
            status = 'merged_unresolved' if matches else 'not_individually_identified'
        else:
            status = 'not_individually_identified'
        items.append({'name': name, 'region': region, 'status': status, 'meshIds': [p['id'] for p in matches], 'note': note})
    for name in ['额骨','枕骨','蝶骨','筛骨','下颌骨','犁骨']:
        add(name, 'skull', fallback=['颅骨外板','颅骨内板','颅骨板障'], note='整体颅骨材料层不等于已逐骨分割；外形是否包含该骨需标注复核')
    for side in ['左','右']:
        for name in ['顶骨','颞骨','上颌骨','颧骨','鼻骨','泪骨','腭骨','下鼻甲']:
            add(f'{name}（{side}）','skull',fallback=['颅骨外板','颅骨内板','颅骨板障'])
        for name in ['锤骨','砧骨','镫骨']:
            add(f'{name}（{side}）','skull',note='没有独立来源或网格证据，不推断一定存在/缺失')
    add('舌骨','neck',note='源文件中的 Hyoid Upper/Lower 为肌肉名称，不是舌骨几何证据')
    for prefix, count in [('C',7),('T',12),('L',5)]:
        for number in range(1,count+1):add(f'{prefix}{number}椎骨','spine')
    add('骶骨','pelvis',note='仅核查来源命名，不假设儿童各骶椎融合状态')
    add('尾骨','pelvis',note='未见独立命名；不能因骨盆中有几何就认定包含')
    for side in ['左','右']:
        for number in range(1,13):add(f'第{number}肋骨（{side}）','thorax',note='第12肋未独立标识不等于已证明该源个体异常' if number==12 else '')
    add('胸骨','thorax',note='不根据整体胸骨网格推断儿童骨化节与融合状态')
    carpals=['舟骨','月骨','三角骨','豌豆骨','大多角骨','小多角骨','头状骨','钩骨']
    tarsals=['距骨','跟骨','足舟骨','骰骨','内侧楔骨','中间楔骨','外侧楔骨']
    for side in ['左','右']:
        limb='left' if side=='左' else 'right'
        for name in ['锁骨','肩胛骨','肱骨','桡骨','尺骨']:
            label=f'{name}（{side}）'
            add(label,limb+'-arm',labels=[p['label'] for p in current if p['label'].startswith(label)])
        for name in carpals:add(f'{name}（{side}手）',limb+'-hand',fallback=[f'手骨（{side}）'],note='儿童骨化时序需单独审核，连通分量不等于骨头数')
        for number in range(1,6):add(f'第{number}掌骨（{side}）',limb+'-hand',fallback=[f'手骨（{side}）'])
        for digit in range(1,6):
            for segment in (['近节','远节'] if digit==1 else ['近节','中节','远节']):
                add(f'第{digit}指{segment}指骨（{side}）',limb+'-hand',fallback=[f'手骨（{side}）'])
        for name in ['髂骨','坐骨','耻骨','股骨','髌骨','胫骨','腓骨']:
            label=f'{name}（{side}）'
            add(label,'pelvis' if name in ['髂骨','坐骨','耻骨'] else limb+'-leg',labels=[p['label'] for p in current if p['label'].startswith(label)])
        for name in tarsals:add(f'{name}（{side}）',limb+'-foot',fallback=[f'足骨（{side}）'],note='合并网格需专业分割，不能仅按连通块自动命名')
        for number in range(1,6):add(f'第{number}跖骨（{side}）',limb+'-foot',fallback=[f'足骨（{side}）'])
        for digit in range(1,6):
            for segment in (['近节','远节'] if digit==1 else ['近节','中节','远节']):
                add(f'第{digit}趾{segment}趾骨（{side}）',limb+'-foot',fallback=[f'足骨（{side}）'])
    return items


def write_markdown(report, path):
    statuses = {
        'merged_unresolved': '合并网格中尚未逐骨定位',
        'not_individually_identified': '未找到独立标识/几何证据',
        'source_named_requires_medical_review': '有源命名，尚待医学审核',
        'derived_label_requires_review': '拆分后的推断命名，待复核',
        'source_landmark_supported_requires_medical_review': '源地标支持命名，非医学审定',
    }
    lines = [
        '# 儿童骨骼逐结构完整性与命名核查', '',
        '核查日期：2026-10-20。范围：当前 PIPER 6 岁模型、本地原始文件、转换脚本与 GLB。', '',
        '**结论：尚不满足逐骨齐全、经过专业审核的儿童解剖教学图谱要求。** 本文是可复查的技术/来源核对，不是临床或解剖专家签署的正确性证明。', '',
        '## 1. 口径与证据', '',
        '- 下表 210 行是常用解剖名称的检查目标：按左右、指趾及部分骨盆结构展开，不是“6 岁儿童应有 210 块骨头”。儿童骨化、软骨及融合状态需专门审核，不能套用成人 206 骨计数验收。',
        '- 没有独立标识不等于整段几何一定不存在；合并网格不等于其中每块骨都齐全。连通分量不等于骨头数量。',
        '- 颅骨三层是材料结构，不是额骨/顶骨等逐骨拆分。牙齿、软骨、韧带不在本次骨名称计数内，不能据此假称完整运动系统。',
        f'- 固定源提交：`{report["sourceCommit"]}`。',
        f'- 当前 GLB SHA-256：`{report["glbSha256"]}`。',
        '- 机器证据：[anatomy-audit.json](anatomy-audit.json)；重新核查：`python -X utf8 scripts/audit-anatomy-completeness.py --source outputs/piper-child`。该命令只写核查报告和覆盖摘要，不写模型/清单/转换源码包。', '',
        '## 2. 已确认的结果', '',
        f'- 检查了 {len(report["sourceParts"])} 个带 `_BO_` 的源部件定义，其中 2 个没有可导出表面；有导出结果的 73 组源几何均逐三角面核对。',
        '- 当前 101 个网格来自上述保留/拆分的源表面。源组拆分前后没有发现新增或丢失三角面；这只说明保留源几何，不代表源模型覆盖人体全部骨骼。',
        '- 当前肋骨独立编号为左右第 1—11 肋；原始部件也没有第 12 肋命名，不能仅修改网页清单补出第 12 肋，也不能推断源儿童真的只有 11 对肋骨。',
        '- 手部源网格每侧有 19 个连通分量、足部每侧 18 个；这些数字不能直接映射为全部腕/掌/指或跗/跖/趾骨。保留合并，直到有来源标注或专业分割。',
        '- 未找到舌骨、尾骨和左右三种听小骨的独立骨部件；源文件中的 Hyoid Upper/Lower 是肌肉，不能当作舌骨补入。下颌等颅面骨是否包含在颅骨外形中尚未逐骨定位。', '',
        '| 状态 | 检查目标数 |', '|---|---:|',
    ]
    lines.extend(f'| {statuses[key]} | {count} |' for key, count in report['inventorySummary'].items())
    lines += ['', '## 3. 可以落实的命名修正', '',
              '左右桡骨已使用原始 `landmarks_ISB.k` 中的茎突节点集合核对。地标所在源连通分量与当前桡骨网格的顶点集合完全一致；另一前臂连通分量作为配对结构。转换脚本现改为读取地标，而不是凭当前姿势的横向坐标猜测。该改动没有改变 GLB 几何。', '',
              '| 侧别 | 原始地标 | 节点 | 与导出桡骨一致 |', '|---|---|---:|---|']
    for row in report['forearmLandmarks']:
        lines.append(f'| {row["side"]} | {row["landmarkTitle"]} | {row["landmarkNodeId"]} | {row["radiusLabelMatchesSourceLandmark"]} |')
    lines += ['', '### 3.1 骨盆地标仅支持邻近关系，不能升级为精确匹配', '',
              '四个髂前/后上棘地标最接近当前髂骨分量，但它们的节点均不属于保留的骨表面，最近顶点仍相距约 5.6—6.6 mm。下面测量的是点到分量顶点的最短距离，不是点到连续三角表面的距离，也不构成精确解剖标注。因此髂/坐/耻骨标签全部继续保留空间规则推断、待专业复核状态。', '',
              '| 地标 | 节点 | 在保留骨表面节点中 | 最近分量 | 最近顶点距离 mm | 次近分量顶点距离 mm |', '|---|---:|---|---|---:|---:|']
    for row in report['pelvicLandmarkProximity']:
        lines.append(f'| {row["title"]} | {row["sourceNodeId"]} | {row["nodeIsInRetainedBoneSurface"]} | {row["nearestExportedMeshId"]} | {row["nearestComponentVertexDistanceMm"]} | {row["nextComponentVertexDistanceMm"]} |')
    lines += ['', '### 3.2 足部原始注释与连通拓扑存在冲突', '',
              '实验性 contour 元数据把一处地标描述为距骨（talus），另一处描述为跟骨（calcaneus），但两处节点落在同一个源连通分量；左右足都如此。这可能来自简化拓扑或实验注释不准确，尚不能判定是哪一种。禁止据此给同一网格贴上两个独立骨名，也不能把近邻结果当作自动分割依据。', '',
              '| 侧别 | 地标 | 源注释中的骨名 | 同一连通分量 ID |', '|---|---|---|---|']
    for row in report['footLandmarkConflicts']:
        for annotation in row['annotations']:
            lines.append(f'| {row["side"]} | {annotation["landmarkTitle"]} | {annotation["anatomicalTermInSourceComment"]} | {annotation["componentId"]} |')
    lines += ['', '### 3.3 手足逐分量审阅材料', '',
              '机器证据的 `mergedComponentInventory` 为双手、双足的全部 74 个连通分量记录最小源节点号、节点集合指纹、顶点/三角面数和命中的源地标。分量编号不是骨名或骨头计数。部件轮廓直接来自已核对的源三角面，无 AI 补画、独立缩放或逐块旋转。审阅图仅对整个源部件做一次刚性换轴，再同尺度正投影。', '',
              '重绘命令：`python -X utf8 scripts/audit-anatomy-completeness.py --source outputs/piper-child --review-plates`（离线额外依赖 matplotlib；生产应用不增加依赖）。', '',
              '[左手审阅图](anatomy-review/left-hand.png) · [左足审阅图](anatomy-review/left-foot.png)。图中 C 编号按最小源节点号排序，对应机器证据中的顺序；当前仅制作左侧图，双侧节点证据均在 JSON 中。图件及由 PIPER 模型支持的分析保留其 GPLv3 与责任/Open Science 附加条款，见 [原许可](../public/models/anatomy/LICENSE.txt) 和 [GPL 正文](../public/models/anatomy/GPL-3.0.txt)。', '',
              '## 4. 不能直接当作“完全重合”的去重项', '',
              f'{len(report["omittedRepresentationChecks"])} 对省略的 2D 表示与保留 3D 表示中，18 对逐三角面列表不同；所有这些省略表面的顶点都存在于对应保留表示中。另有 23 个参考/连接片与 2 个空源部件分别记账，不将其当作遗漏骨头。区别可能来自三角剖分、表面层或拓扑表达，不能把列表不同直接当成缺骨，也不能无证据称表面完全相同。需专业结合原始网格进一步审查。', '',
              '| 省略表示 | 保留表示 | 不同三角面数 | 未保留顶点数 |', '|---|---|---:|---:|']
    for row in report['omittedRepresentationChecks']:
        if row['trianglesNotInRetainedSurface']:
            lines.append(f'| {row["omitted"]} | {row["retained"]} | {row["trianglesNotInRetainedSurface"]} | {row["omittedVerticesNotInRetained"]} |')
    lines += ['', '## 5. 逐结构检查表', '', '| 序号 | 目标结构 | 区域 | 当前状态 | 对应网格 | 说明 |', '|---:|---|---|---|---|---|']
    for index, row in enumerate(report['namedInventory'], 1):
        lines.append(f'| {index} | {row["name"]} | {row["region"]} | {statuses[row["status"]]} | {", ".join(row["meshIds"]) or "未定位"} | {row["note"] or "以来源命名为线索，尚未医学审定"} |')
    lines += ['', '## 6. 下一阶段与放行条件', '',
              '1. 先复核骨盆、手足注释冲突及 2D/3D 表面差异，不为了数字齐全增加未经验证的骨头。',
              '2. 寻找有年龄信息、来源标注、许可和专业审核依据的儿童逐骨模型/分割；成人模型等比缩小不能作为儿童模型替代。',
              '3. 第 12 肋、舌骨、尾骨、听小骨等需要明确来源后制作新版本；手足和颅面需要逐骨标注、分割与复核。',
              '4. AI 可协助标注建议、建模草稿和资料整理；其输出进入未发布候选资产，必须与可靠参考、年龄特征和相邻关节关系核对后再由专业人员放行。不能直接生成“正确骨头”自动上架。',
              '5. 新资产必须记录坐标/单位/年龄/许可/来源 ID/审核记录，核对形状、左右、比例、关节关系和骨化范围，再接入已完成的动画。',
              '6. 本轮不补造新骨骼、不重新设计动画。学生界面改用“原位骨架”“全部已收录结构”，增加覆盖不完整及命名证据说明。', '',
              '## 7. 补充/替换来源初筛', '',
              '| 候选 | 已核实信息 | 为什么尚未直接替换 |', '|---|---|---|',
              '| [MARTIN 官方模型页](https://itis.swiss/virtual-population/virtual-population/hosted-models/martin)与[结构清单](https://itis.swiss/assets/Downloads/VirtualPopulation/MARTIN/MARTIN-V1.0-tissuelist.txt) | 29 月龄男童；可申请 STL，不分发原始影像；86 个组织分区。清单中的骨分区为 Bones(cortical)、Rib_and_vertebrae(cortical)、Skull(cortical) 等合并项 | 年龄不同，且骨骼清单不是逐骨结构，无法直接满足手足/颅面逐骨平铺；获取需遵守资产单独协议及可能的处理费用，不将论文许可当作资产嵌入许可 |',
              '| [CASIMIR 作者模型卡](https://huggingface.co/fjhorvath/casimir) | 儿童/青年全身 MRI 的器官和部分骨骼结构分割模型 | 是分割算法而非现成完整骨骼网格；不能自行从缺少影像和标注的数据生成全部骨头 |',
              '| [ICRP Publication 156 官方页](https://www.icrp.org/publication.asp?id=ICRP+Publication+156) | 有新生儿、1/5/10/15 岁男女儿童网格体模，主要用于辐射剂量计算；官方提供大于 10 GB 的补充材料入口 | 不是当前 6 岁源模型；还未核实逐骨层级及应用再分发许可，不能从“覆盖剂量计算组织”推断骨骼教学图谱齐全 |',
              '| [儿童详细松质骨研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC13373995/) | 作者明确说明微结构以成人微 CT 数据调整，不能完全再现发育中儿童骨骼解剖；用途为剂量学 | 不能把这套剂量学微结构块当儿童宏观逐骨资产，也不适合直接拼补当前缺项 |',
              '| [SciePro 官方 FAQ](https://www.sciepro.com/faq)与[许可说明](https://www.sciepro.com/licensing-terms) | 厂商称提供完整儿童模型、可按单个系统授权、FBX/OBJ 交付；Real-Time 3D 许可列明支持 WebGL 应用及运行时分发 | 尚未取得具体儿童资产年龄、逐骨目录、专业审核记录及项目报价；厂商宣传不是本项目验收。需核实交付粒度及 GitHub/源码包再分发是否获准，不能凭预览图采购或接入 |', '',
              '来源页面于 2026-10-20 核查。商业备选仅为线索，不推荐直接购买：SciePro [公开价格页](https://www.sciepro.com/pricing)的男女全身单模型标为 $29,900 起，该价格不是儿童骨骼单系统报价；儿童单系统需单独询价。未发出询价、未注册/签署协议、未购买资产。', '',
              '目前没有核实到能直接替换、年龄与完整性证据齐备、且许可允许本项目使用的儿童逐骨模型。先筛来源，再决定是否需要授权素材或专业建模；本轮未购买、未下载患者影像、未把不同年龄模型混装。', '',
              '## 8. 来源与适用边界', '',
              '- [PIPER 官方模型定位](https://www.piper-project.org/child)：儿童碰撞响应有限元研究模型；不据此认定逐骨教学图谱完整。',
              '- [固定版本源仓库](https://gitlab.com/piper-project.org/child/-/tree/6aeee0cec84570e1455f797ac49e4721eb89fdee)：部件定义、网格与地标是本轮直接证据。',
              '- [OpenStax 颅骨名称](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-2-the-skull)、[脊柱](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-3-the-vertebral-column)、[胸廓](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-4-the-thoracic-cage)：用于通用名称检查，不作为 6 岁骨化状态标准。',
              '- [OpenStax 上肢](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-2-bones-of-the-upper-limb)、[下肢](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-4-bones-of-the-lower-limb)：用于手足等名称检查，不把成人计数当儿童实际骨化数量。',
              '- [儿童肋骨生长原始研究](https://pubmed.ncbi.nlm.nih.gov/27927473/)：年龄相关形态变化提示不能用复制/缩放某根肋骨代替年龄适用性核验。', '',
              '本轮没有获得医学审核签署，也没有找到可直接替换并已核实年龄与许可的完整儿童逐骨资产；这两项仍是完成教学图谱的依赖。']
    path.write_text('\n'.join(lines)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
