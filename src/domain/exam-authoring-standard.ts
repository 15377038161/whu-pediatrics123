/** 制作期标准库。正常/异常示例不是患者事实，禁止直接下发全部标准给训练客户端。 */
import {anatomyLabel,instrumentsForSite} from './exam-anatomy';
import {examProtocol} from './exam-protocol';

export const EXAM_STANDARD_REFERENCES = [
  {id:'WHCDC-TEMP',url:'https://www.whcdc.org/zhuantilanm/zggmjksy66t/2024-02-28/832.html',purpose:'常用腋温参考36.0—37.0℃；须结合年龄、时段及型号，非患者测量值'},
  {id:'FDA-SPO2',url:'https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics',purpose:'多数健康者SpO₂95%—100%；疾病、海拔、氧疗及测量误差需单独解释'},
  {id:'AAP-TEMP',url:'https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/How-to-Take-a-Childs-Temperature.aspx',purpose:'测温方法、耳温年龄适用性；部位之间不机械换算'},
  {id:'AAP-BP',url:'https://publications.aap.org/pediatrics/article/140/3/e20171904/38358/Clinical-Practice-Guideline-for-Screening-and',purpose:'儿童血压、袖带及年龄性别身高解释'},
  {id:'RCH-VITALS',url:'https://www.rch.org.au/clinicalguide/guideline_index/normal_ranges_for_physiological_variables/',purpose:'患病儿童生理变量监测参考，非健康儿童统一正常范围'},
  {id:'WHO-GROWTH',url:'https://www.who.int/tools/child-growth-standards',purpose:'年龄性别相应生长曲线，非单一正常数值'},
  {id:'WHO-MEASUREMENT',url:'https://www.who.int/docs/default-source/child-growth/child-growth-standards/software/anthro-pc-manual-v322.pdf',purpose:'24月龄前卧位身长、之后站立身高的规范及方法标记'},
  {id:'MERCK-NEWBORN',url:'https://www.merckmanuals.com/professional/pediatrics/care-of-newborns-and-infants/physical-examination-of-the-newborn',purpose:'新生儿全身查体及肝缘可触及的年龄差异'},
  {id:'NCBI-PLANTAR',url:'https://www.ncbi.nlm.nih.gov/books/NBK397/',purpose:'足底反应的刺激方式、足趾反应与退缩反应区分'},
];

