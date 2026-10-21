/**
 * 患儿虚拟形象选择（C01 修复）：按**性别 + 年龄分档 + 体位**选择示教素材。
 *
 * 根因与修复（2026-10 批次 C01）：
 *  - 原实现只按性别 + 体位 + caseId 哈希在学龄前儿童素材中选择，完全不看年龄——
 *    出生 1 天女婴（默认站立体位）必然显示站立学龄前女孩，与病例事实矛盾。
 *  - 修复：年龄经 parseAgeToDays/toAgeBand（天/月/岁统一解析，communication-profile 域）
 *    分档后，新生儿（≤28 天）与婴儿（≤1 岁）**只用同性别卧位婴儿素材**，不参与哈希
 *    选择、不提供站立形象（该月龄不能站立）；请求站立体位也按卧位返回。
 *    幼儿及以上、年龄未知/解析失败仍走原虚拟儿童素材与稳定哈希（同一病例同一形象）。
 *  - 所有素材均为通用虚拟示教角色，不代表患者本人、病例年龄或实际体征。
 */
import { parseAgeToDays, toAgeBand } from './communication-profile';

/** 学龄前及以上通用虚拟角色（原有素材，保留）。 */
const characters = {
  男: [
    { key:'boy-a', standing:'/media/clinical/virtual-child-front.png', supine:'/media/clinical/virtual-child-boy-a-supine-v2.png' },
    { key:'boy-b', standing:'/media/clinical/virtual-child-boy-b-standing-v1.png', supine:'/media/clinical/virtual-child-boy-b-supine-v1.png' },
  ],
  女: [
    { key:'girl-a', standing:'/media/clinical/virtual-child-girl-standing-v2.png', supine:'/media/clinical/virtual-child-girl-a-supine-v1.png' },
    { key:'girl-b', standing:'/media/clinical/virtual-child-girl-b-standing-v1.png', supine:'/media/clinical/virtual-child-girl-b-supine-v1.png' },
  ],
};

/** 新生儿/婴儿（≤1 岁）同性别卧位素材：不参与哈希选择，不提供站立形象。 */
const newbornCharacters = {
  男: { key: 'newborn-boy', supine: '/media/clinical/virtual-newborn-boy-supine-v1.png' },
  女: { key: 'newborn-girl', supine: '/media/clinical/virtual-newborn-girl-supine-v1.png' },
};

export interface PatientAppearance {
  key: string;
  src: string | null;
  alt: string;
}

/** 该年龄病例允许的查体体位：新生儿/婴儿（≤1 岁）仅仰卧（不能站立），其余站立+仰卧。 */
export function allowedPostures(ageKnown?: string): Array<'standing' | 'supine'> {
  if (isYoungInfant(ageKnown)) return ['supine'];
  return ['standing', 'supine'];
}

/** 新生儿（≤28 天）或婴儿（≤1 岁）：只用卧位婴儿形象（年龄缺失/解析失败为 false，走通用儿童素材）。 */
function isYoungInfant(ageKnown?: string): boolean {
  if (!ageKnown) return false;
  const band = toAgeBand(parseAgeToDays(ageKnown));
  return band === 'newborn' || band === 'infant';
}

export function patientAppearance(sex: string, posture: 'standing'|'supine', caseId: string, ageKnown?: string): PatientAppearance {
  const normalized = sex.trim();
  if (normalized!=='男' && normalized!=='女') return { key:'unspecified',src:null,alt:'病例未注明性别，暂不指定男女照片' };
  // 新生儿/婴儿（≤1 岁）：同性别卧位婴儿形象；请求站立也按卧位返回（该月龄不能站立），
  // 不参与哈希选择——1 天女婴不得显示站立学龄前儿童（C01 修复核心）。
  if (isYoungInfant(ageKnown)) {
    const character = newbornCharacters[normalized];
    return {
      key: character.key,
      src: character.supine,
      alt: `新生/婴儿（${ageKnown}）${normalized==='女' ? '女' : '男'}婴仰卧虚拟体位示意，非病例本人，不代表病例年龄或体征`,
    };
  }
  // 不用 Math.random：同一病例刷新、恢复、切换姿势时固定同一个虚拟角色。
  let hash=2166136261;
  for (const char of caseId) hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const character=characters[normalized][caseId.startsWith('peds-respiratory-') ? 0 : hash%2];
  return { key:character.key,src:character[posture],alt:`${normalized==='女' ? '女孩' : '男孩'}${posture==='supine' ? '仰卧' : '站立'}虚拟体位示意，非病例本人，不代表病例年龄或体征` };
}
