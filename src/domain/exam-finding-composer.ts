import {hasAffirmedSourceMention} from './exam-source-context';
import {instrumentsForSite} from './exam-anatomy';
/** 把源记录合成为「工具×部位」的本例所见；三层来源不得互相冒充。 */

export type FindingOrigin = 'source' | 'teaching-simulation' | 'reference';
export type FindingScope = 'local' | 'whole-region' | 'reference';

export interface ComposedFinding {
  result: string;
  origin: FindingOrigin;
  scope: FindingScope;
  /** 命中的源记录行（工具、部位），用于 evidenceCode 与 sourceLocator。 */
  sourceRef?: { tool: string; part: string };
  /** 本行是否引用了同一部位的其它检查方式，仅供构建期审计。 */
  crossModality?: boolean;
}

/** sourceExamDefinitions 的一行：[工具, 部位, 名称, 原文片段]。 */
export type SourceExamSnippet = readonly [string, string, string, string];

export interface ComposeRequest {
  tool: string;
  part: string;
  /** groupForSite(part)：该部位所属的整体记录部位。 */
  group: string;
  /** 该部位规范的「一般正常表现」参考文本。 */
  protocolNormal: string;
  sourceExams: readonly SourceExamSnippet[];
  /** 按部位判定后的全身风险闸门，见 siteHasSystemicConcern。 */
  siteConcern: boolean;
  /** 整体部位是否存在被肯定的异常所见；有异常时不得模拟一个相反的正常值。 */
  groupAbnormal: boolean;
  /** 部位中文名，用于行文。 */
  partLabel: string;
  groupLabel: string;
}

/** 仅用于审计检查方式；任何不同器材均不能自动转移原始所见。 */
const MODALITY: Record<string, string> = {
  inspection: 'visual',
  flashlight: 'illuminated-visual',
  otoscope: 'otoscopy',
  'tongue-depressor': 'oropharyngeal',
  palpation: 'touch',
  percussion: 'percussion',
  stethoscope: 'auscultation',
  'axillary-thermometer': 'thermometry',
  'infrared-thermometer': 'thermometry',
  'tympanic-thermometer': 'thermometry',
  thermometer: 'thermometry',
  'bp-cuff': 'vital',
  oximeter: 'vital',
  'reflex-hammer': 'reflex',
  'measuring-tape': 'measurement',
  'standing-scale': 'measurement',
  'infant-scale': 'measurement',
  'length-board': 'measurement',
  stadiometer: 'measurement',
  'hand-hygiene': 'routine',
};

const TOOL_LABEL: Record<string, string> = {
  inspection: '视诊', palpation: '触诊', percussion: '叩诊', stethoscope: '听诊',
  flashlight: '照明视诊', otoscope: '耳镜检查', 'tongue-depressor': '口咽检查',
  'axillary-thermometer': '腋温测量', 'infrared-thermometer': '额温测量', 'tympanic-thermometer': '耳温测量',
  thermometer: '体温测量', 'bp-cuff': '血压测量', oximeter: '血氧监测', 'reflex-hammer': '反射检查',
  'measuring-tape': '围度测量', 'standing-scale': '体重测量', 'infant-scale': '体重测量',
  'length-board': '身长测量', stadiometer: '身高测量',
};

export function toolModality(tool: string): string {
  return MODALITY[tool] ?? 'other';
}

export function toolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? tool;
}

/** 阳性/异常所见标记：出现即视为该片段含被肯定的异常，不能当作阴性外推。 */
const ABNORMAL_MARKERS =
  /减弱|消失|减低|增强|粗|浊音|实音|鼓音|过清音|啰音|罗音|哮鸣|痰鸣|喘鸣|摩擦音|杂音|奔马|早搏|不齐|压痛|反跳痛|肌紧张|抵抗|强直|肿大|包块|肿块|结节|触及|扪及|黄染|黄疸|苍白|发绀|青紫|花斑|出血点|瘀点|瘀斑|紫癜|皮疹|充血|水肿|凹陷|膨隆|胀|饱满|张力高|异常|阳性|可疑|不对称|畸形|萎缩|瘫痪|肌无力|肌张力(?:增高|低下)|受限|固定|融合|触痛|脓|溃疡|疱疹|糜烂|分泌物|干燥|弹性差|毛细血管充盈(?:时间)?(?:延长|>|＞)|下降|升高|增高|偏高|偏低|升高|减少|增多|浑浊/;