type Description={normal:string;abnormal:string;parameters:string;references:string[]};
const d=(normal:string,abnormal:string,parameters='定性观察，无统一数值正常范围；记录实际部位、侧别及检查条件。',references:string[]=[]):Description=>({normal,abnormal,parameters,references});
const joint=d('关节外形与两侧相称，无红肿、可见积液或固定畸形；主动活动与年龄相符。触诊无局部压痛，皮温不高，被动活动无明显疼痛或受限。','记录受累关节、红肿热痛、积液征象、活动受限方向及程度；左右比较。不能把疼痛部位强行活动至极限。','关节活动度如测量须写角度、主动/被动、侧别；未用量角器不能编造角度。');
const limb=d('肢体外观对称，自主活动与年龄及发育相符；局部无肿胀、明显畸形或异常姿势。触诊温度相近，无局部压痛或凹陷性水肿。','记录活动减少、局部畸形、肿胀、皮温异常、触痛、麻痹姿势及分布；末梢灌注异常需与全身循环表现同时解释。');
const neuro=d('意识、注视追踪、互动和自主运动与年龄相符，面部与肢体活动无明显不对称；无可见异常姿势或不自主运动。','记录意识改变、凝视、面部不对称、局灶活动减少、不自主运动；不能凭一次观察排除神经系统疾病。','神经系统是检查集合，必须逐项记录实际完成内容；观察、肌张力、腱反射、脑膜刺激征不能互相替代。');
const standards:Record<string,Description>={
 'general-state':d('清醒程度、目光接触、哭声或语言及互动符合年龄；安静时无明显呼吸费力、痛苦面容或异常体位。','记录嗜睡、难以唤醒、烦躁、反应迟钝、呻吟、不能安抚、呼吸费力及强迫体位，并说明与平时差异。','意识用实际评估方法记录；没有实施相应评分不可补GCS或AVPU值。',['MERCK-NEWBORN']),
 skin:d('在适当光线下观察肤色及皮肤完整性；未见可见黄染、发绀、花斑、皮疹、瘀点瘀斑或异常出血。触诊温度和弹性与年龄及环境相符。','描述皮损形态、颜色、大小、分布、压之是否褪色；黄染、苍白、发绀、水肿、花斑及弹性减低分别记录，不能只写皮肤异常。'),
 scalp:d('头颅形态大致对称，头皮完整，无可见局部肿胀、破损或异常毛发分布；轻触未及异常肿块或压痛。','记录头颅不对称、头皮血肿/包块的范围及边界、颅缝异常和压痛；新生儿产瘤与头颅血肿需结合是否跨颅缝描述。','头围另用软尺测量cm，按年龄性别曲线解释，头皮正常不等于头围正常。',['MERCK-NEWBORN','WHO-GROWTH']),
 fontanelle:d('未闭合前囟在安静、适当体位时通常平坦或轻凹，可见轻微搏动；轻触柔软，非紧张膨隆。已经闭合者如实记闭合。','记录安静状态下持续膨隆或明显凹陷、异常张力、颅缝情况；哭闹或卧位时暂时饱满不能单独诊断异常。','按年龄、闭合状态和检查体位解释；如测大小记录前后径×横径cm，软尺不能判断张力。',['MERCK-NEWBORN']),
 eyes:d('眼睑外观对称，无可见明显肿胀；结膜无明显充血或苍白，巩膜无明显黄染；瞳孔圆、两侧大致等大。','分别描述眼睑水肿、结膜苍白/充血、巩膜黄染、分泌物、瞳孔大小不等或反应减弱；光线及配合条件单独记录。','瞳孔如实际量取记录mm及光照条件；仅视诊不能声称直接/间接对光反射已测。'),
 ears:d('耳廓形态与位置大致对称，耳周无红肿，外耳道口未见分泌物。','记录耳周肿胀、外耳道分泌物及耳廓牵拉痛；鼓膜所见需耳镜，不凭外观判断。'),
 nose:d('鼻外形无明显畸形，安静时无鼻翼扇动；可见鼻腔未见明显脓性分泌物，呼吸通畅。','记录鼻翼扇动、堵塞侧别、分泌物性质、鼻出血或异物；不强行探查。'),
 mouth:d('口唇色泽与肤色相称，无发绀；可见黏膜完整湿润，未见溃疡、疱疹、斑膜或异常出血；充分照明后咽部无明显充血，扁桃体无明显肿大。','分别记录口唇发绀/干燥、黏膜疱疹/溃疡/斑膜、咽充血、扁桃体分度与分泌物；流涎、喘鸣及不能吞咽时先评估气道。'),
 neck:d('头颈姿势自然，外观对称，无可见包块；自然活动无明显受限，轻触无异常肿块或压痛。','记录斜颈、活动受限、局部包块、颈静脉异常及气管偏移；怀疑气道或颈椎问题不强行活动。'),
 thyroid:d('甲状腺区无明显可见肿大；轻柔触诊未及明显肿大、结节或压痛，记录可配合者吞咽时运动。','记录弥漫/结节性肿大、质地、压痛和吞咽移动情况；有局部异常时再考虑专门检查，不把触诊当超声结果。'),
 'lymph-nodes':d('可检查的浅表区域未见明显皮肤红肿或隆起；未触及有临床意义的异常淋巴结。儿童可触及小而柔软、活动的淋巴结，应如实描述。','逐区记录数量、长短径、质地、活动度、压痛、融合与覆盖皮肤；不能把所有可触及淋巴结都判为病理。','如可触及记录cm，正常上限随部位和年龄不同，不统一使用单一尺寸判病。'),
 chest:d('胸廓外观大致对称，无明显畸形，呼吸运动左右相近；安静时未见三凹征、鼻翼扇动或辅助呼吸肌明显参与。','记录胸廓不对称、胸壁畸形、呼吸频率/节律、三凹征与胸壁局部压痛；胸部视诊不能替代肺听诊。','呼吸频率完整计数，记录次/分、清醒/睡眠/哭闹与氧疗状态；患病儿童监测参考不等于健康正常阈值。',['RCH-VITALS']),
 'chest-heart':d('心前区无明显隆起及异常广泛搏动；触诊未及明显抬举性搏动或震颤。','记录心前区隆起、心尖搏动位置范围及强度、抬举感、震颤部位与时相；心音和杂音另由听诊记录。'),
 abdomen:d('腹部形态与年龄及营养相符，左右大致对称，未见异常胃肠型、明显蠕动波或扩张静脉；轻柔触诊腹壁柔软，无明显压痛、反跳痛及异常包块。','记录膨隆或凹陷、腹壁皮损、局灶压痛/肌紧张/反跳痛、包块和腹围变化；有疼痛先轻后深、疼痛区最后。'),
 umbilicus:d('脐部无红肿、渗液及异常隆起；新生儿脐残端按日龄描述，脐周皮肤无扩展红斑，轻触无明显压痛。','记录脐部隆起是否随哭闹变化、分泌物性质、脐周红肿范围和压痛；不因能回纳就推定所有包块安全。','脐部未愈合新生儿须结合日龄、气味及全身感染表现；不强行挤压。',['MERCK-NEWBORN']),
 'liver-spleen':d('肝脾查体按年龄解释。新生儿可触及柔软肝缘，不能据此单独判断肝大；较大儿童肝脾通常不明显触及，实际触及范围须如实记录。','记录肝缘距右肋缘的cm、质地、边缘、表面及触痛；脾下缘距左肋缘及是否跨中线分别记录。','肝缘位置并非肝脏大小的唯一依据；年龄、呼吸相、肝上界及体型共同解释，不补编肋下数值。',['MERCK-NEWBORN']),
 spine:d('躯干轴线大致居中，无明显侧弯、异常后凸或前凸；腰骶部无明显皮肤凹陷、窦道及异常毛发簇。','记录脊柱曲度、局部隆起、皮肤窦道及压痛部位；有神经症状或疑外伤时避免强行活动或叩击。'),
 back:d('背部外观大致对称，无明显局部肿胀、皮肤破损、异常毛发簇或明显畸形。','记录压疮、窦道、局部皮损、畸形及肿胀；背部外观不等于后肺野听诊正常。'),
 groin:d('腹股沟外观无明显异常隆起，轻触未及明显异常包块；小而活动淋巴结按实际大小及性质记录。','记录包块位置、大小、皮肤颜色、压痛和与哭闹/体位的关系；疼痛不能回纳包块不强行复位。'),
 'external-genitalia':d('仅在有指征、取得适当同意、合适陪同及隐私保护下，按年龄与性别描述外观及所需局部触诊；不从其他器官推定发育正常。','记录实际检查范围内的红肿、分泌物、皮损、异常包块、睾丸位置等；突发阴囊痛需及时处理。','无统一适用于所有年龄性别的正常数值；青春发育分期必须经过相应评估，不能凭模板赋值。',['MERCK-NEWBORN']),
 breast:d('乳房外观、对称性与年龄及青春发育阶段相符；无局部红肿或异常分泌物；触诊仅在有指征、适当同意及陪同下完成。','记录单/双侧发育、乳核/包块、红肿热痛及分泌物；新生儿及青春期生理变化不自动判为疾病。','Tanner分期需实际评估，不能根据年龄或性别自动赋值。'),
 limbs:limb,hands:limb,finger:limb,'upper-arm':limb,foot:limb,'lower-limb-edema':d('观察踝周及胫前无明显肿胀；轻压适当部位未留下持续凹陷，两侧比较无明显差别。','记录凹陷是否存在、分布、对称性、皮肤温度及伴随表现；肿胀不等同于凹陷性水肿。','按实际检查部位、持续时间和当地分级记录；未执行相应评估不填水肿等级。'),
 joints:joint,shoulder:joint,elbow:joint,wrist:joint,hip:joint,knee:joint,ankle:joint,
 nails:d('甲床色泽与肤色相称，甲板完整，未见明显杵状指/趾或可见发绀。','记录甲床苍白、发绀、杵状改变及甲板损害；末梢血氧需独立测量，不能由颜色推算。'),
 'upper-limb-power':neuro,'lower-limb-power':neuro,neuro,
 plantar:d('记录足底外侧向前划试后拇趾及其余足趾的实际运动，区分足趾反应与整个下肢退缩。','年龄较大儿童如出现拇趾背伸及其他足趾扇形展开，结合对侧及其余神经体征解释；婴儿不能直接套成人阳性判据。','记录侧别、年龄、方法及实际反应；不强行给婴儿统一阴性，哭闹或退缩不能等同病理反射。',['NCBI-PLANTAR']),
 growth:d('记录真实体重、身长/身高或头围，按年龄、性别及适用生长曲线评估，并结合趋势。','生长迟缓、低体重、超重、头围异常及生长速度异常需基于实际测量和适用曲线，不能只看单次外观判断。','体重kg/g；身长、身高、头围cm。低龄优先卧位身长，能安全站立者按规范测身高；无原值时不按年龄公式伪造患者值。',['WHO-GROWTH','WHO-MEASUREMENT']),
};
const lung=d('相应肺野呼吸音可闻及，左右对称部位强度大致一致，未闻及干湿性啰音、哮鸣音或胸膜摩擦音。','描述部位、侧别、呼吸音强弱、啰音性质和吸/呼气时相；不能把整体肺部异常自动定位到单一肺叶。','肺音以性质及分布记录；肺野表面投影不等同影像肺叶精确定位。');
const cardiac=d('心率和节律结合年龄及状态记录，第一、第二心音可辨，未闻及病理性杂音或异常附加心音。','杂音描述最响部位、时相、响度、性质与传导；记录心律不齐、额外心音及心音强弱，不能只写有杂音。','心率次/分。杂音分级应明确体系，未实际分级不填等级；体表听诊区不等同单一瓣膜诊断。',['RCH-VITALS']);

