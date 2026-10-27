/**
 * 患儿虚拟形象选择（C01 修复）：按**性别 + 年龄分档 + 体位**选择示教素材。
 *
 * 根因与修复（2026-10 批次 C01）：
 *  - 原实现只按性别 + 体位 + caseId 哈希在学龄前儿童素材中选择，完全不看年龄——
 *    出生 1 天女婴（默认站立体位）必然显示站立学龄前女孩，与病例事实矛盾。
 *  - 修复：年龄经 parseAgeToDays/toAgeBand（天/月/岁统一解析，communication-profile 域）
 *    分档后，新生儿（≤28 天）与婴儿（≤1 岁）**只用同性别卧位婴儿素材**，不参与哈希
 *    选择、不提供站立形象（该月龄不能站立）；请求站立体位也按卧位返回。
 *  - 2026-10-23（独立项 C）：幼儿（toddler ≤3 岁）/学龄（school 6-12 岁）/青少年
 *    （adolescent ≥12 岁）新增分档专属素材——同性别一档一对站姿/仰卧，已逐对图核
 *    确认同一可识别个体（outputs/case-library-review/20261023/asset-identity-check-20261023.md）；
 *    素材仍未完成医学/形象专业审核（reviewStatus=unaudited），不声称已审核。
 *    已知学龄前（preschool 3-6 岁）走原虚拟儿童素材与稳定哈希；未知年龄返回占位，不能猜成学龄前。
 *  - 所有素材均为通用虚拟示教角色，不代表患者本人或实际体征。
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

/**
 * 年龄分档专属素材（2026-10-23 独立项 C）：幼儿/学龄/青少年各有同龄观感的一对
 * 站姿（v1）+仰卧（v2 竖构图）素材，站姿/仰卧为同一可识别个体（逐对图核通过）。
 * 素材观感年龄段与分档一致，但仍是通用虚拟示教角色：非病例本人，不代表实际体征。
 */
const ageBandCharacters = {
  toddler: {
    男: { key: 'toddler-boy', standing: '/media/clinical/virtual-child-toddler-boy-standing-v1.png', supine: '/media/clinical/virtual-child-toddler-boy-supine-v2.png' },
    女: { key: 'toddler-girl', standing: '/media/clinical/virtual-child-toddler-girl-standing-v1.png', supine: '/media/clinical/virtual-child-toddler-girl-supine-v2.png' },
  },
  school: {
    男: { key: 'school-boy', standing: '/media/clinical/virtual-child-school-boy-standing-v1.png', supine: '/media/clinical/virtual-child-school-boy-supine-v2.png' },
    女: { key: 'school-girl', standing: '/media/clinical/virtual-child-school-girl-standing-v1.png', supine: '/media/clinical/virtual-child-school-girl-supine-v2.png' },
  },
  adolescent: {
    男: { key: 'adolescent-boy', standing: '/media/clinical/virtual-child-adolescent-boy-standing-v1.png', supine: '/media/clinical/virtual-child-adolescent-boy-supine-v2.png' },
    女: { key: 'adolescent-girl', standing: '/media/clinical/virtual-child-adolescent-girl-standing-v1.png', supine: '/media/clinical/virtual-child-adolescent-girl-supine-v2.png' },
  },
} as const;

const ageBandLabels = { toddler: '幼儿', school: '学龄儿童', adolescent: '青少年' } as const;

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

/** 新生儿（≤28 天）或婴儿（≤1 岁）：只用卧位婴儿形象。 */
function isYoungInfant(ageKnown?: string): boolean {
  if (!ageKnown) return false;
  const band = toAgeBand(parseAgeToDays(ageKnown));
  return band === 'newborn' || band === 'infant';
}

export function patientAppearance(sex: string, posture: 'standing'|'supine', caseId: string, ageKnown?: string): PatientAppearance {
  const normalized = sex.trim();
  if (normalized!=='男' && normalized!=='女') return { key:'unspecified',src:null,alt:'病例未注明性别，暂不指定男女照片' };
  if (toAgeBand(parseAgeToDays(ageKnown ?? '')) === 'unknown') return {
    key: 'age-unspecified', src: null, alt: '病例年龄未明确，暂不指定年龄形象；请核实原始病例资料',
  };
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
  // 幼儿/学龄/青少年（2026-10-23 独立项 C）：分档专属素材，站姿/仰卧同一可识别个体；
  // 不参与哈希——3 岁患儿不得显示学龄前通用角色（与 C01 同类原则：形象须匹配年龄分档）。
  if (ageKnown) {
    const band = toAgeBand(parseAgeToDays(ageKnown));
    if (band === 'toddler' || band === 'school' || band === 'adolescent') {
      const character = ageBandCharacters[band][normalized as '男' | '女'];
      return {
        key: character.key,
        src: character[posture],
        alt: `${ageBandLabels[band]}（病例年龄 ${ageKnown}）${normalized === '女' ? '女' : '男'}童${posture === 'supine' ? '仰卧' : '站立'}虚拟体位示意，非病例本人，不代表病例实际体征`,
      };
    }
  }
  // 已知学龄前：同一病例刷新、恢复、切换姿势时固定同一个虚拟角色。
  let hash=2166136261;
  for (const char of caseId) hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const character=characters[normalized][caseId.startsWith('peds-respiratory-') ? 0 : hash%2];
  return { key:character.key,src:character[posture],alt:`${normalized==='女' ? '女孩' : '男孩'}${posture==='supine' ? '仰卧' : '站立'}虚拟体位示意，非病例本人，不代表病例年龄或体征` };
}
