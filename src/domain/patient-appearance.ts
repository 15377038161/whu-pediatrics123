/** 通用虚拟角色，不代表患者本人、病例年龄或实际体征。 */
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

export function patientAppearance(sex:string, posture:'standing'|'supine', caseId:string) {
  const normalized=sex.trim();
  if (normalized!=='男' && normalized!=='女') return { key:'unspecified',src:null,alt:'病例未注明性别，暂不指定男女照片' };
  // 不用 Math.random：同一病例刷新、恢复、切换姿势时固定同一个虚拟角色。
  let hash=2166136261;
  for (const char of caseId) hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const character=characters[normalized][caseId.startsWith('peds-respiratory-') ? 0 : hash%2];
  return { key:character.key,src:character[posture],alt:`${normalized==='女' ? '女孩' : '男孩'}${posture==='supine' ? '仰卧' : '站立'}虚拟体位示意，非病例本人，不代表病例年龄或体征` };
}