/** 明确的阴性/正常表述：整片段都为阴性时，可按整体记录向同族检查释读。 */
const NEGATIVE_MARKERS =
  /未闻及|未触及|未扪及|未及|未见|无明显|无异常|不大|不胀|无压痛|无反跳痛|无抵抗|无杂音|无啰音|无罗音|无水肿|无黄染|无皮疹|无出血|阴性|正常|清$|呼吸音清|心律齐|心音有力|对称|存在|灵活|柔软|平软|平坦|通畅|完整|红润|无肿大|未引出|未闻及异常/;

export function isAffirmativelyNormal(snippet: string): boolean {
  if (!snippet.trim()) return false;
  // 含任一阳性标记即不是「整体阴性」，不能外推为局部正常。
  if (hasAbnormalMarker(snippet)) return false;
  return NEGATIVE_MARKERS.test(snippet);
}

export function hasAbnormalMarker(snippet: string): boolean {
  const terms=[...snippet.matchAll(new RegExp(ABNORMAL_MARKERS.source,'g'))].map(match=>match[0]);
  return hasAffirmedSourceMention(snippet,terms);
}

/** 局灶/侧别线索：出现即表示原文已定位到具体区域，不得整体外推。 */
const FOCAL_MARKERS = /左侧|右侧|左肺|右肺|左上|右上|左下|右下|双下肺|单侧|一侧|局部|心尖|心底部|胸骨左缘|胸骨右缘|脐周|脐部|右上腹|左上腹|右下腹|左下腹|枕部|颌下|耳后|耳前|腋窝|腋下|腹股沟|肾区|脊肋角|棘突/;

export function isFocal(snippet: string): boolean {
  return FOCAL_MARKERS.test(snippet);
}

/** 原文中显式点名的部位，用于把局灶所见落到 local 而非 whole-region。 */
const FOCAL_SITE_TERMS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/右上肺|右肺上/, ['right-lung-upper']],
  [/左上肺|左肺上/, ['left-lung-upper']],
  [/右下肺|右肺下/, ['right-lung-lower']],
  [/左下肺|左肺下/, ['left-lung-lower']],
  [/双下肺|两下肺/, ['right-lung-lower', 'left-lung-lower']],
  [/右肺(?!上|下)/, ['right-lung-upper', 'right-lung-lower']],
  [/左肺(?!上|下)/, ['left-lung-upper', 'left-lung-lower']],
  [/心尖/, ['mitral-area']],
  [/主动脉瓣/, ['aortic-area']],
  [/肺动脉瓣/, ['pulmonic-area']],
  [/三尖瓣/, ['tricuspid-area']],
  [/脐周|脐部/, ['umbilicus']],
  [/右上腹/, ['abdomen-right-upper']],
  [/左上腹/, ['abdomen-left-upper']],
  [/右下腹/, ['abdomen-right-lower']],
  [/左下腹/, ['abdomen-left-lower']],
  [/枕部/, ['scalp']],
  [/前囟/, ['fontanelle']],
  [/颌下|颈部/, ['cervical-nodes']],
  [/腋窝|腋下/, ['axilla']],
  [/腹股沟/, ['groin']],
  [/甲状腺/, ['thyroid']],
  [/肾区|脊肋角/, ['right-kidney', 'left-kidney']],
  [/足底/, ['plantar']],
];

export function focalSites(snippet: string): string[] {
  return [...new Set(FOCAL_SITE_TERMS.filter(([pattern]) => pattern.test(snippet)).flatMap(([, sites]) => [...sites]))];
}