export function ageMonths(text:string):number|null{
 const normalized=text.replace(/\s/g,'');let result=0,found=false;
 for(const [pattern,factor] of [[/(\d+(?:\.\d+)?)岁/,12],[/(\d+(?:\.\d+)?)个?月/,1],[/(\d+(?:\.\d+)?)[天日]/,1/30.4375]] as const){const m=normalized.match(pattern);if(m){result+=Number(m[1])*factor;found=true;}}
 return found?result:null;
}
export function instrumentApplicability(tool:string,part:string,months:number|null):{status:'applicable'|'conditional'|'not_applicable';reason:string}{
 if(!instrumentsForSite(part).includes(tool))return {status:'not_applicable',reason:'器材与解剖部位不匹配，禁止释放结果。'};
 if(tool==='measuring-tape'&&part==='fontanelle')return {status:'not_applicable',reason:'软尺不用于判断前囟张力；头围应选择头颅/生长测量，前囟选视诊或轻触诊。'};
 if(tool==='tympanic-thermometer'&&(months===null||months<6))return {status:months===null?'conditional':'not_applicable',reason:'耳温需核年龄及型号；默认不用于6月龄以下，选择合适腋温等方式。'};
 if(['standing-scale','stadiometer'].includes(tool))return {status:months!==null&&months<24?'not_applicable':'conditional',reason:'本教学模板24月龄前采用婴儿秤/卧位身长；其余仍须确认能安全独立站立及设备适用性。'};
 if(['infant-scale','length-board'].includes(tool))return {status:months!==null&&months<24?'applicable':'conditional',reason:'婴儿/卧位设备须满足承重和量程；较大或不能站立患儿需合适支撑测量，不能强塞婴儿秤。'};
 if(part==='fontanelle')return {status:'conditional',reason:'先确认是否闭合；已闭合只记录闭合状态，不模拟开放前囟张力。'};
 if(['external-genitalia','breast'].includes(part))return {status:'conditional',reason:'临床指征、适当同意、陪同、隐私及年龄性别匹配后检查。'};
 if(tool==='tongue-depressor')return {status:'conditional',reason:'先评估气道；流涎、静息喘鸣、三脚架体位等危险表现时不强行压舌检查。'};
 if(part==='growth'||tool==='bp-cuff'||tool==='oximeter')return {status:'conditional',reason:'核量程/探头/袖带尺寸及当前临床状态；不符合条件不释放读数。'};
 return {status:'applicable',reason:'解剖关系适用；仍需满足手卫生、解释及该项必要体位等准备条件。'};
}
export function detailedExamStandard(tool:string,part:string):Description & {technique:string;reaction:string;method:string}{
 const protocol=examProtocol(tool,part);if(!protocol)throw Error('UNMAPPED_TOOL_SITE');
 const label=anatomyLabel(part);let base=standards[part];
 if(/lung/.test(part))base=lung;
 if(/area$/.test(part))base=cardiac;
 if(part==='forehead')base=d('额部皮肤完整，无可见红肿、皮疹或明显汗液干扰。','记录局部皮损、汗液及环境影响；发热需器材测量，触摸额头不提供精确温度。');
 if(part==='cervical-nodes'||part==='axilla')base=standards['lymph-nodes'];
 if(part.startsWith('abdomen-'))base=standards.abdomen;
 if(/kidney/.test(part))base=d('肾区外观无异常隆起，轻触无明显异常包块或压痛，轻柔叩击无明显疼痛。','记录叩击痛/压痛侧别和强度；腹部症状与尿液检查需独立获取，单项阴性不排除泌尿系统病变。');
 if(!base)throw Error(`SITE_STANDARD_MISSING:${part}`);
 if(tool==='stethoscope'&&(/lung/.test(part)||part==='chest'))base=lung;
 else if(tool==='stethoscope'&&(/area$/.test(part)||part==='chest-heart'))base=cardiac;
 else if(tool==='stethoscope')base=d('相应腹部可闻及间歇性肠鸣音，无明显高调金属音、气过水声或异常血管杂音。','记录肠鸣音增多、减弱、持续未闻及或高调音及听诊时间；不能以瞬间未听见判定肠鸣音消失。','如计数记录次/分及实际听诊时长；没有单一适用于所有婴儿与儿童的肠鸣音正常常数。');
 else if(tool==='percussion'&&(/lung/.test(part)||part==='chest'))base=d('相应肺野叩诊以清音为主，左右对称部位大致一致。','记录局部浊音、实音或过清音的部位、侧别及范围；不得用肺听诊代替叩诊。');
 else if(tool==='percussion'&&/abdomen|umbilicus|liver-spleen/.test(part))base=d('腹部以鼓音为主，肝脾实质投影可呈浊音，未获得异常移动性浊音等征象。','描述异常浊音范围、移动性浊音是否实际检查及结果；不能把生理性肝区浊音判异常。');
 else if(tool==='percussion')base=d('相应肾区或脊柱轻柔叩击未引出明显疼痛。','记录叩击痛确切位置、侧别及反应，不对疑骨折部位强行叩击。');
 else if(tool==='otoscope')base=d('外耳道通畅，无明显脓性分泌物或异物；可见鼓膜完整、标志可辨，无明显膨隆、充血或穿孔。','记录耳道充血/肿胀/分泌物，鼓膜颜色、位置、完整性及标志；若耵聍或配合不足遮挡，明确未看清，不能补正常。');
 else if(tool==='flashlight'&&part==='eyes')base=d('光照下双侧瞳孔大致等大等圆，直接及间接对光反应存在，眼部可见结构无明确异常。','记录光照条件下大小不等、直接/间接反应减弱或消失；若未检查红光反射，不补写红光反射正常。','瞳孔径如测量记录mm；视力、眼底、角膜反射须另行检查。');
 else if(tool==='tongue-depressor'||tool==='flashlight'&&part==='mouth')base=standards.mouth;
 else if(tool==='reflex-hammer')base=part==='plantar'?standards.plantar:d('在放松且检查方法适当时目标腱反射可引出，双侧相应反射比较大致对称。','记录反射增强、减弱、消失、左右差异或阵挛；必须注明实际目标反射，不把膝反射结果覆盖全部神经系统。','按采用的分级体系记录；反射锤敲击肌腱，足底反应使用合适钝性端轻划，不能敲击足底代替。');
 else if(tool==='palpation'&&/power/.test(part))base=d('能配合者目标肌群主动和适当抗阻运动左右相称；不能配合者记录自发运动及实际可评价范围。','记录具体肌群活动减少、抗阻不足、肌张力改变及侧别；疼痛或意识问题影响评价时明确局限。','可靠配合时可用MRC 0—5级；婴幼儿不能按年龄默认5级，肌力与肌张力分别记录。');
 else if(/thermometer/.test(tool))base=d('获得稳定温度后，按对应方法、型号和年龄参考解释，正常读数与当时临床状态一致。','记录具体℃、测量部位/时点；高温或低温结合年龄和临床情况处理，可疑结果用合适方法复核。',tool==='axillary-thermometer'?'单位℃；常用腋温参考36.0—37.0℃，受年龄、时段、活动及型号影响。参考范围不是患者测量值；不与耳温、额温机械加减换算。':'单位℃；使用对应耳温/额温器材与年龄参考，不把腋温范围套用本方法，不作固定加减换算；参考范围不充当患者测量值。',['AAP-TEMP','WHCDC-TEMP']);
 else if(tool==='bp-cuff')base=d('正确袖带、安静状态下取得收缩压及舒张压，按年龄性别身高的相应标准解释。','高或低读数先核袖带、体位与干扰并复测，结合意识及灌注；不能仅凭一次读数诊断高血压。','mmHg，分别记录收缩压/舒张压；袖带气囊宽至少为上臂围40%、长度约80%—100%。患病儿童收缩压监测范围不等于儿童高血压诊断界值。',['AAP-BP','RCH-VITALS']);
 else if(tool==='oximeter')base=d('适龄探头在灌注和信号稳定时给出SpO₂及脉率，结合是否吸氧及临床状态解释。','记录持续偏低数值及波形/信号、氧疗条件；低灌注、动作及探头不合适可影响结果，不以不稳定数值下结论。','SpO₂为%，脉率次/分；多数健康者SpO₂约95%—100%，基础心肺病、海拔及氧疗目标须另定，不能据此给所有患儿统一治疗目标或推算本例值。',['FDA-SPO2']);
 else if(['standing-scale','infant-scale','length-board','stadiometer','measuring-tape'].includes(tool))base=standards.growth;
 // 制作参考也按实际方法限缩；不把观察、触诊、听诊混写成一次操作。
 if(tool==='inspection'){
  const visible=base.normal.split(/[。；]/).filter(s=>s&&!/触诊|轻触|未触|未及|可触及|腹壁柔软|轻压|肿大淋巴结|肝缘|抗阻|对光反应|呼吸音|心音|腱反射|足底外侧/.test(s));
  base={...base,normal:visible.length?visible.join('；')+'。':`观察${label}外观、姿势及自主活动与年龄是否相符，记录可见的对称性和形态；不包含触诊、反射或器材测量结论。`};
 }
 if(tool==='palpation'){
  let normal:string;
  if(part==='fontanelle')normal='未闭合者在安静、适当体位下轻触前囟通常柔软、非紧张膨隆；已闭合者只记闭合状态，不能继续给开放前囟张力。';
  else if(part==='liver-spleen')normal=standards['liver-spleen'].normal;
  else if(/power/.test(part))normal=base.normal;
  else if(/abdomen|umbilicus/.test(part))normal='在充分放松时腹壁柔软，适当轻触未引出明显压痛，按实际检查范围记录反跳痛、肌紧张及包块；不能把未检查的深部体征补为阴性。';
  else if(/nodes|axilla|groin/.test(part))normal='目标区域未触及有临床意义的异常淋巴结或包块；可触及小结节时记录位置、大小、质地、活动度和压痛，不一概判异常。';
  else if(/lung|chest$/.test(part))normal='胸廓扩张及相应部位触觉语颤左右比较无明显差异，未触及异常压痛、皮下气肿或胸膜摩擦感；不把语颤触诊当呼吸音听诊。';
  else if(/area$|chest-heart/.test(part))normal='目标心前区未触及明显抬举性搏动或震颤；心尖搏动如可触及按实际位置、范围及强度记录，不能由触诊补写心音或杂音。';
  else if(/joint|hip|knee|ankle|elbow|wrist|shoulder/.test(part))normal='目标关节局部皮温不高，无明显压痛、积液或异常活动；仅在安全且适当时评价被动活动，记录疼痛或受限。';
  else if(part==='thyroid')normal='目标区域未触及明显肿大、结节或压痛；能配合吞咽时记录相应活动，不由触诊给出超声结构或激素水平。';
  else if(part==='plantar')normal=standards.plantar.normal;
  else if(part==='external-genitalia'||part==='breast')normal='取得适当同意、陪同及隐私条件下完成指征所需的局部触诊，按实际范围记录是否有压痛、包块；不凭模板赋青春发育分期。';
  else if(part==='scalp')normal='轻触头皮未及异常包块或局部压痛；新生儿头皮肿胀按边界与颅缝关系记录，不将头皮触诊替代前囟张力。';
  else if(part==='skin')normal='适当部位皮温及皮肤弹性与年龄、环境和全身状态相符，无明显皮下硬结或凹陷性水肿；肤色和皮疹另由观察记录。';
  else if(part==='neuro')normal='按年龄及配合程度分别评价肌张力、被动活动及实际完成的手法项目；触诊本身不能宣称所有颅神经、腱反射或病理征正常。';
  else if(part==='general-state')normal='按本次实际完成的手法记录皮温、脉搏或其他可触及表现；不能仅靠触诊给出完整意识评分或精确体温。';
  else normal='局部皮温与周围比较无明显差异，未触及异常包块、明显压痛或凹陷性水肿；只记录实际触诊范围，不补未做的测量或反射。';
  base={...base,normal};
 }
 const method=tool==='inspection'?'观察可见表现':tool==='palpation'?'触诊/手法评估':tool==='percussion'?'叩诊':tool==='stethoscope'?'听诊':tool;
 return {...base,normal:`${label}：${base.normal}`,abnormal:`${label}：${base.abnormal}`,technique:protocol.technique,reaction:protocol.reaction,method};
}
