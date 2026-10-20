import manifest from '../../public/models/anatomy/manifest.json';
import audit from '../../public/models/anatomy/audit-summary.json';

export const anatomyAudit = audit.modelSha256===manifest.meshSha256 && audit.geometryFidelityPassed ? audit : null;

export const anatomyRegions: Record<string, string> = manifest.regions;
export const anatomyRegionOrder = ['skull', 'spine', 'thorax', 'pelvis', 'left-arm', 'right-arm', 'left-leg', 'right-leg'];

/** 展示结构不是骨头计数。长骨各网格及同一结构的不同表面不分开冒充独立骨头。 */
export const anatomyStructures = Array.from(manifest.parts.reduce((groups, part) => {
  const label = part.label.replace(/(?:近端|远端)?(?:骨骺|干骺端|骨干)$/, '');
  const key = `${part.region}:${label}`;
  const structure = groups.get(key);
  if (structure) structure.parts.push(part);
  else groups.set(key, { id: part.id, label, region: part.region, parts: [part] });
  return groups;
}, new Map<string, { id: string; label: string; region: string; parts: typeof manifest.parts }>()).values());

export function structureNote(structure: typeof anatomyStructures[number]) {
  if (/手骨|足骨|前臂骨/.test(structure.label)) return '原模型合并结构，未逐骨细分';
  if (/颅骨/.test(structure.label)) return '颅骨材料层，不是独立骨头';
  if (anatomyAudit?.sourceLandmarkSupportedIds.includes(structure.id)) return '源地标支持命名，非医学审定';
  if (structure.parts.some(part => part.sourcePart.startsWith('PV_BO_Pelvis_'))) return '按空间规则推断命名，待专业复核';
  if (/肋骨/.test(structure.label)) return '按源模型编号匹配，尚未医学审定';
  return structure.parts.length > 1 ? `${structure.parts.length} 个源网格组合，保留原始相对位置` : '源模型命名，待专业复核';
}