/** 模拟所见的器官语境：同一工具在不同部位观察对象完全不同，不能共用一句。 */
function simulatedObservation(tool: string, part: string, label: string): string | null {
  if (tool === 'stethoscope') {
    if (/lung|chest$/.test(part)) return `${label}呼吸音清，未闻及干湿性啰音、哮鸣音及胸膜摩擦音。`;
    if (/area$|chest-heart/.test(part)) return `${label}心音有力，心律齐，未闻及病理性杂音、额外心音及心包摩擦音。`;
    if (/abdomen|umbilicus|liver-spleen/.test(part)) return `${label}可闻及间歇性肠鸣音，未闻及异常血管杂音。`;
    return null;
  }
  if (tool === 'percussion') {
    if (/lung|chest$/.test(part)) return `${label}叩诊呈清音，未叩及局灶性浊音或实音。`;
    if (/abdomen|umbilicus|liver-spleen/.test(part)) return `${label}叩诊以鼓音为主，未叩及异常局灶性浊音。`;
    if (/kidney|back|spine/.test(part)) return `${label}无叩击痛。`;
    return null;
  }
  if (tool === 'palpation') {
    if (/abdomen|umbilicus/.test(part)) return `${label}腹壁柔软，无压痛及反跳痛，未触及包块，无肌紧张。`;
    if (part === 'liver-spleen') return `${label}肋下未触及肝脏及脾脏，无触痛。`;
    if (/nodes|axilla|groin|cervical/.test(part)) return `${label}未扪及肿大淋巴结，局部无肿块、结节及触痛。`;
    if (/lung|chest$/.test(part)) return `${label}胸廓无压痛，双侧语颤对称，无胸膜摩擦感及皮下气肿。`;
    if (/area$|chest-heart/.test(part)) return `${label}心前区无抬举性搏动，未触及震颤。`;
    if (/joint|knee|elbow|wrist|ankle|hip|shoulder/.test(part)) return `${label}无肿胀、压痛及活动受限，关节周围皮温正常。`;
    if (/power/.test(part)) return `${label}相应肌群主动运动自如，可完成抗阻动作，双侧肌力对称，肌张力正常。`;
    if (/kidney|back|spine/.test(part)) return `${label}局部无压痛，未触及包块。`;
    if (/limb|hands|finger|foot/.test(part)) return `${label}局部温暖，未触及凹陷性水肿，无局部压痛。`;
    if (part === 'thyroid') return `${label}甲状腺未触及肿大，无结节及压痛，随吞咽上下活动。`;
    if (part === 'fontanelle') return `${label}前囟平坦柔软，张力正常，无膨隆或凹陷，边缘无颅骨软化。`;
    if (part === 'breast') return `${label}局部无肿块、结节及触痛，皮肤无红肿。`;
    if (part === 'plantar') return `${label}足底划试后足趾呈屈曲反应，双侧对称，无背伸扇形分开。`;
    return `${label}无压痛，未触及肿块或结节，局部皮温与周围一致。`;
  }
  if (tool === 'inspection') {
    if (/lung|chest$/.test(part)) return `${label}胸廓对称无畸形，双侧呼吸运动一致，无三凹征、鼻翼扇动及肋间隙膨隆。`;
    if (/abdomen|umbilicus/.test(part)) return `${label}腹部平坦，未见胃肠型及蠕动波，脐部无红肿及分泌物，腹式呼吸存在。`;
    if (part === 'skin') return `${label}皮肤颜色正常，弹性良好，未见皮疹、出血点、瘀斑、黄染及异常色素斑。`;
    if (part === 'general-state') return `${label}神志清楚，精神反应良好，哭声响亮或言语清晰，体位自然，无呼吸费力表现。`;
    if (part === 'growth') return `${label}体格匀称，皮下脂肪分布均匀，肌肉无明显萎缩或肥大。`;
    if (/limb|hands|finger|foot/.test(part)) return `${label}双侧对称，无畸形、肿胀、杵状指（趾）及异常姿势，自主活动自如。`;
    if (/joint|knee|elbow|wrist|ankle|hip|shoulder/.test(part)) return `${label}关节无红肿、畸形及活动受限，局部皮肤颜色正常。`;
    if (/spine|back/.test(part)) return `${label}腰背部外观对称，未见明显畸形、异常皮肤凹陷或毛发斑。`;
    if (part === 'nails') return `${label}甲床红润，无杵状改变，甲板完整。`;
    if (part === 'neuro') return `${label}意识清楚，颅神经检查未见异常，无异常姿势、不自主运动或瘫痪表现。`;
    if (part === 'lymph-nodes') return `${label}浅表淋巴结区域未见隆起、红肿及窦道，双侧对称。`;
    if (part === 'thyroid') return `${label}颈部对称，甲状腺区未见肿大及搏动性包块，无颈静脉充盈。`;
    if (part === 'fontanelle') return `${label}头颅大小形态匀称，前囟区平坦，无膨隆或凹陷，颅缝无分离。`;
    if (part === 'scalp') return `${label}头皮完整，无肿块、结节、破损及异常毛发分布。`;
    if (part === 'eyes') return `${label}双侧眼睑无水肿，睑结膜红润，球结膜无充血，巩膜无黄染，双侧瞳孔等大等圆。`;
    if (part === 'ears') return `${label}双侧耳廓形态正常，外耳道无分泌物，耳周皮肤无红肿及窦道。`;
    if (part === 'nose') return `${label}鼻外形正常，无鼻翼扇动，鼻腔通畅，无脓性分泌物，鼻黏膜淡红润泽。`;
    if (part === 'mouth') return `${label}口唇红润无发绀，口腔黏膜完整，无溃疡、疱疹及斑膜，牙龈无出血，咽部无充血，双侧扁桃体不大。`;
    if (part === 'neck') return `${label}颈部外观对称，无异常姿势及明显隆起。`;
    if (/area$|chest-heart/.test(part)) return `${label}心前区无隆起，未见异常搏动。`;
    if (part === 'breast') return `${label}双侧对称，皮肤无红肿、凹陷及橘皮样改变。`;
    if (part === 'groin') return `${label}局部对称，未见隆起、肿块及皮肤颜色改变。`;
    if (part === 'cervical-nodes') return `${label}颈部各区未见淋巴结隆起，皮肤无红肿。`;
    if (part === 'axilla') return `${label}腋窝皮肤完整，无红肿、皮疹及隆起。`;
    return `${label}外观对称，皮肤颜色与周围一致，未见肿胀、畸形、异常搏动及分泌物。`;
  }
  if (tool === 'flashlight' && part === 'eyes') return `${label}光照下双侧瞳孔等大等圆，直接与间接对光反射灵敏，角膜透明，无异常反光。`;
  if (tool === 'flashlight' && part === 'mouth') return `${label}照明下口腔黏膜完整，无溃疡、疱疹及白斑，咽部无充血及脓性分泌物。`;
  if (tool === 'tongue-depressor') return `${label}压舌板下咽部无充血，双侧扁桃体不大，无脓性分泌物，舌面及颊黏膜完整。`;
  if (tool === 'otoscope') return `${label}外耳道清洁无分泌物，鼓膜呈半透明灰白色，标志清晰，可见光锥，无充血、膨隆及穿孔。`;
  if (tool === 'reflex-hammer') return `${label}目标腱反射可引出，双侧比较无明显差异；不把本项反应当作全部病理反射检查结果。`;
  if (/power/.test(part)) return `${label}自主活动与年龄相符，可完成主动及抗阻动作，双侧对称。`;
  if (part === 'plantar') return `${label}足底刺激后足趾屈曲，双侧对称，无背伸扇形分开。`;
  return null;
}

/** 无法生成具体模拟所见的组合（含所有测量类）只能退回参考说明，不得编造读数。 */
export function simulatedFinding(tool: string, part: string, label: string): string | null {
  if(!instrumentsForSite(part).includes(tool))return null;
  if(/liver-spleen|power|neuro|fontanelle|external-genitalia|plantar|growth/.test(part))return null;
  if (MODALITY[tool] === 'measurement' || MODALITY[tool] === 'thermometry' || MODALITY[tool] === 'vital') return null;
  return simulatedObservation(tool, part, label);
}

function referenceResult(protocolNormal: string, note: string): ComposedFinding {
  return { result: `${protocolNormal} ${note}`, origin: 'reference', scope: 'reference' };
}

export function composeExamFinding(request: ComposeRequest): ComposedFinding {
  const { tool, part, group, protocolNormal, sourceExams, siteConcern, groupAbnormal, partLabel, groupLabel } = request;
  const modality = toolModality(tool);
  const rows = sourceExams.filter(row => row[3].trim().length > 0);

  // 1) 同工具同部位：最直接的实测证据。
  const exact = rows.find(([t, p]) => t === tool && p === part);
  if (exact) {
    return { result: exact[3], origin: 'source', scope: 'local', sourceRef: { tool: exact[0], part: exact[1] } };
  }

  // 2) 同工具、整体部位记录：按原文定位粒度释读，绝不升格为分区结论。
  const sameToolGroup = rows.find(([t, p]) => t === tool && p === group);
  if (sameToolGroup && part !== group) {
    const snippet = sameToolGroup[3];
    const named = focalSites(snippet);
    if (named.includes(part)) {
      return {
        result: `${snippet}。原文包含${partLabel}，所引内容仍按原记录范围展示，不把其它部位的描述变成本局部所见。`,
        origin: 'source', scope: 'whole-region', sourceRef: { tool: sameToolGroup[0], part: sameToolGroup[1] },
      };
    }
    if (isAffirmativelyNormal(snippet) && !isFocal(snippet)) {
      return {
        result: `${snippet}。原文为${groupLabel}整体阴性描述且未分区，按整体记录释读至${partLabel}；如实际操作发现与之不符，以本次所见为准。`,
        origin: 'source', scope: 'whole-region', sourceRef: { tool: sameToolGroup[0], part: sameToolGroup[1] },
      };
    }
    return {
      result: `${snippet}。原文为${groupLabel}整体描述，未独立分区；不能把整体所见自动定位为${partLabel}。`,
      origin: 'source', scope: 'whole-region', sourceRef: { tool: sameToolGroup[0], part: sameToolGroup[1] },
    };
  }
  if (sameToolGroup) {
    return { result: sameToolGroup[3], origin: 'source', scope: 'local', sourceRef: { tool: sameToolGroup[0], part: sameToolGroup[1] } };
  }

  // 3) 同部位、不同检查方式：只能提示已有什么，不能替代本项结果。
  const crossModality = rows.filter(([, p]) => p === group || p === part).filter(([t]) => toolModality(t) !== modality);
  if (crossModality.length > 0 && (groupAbnormal || siteConcern || crossModality.some(row=>hasAbnormalMarker(row[3])))) {
    const described = [...new Set(crossModality.map(([t]) => toolLabel(t)))].join('、');
    return {
      result: `${protocolNormal} 同部位原材料中的${described}不能代替本项${toolLabel(tool)}独立结果。`,
      origin: 'reference', scope: 'reference', crossModality: true,
    };
  }

  // 4) 整体部位存在被肯定的异常：不得模拟一个与之相反的正常值。
  if (groupAbnormal) {
    return referenceResult(protocolNormal, `${groupLabel}原记录存在异常所见但未覆盖本项，缺失的局部结果保持参考说明，不擅自补为正常。`);
  }

  // 5) 测量与分级类：无可核验读数时永远只给方法，不生成患者数值。
  if (MODALITY[tool] === 'measurement' || MODALITY[tool] === 'thermometry' || MODALITY[tool] === 'vital'
    || /power|neuro|fontanelle|external-genitalia|plantar|growth/.test(part)) {
    return referenceResult(protocolNormal, '本项无可核验的独立测量或分级，展示评估方法与参考，不生成患者数值。');
  }

  // 6) 部位相关的全身风险：保守参考，不模拟正常。
  if (siteConcern) {
    return referenceResult(protocolNormal, '本病例存在可能影响该部位表现的全身病情，缺失局部结果采用参考说明，不擅自补为正常。');
  }

  // 7) 教学模拟：给出该部位该检查方式的具体正常所见，并明确标注非原患者记录。
  const simulated = simulatedFinding(tool, part, partLabel);
  if (simulated) {
    return {
      result: `教学模拟设定：${simulated}此为补充操作场景，用于训练${partLabel}${toolLabel(tool)}手法，不是原患者新增实测记录。`,
      origin: 'teaching-simulation', scope: 'local',
    };
  }

  return referenceResult(protocolNormal, '本项原记录未覆盖，展示操作方法与一般参考，不生成患者数值。');
}
