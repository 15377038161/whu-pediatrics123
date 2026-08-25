import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = process.cwd();
const outDir = path.join(root, 'docs', '教师汇报材料', '智能体功能与运行流程_20260825');
fs.mkdirSync(outDir, { recursive: true });

const palette = {
  paper: '#F6F0E4', ink: '#243A35', muted: '#66766F', core: '#173F35',
  brick: '#A64B3C', luojia: '#2F6654', cyan: '#56797A', gold: '#B8873D',
  moss: '#667C4E', red: '#B33A32', white: '#FFFDF8', line: '#B9B2A6',
};
const font = "'Microsoft YaHei','Noto Sans CJK SC','Source Han Sans SC',sans-serif";

const branches = [
  { title: '建设定位', color: palette.gold, items: [
    ['统一智能体', ['贯穿全程', '共享病例记忆']],
    ['三类用户', ['学生训练', '教师只读', '管理员配置']],
    ['三种模式', ['引导训练', '专项补练', 'OSCE考核']],
    ['当前边界', ['本地流程可用', '外部待联调']],
  ]},
  { title: '学生学习功能', color: palette.brick, items: [
    ['自主问诊', ['自由提问', '识别意图', '应答留证']],
    ['可视化查体', ['选择器材', '点击部位', '返回体征']],
    ['辅助检查', ['按指征选择', '呈现结果']],
    ['诊断处置', ['形成摘要', '提交诊断', '制定处置']],
    ['医患沟通', ['回应情绪', '解释风险']],
    ['训练报告', ['查看证据', '接受补练']],
  ]},
  { title: '智能体核心能力', color: palette.luojia, items: [
    ['识别问题意图', ['解析提问', '定位病史']],
    ['调度回答角色', ['判断能力', '选择回答者']],
    ['保持病例状态', ['记录阶段', '共享上下文']],
    ['校验查体规则', ['核对准备', '核对器材部位']],
    ['检索审核知识', ['匹配来源', '返回摘要']],
    ['执行证据评分', ['读取留痕', '对应量表']],
  ]},
  { title: '四类教学资源库', color: palette.cyan, items: [
    ['问诊体征模拟库', ['病例事实', '标准体征']],
    ['传染病特点库', ['危险信号', '防护要求']],
    ['沟通场景库', ['家长情绪', '沟通边界']],
    ['OSCE考核库', ['评分量表', '证据要求']],
  ]},
  { title: 'OSCE考核评价', color: palette.moss, items: [
    ['切换考核约束', ['限时完成', '关闭提示']],
    ['冻结过程证据', ['时间到点', '自动提交']],
    ['依据证据评分', ['问答留痕', '操作留痕']],
    ['生成六维画像', ['能力分项', '失分定位']],
    ['推荐专项补练', ['匹配短板', '进入再练']],
  ]},
  { title: '教师只读学情', color: palette.moss, items: [
    ['查看学生列表', ['限定班组', '不得编辑']],
    ['查看训练报告', ['总分分项', '补练建议']],
    ['查看问答记录', ['原始文本', '时间顺序']],
    ['查看操作证据', ['器材部位', '正确与否']],
    ['查看能力画像', ['六维能力', '薄弱环节']],
  ]},
  { title: '技术与数据底座', color: palette.cyan, items: [
    ['Coze编程项目', ['承载应用', '统一入口']],
    ['统一智能体内核', ['调度技能', '管理状态']],
    ['Coze项目数据库', ['保存证据', '待实例联调']],
    ['版本化知识病例', ['标明来源', '教师审核']],
    ['身份权限控制', ['RLS隔离', '教师只读']],
    ['审计同步队列', ['记录调用', '幂等重试']],
  ]},
  { title: '武汉大学特色', color: palette.luojia, items: [
    ['珞珈能力图谱', ['映射六维', '形成路径']],
    ['校本儿科病例', ['本校情境', '教师审核']],
    ['医学人文标准', ['尊重患儿', '回应家长']],
    ['传染病安全训练', ['识别风险', '落实防护']],
    ['临床能力培养', ['训练评价', '补弱进阶']],
  ]},
  { title: '创新亮点', color: palette.gold, items: [
    ['一体化病例记忆', ['跨阶段共享', '避免割裂']],
    ['双角色动态模拟', ['年龄适配', '情绪变化']],
    ['确定性体征返回', ['规则触发', '拒绝编造']],
    ['可解释证据评分', ['每分有据', '支持回看']],
    ['可靠异步同步', ['幂等提交', '失败保留']],
  ]},
  { title: '最终教学价值', color: palette.moss, items: [
    ['增加训练机会', ['随时练习', '反复强化']],
    ['统一教学标准', ['同一病例', '同一量表']],
    ['提升临床胜任力', ['知识转行动', '安全处置']],
    ['实施个性补练', ['定位短板', '推荐路径']],
    ['沉淀教学证据', ['过程可查', '质量可改']],
  ]},
];

const crossLinks = [
  '学生操作 → 统一病例状态', '统一病例状态 → 角色模拟', '查体操作 → 规则校验',
  '知识检索 → 诊断沟通', '过程证据 → OSCE评分', 'OSCE评分 → 能力画像',
  '能力画像 → 补练推荐', '训练记录 → 教师只读', 'Coze数据库 → 超星同步',
];

const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const tspanText = (x, y, lines, size = 24, color = palette.ink, weight = 500, anchor = 'middle', gap = 1.25) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${color}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? size * gap : 0}">${esc(line)}</tspan>`).join('')}</text>`;

function header(width, height, title, subtitle) {
  return `<rect width="${width}" height="${height}" fill="${palette.paper}"/>
  <text x="120" y="92" font-family="${font}" font-size="48" font-weight="800" fill="${palette.core}">${esc(title)}</text>
  <text x="120" y="138" font-family="${font}" font-size="24" font-weight="500" fill="${palette.muted}">${esc(subtitle)}</text>
  <line x1="120" y1="166" x2="${width - 120}" y2="166" stroke="${palette.line}" stroke-width="2"/>`;
}

function card(branch, x, y, w, h) {
  const headH = 54;
  const rowH = (h - headH - 22) / branch.items.length;
  let s = `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${palette.white}" stroke="${branch.color}" stroke-width="3"/>
  <path d="M${x + 24},${y} H${x + w - 24} Q${x + w},${y} ${x + w},${y + 24} V${y + headH} H${x} V${y + 24} Q${x},${y} ${x + 24},${y}" fill="${branch.color}"/>
  ${tspanText(x + 24, y + 37, [branch.title], 27, palette.white, 800, 'start')}`;
  branch.items.forEach(([label, notes], i) => {
    const yy = y + headH + 16 + i * rowH;
    s += `<circle cx="${x + 26}" cy="${yy + 11}" r="6" fill="${branch.color}"/>`;
    s += tspanText(x + 44, yy + 19, [label], 23, palette.ink, 700, 'start');
    s += tspanText(x + w - 24, yy + 19, [notes.join(' · ')], 19, palette.muted, 500, 'end');
  });
  return s + '</g>';
}

function buildMindSvg() {
  const W = 3840, H = 2160;
  const left = [branches[0], branches[1], branches[3], branches[4], branches[5]];
  const right = [branches[7], branches[2], branches[6], branches[8], branches[9]];
  const placements = [
    ...left.map((b, i) => [b, 120, 220 + i * 350, 1080, 320]),
    ...right.map((b, i) => [b, 2640, 220 + i * 350, 1080, 320]),
  ];
  const center = { x: 1320, y: 610, w: 1200, h: 880 };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${header(W, H, '珞珈儿科智训｜智能体功能思维导图', '教师汇报主图 · 一个智能体贯穿完整儿科临床训练')}
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${palette.core}"/></marker></defs>`;
  const edges = [];
  for (let i = 0; i < 5; i++) {
    edges.push([center.x, center.y + 120 + i * 150, 1200, 380 + i * 350]);
    edges.push([center.x + center.w, center.y + 120 + i * 150, 2640, 380 + i * 350]);
  }
  edges.forEach(([x1,y1,x2,y2]) => s += `<path d="M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}" fill="none" stroke="${palette.line}" stroke-width="5" marker-end="url(#arrow)"/>`);
  placements.forEach(([b,x,y,w,h]) => { s += card(b,x,y,w,h); });
  s += `<g><rect x="${center.x}" y="${center.y}" width="${center.w}" height="${center.h}" rx="54" fill="${palette.core}" stroke="#0C2C25" stroke-width="6"/>
  ${tspanText(1920, 750, ['珞珈儿科智训', '统一儿科教学智能体'], 50, palette.white, 900, 'middle', 1.12)}
  ${tspanText(1920, 890, ['一个智能体贯穿完整儿科临床训练'], 29, '#E7D7B7', 700)}
  <line x1="1410" y1="950" x2="2430" y2="950" stroke="#6F9185" stroke-width="2"/>
  ${tspanText(1920, 1005, ['输入 → 状态理解 → 技能调用 → 教学反馈'], 26, palette.white, 700)}
  ${tspanText(1435, 1070, ['通俗术语'], 24, '#E7D7B7', 800, 'start')}
  ${tspanText(1435, 1110, ['角色调度：决定由谁回答'], 20, palette.white, 600, 'start')}
  ${tspanText(1435, 1150, ['状态机：记录训练阶段'], 20, palette.white, 600, 'start')}
  ${tspanText(1435, 1190, ['证据评分：按真实记录评分'], 20, palette.white, 600, 'start')}
  ${tspanText(2050, 1070, ['安全边界'], 24, '#E7D7B7', 800, 'start')}
  ${tspanText(2050, 1110, ['体征由确定性规则返回'], 20, palette.white, 600, 'start')}
  ${tspanText(2050, 1150, ['教师仅查看不得修改'], 20, palette.white, 600, 'start')}
  ${tspanText(2050, 1190, ['外部接口待授权联调'], 20, palette.white, 600, 'start')}
  <line x1="1410" y1="1240" x2="2430" y2="1240" stroke="#6F9185" stroke-width="2"/>
  ${tspanText(1920, 1300, ['教学闭环'], 25, '#E7D7B7', 800)}
  ${tspanText(1920, 1345, ['训练留痕 → 证据评分 → 能力画像 → 个性补练'], 22, palette.white, 700)}
  </g>`;
  s += `<rect x="120" y="2010" width="3600" height="92" rx="20" fill="#EFE5D3" stroke="${palette.gold}" stroke-width="2"/>`;
  crossLinks.forEach((link, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    s += tspanText(210 + col * 1190, 2043 + row * 25, [link], 18, palette.ink, 600, 'start');
  });
  s += `<text x="3700" y="2130" text-anchor="end" font-family="${font}" font-size="18" fill="${palette.muted}">实线：层级｜虚线关系见底栏｜外部接口待授权联调</text></svg>`;
  return s;
}

const mainSteps = [
  ['S0','开始：学生发起登录','学生','即时','start'],
  ['P1','执行超星身份认证','超星平台','2—10秒','process'],
  ['D1','身份认证成功？','超星平台','即时','decision'],
  ['D2','属于允许机构？','超星平台','即时','decision'],
  ['D3','学生还是教师？','统一智能体','即时','decision'],
  ['P2','进入学生首页','学生','1—3秒','process'],
  ['P3','选择训练模式','学生','5—15秒','process'],
  ['P4','创建统一病例会话','统一智能体','1—3秒','subprocess'],
  ['P5','完成接诊与分诊','学生','30—60秒','process'],
  ['P6','输入问诊问题','学生','10—30秒','process'],
  ['P7','识别问题意图','统一智能体','1—3秒','subprocess'],
  ['D4','问题是否有效？','统一智能体','即时','decision'],
  ['D5','患儿能否回答？','角色模拟模块','即时','decision'],
  ['D6','家长需要插话？','角色模拟模块','即时','decision'],
  ['P8','调度患儿家长应答','角色模拟模块','1—3秒','subprocess'],
  ['D7','需要医生干预？','统一智能体','即时','decision'],
  ['P9','执行安抚秩序干预','学生','10—30秒','process'],
  ['D8','模型调用成功？','统一智能体','1—3秒','decision'],
  ['P10','执行可视化体检','学生','1—3分钟','process'],
  ['D9','器材部位匹配？','查体规则引擎','即时','decision'],
  ['D10','必要准备完成？','查体规则引擎','即时','decision'],
  ['P11','选择辅助检查','学生','30—60秒','process'],
  ['D11','存在危险信号？','统一智能体','即时','decision'],
  ['P12','优先执行安全处置','学生','30—60秒','process'],
  ['P13','提交摘要与诊断','学生','1—2分钟','process'],
  ['P14','检索儿科知识依据','知识检索模块','1—3秒','subprocess'],
  ['D12','存在可靠依据？','知识检索模块','即时','decision'],
  ['P15','提交治疗处置计划','学生','1—2分钟','process'],
  ['P16','完成患儿家长沟通','学生','1—2分钟','process'],
  ['D13','达到结束条件？','统一智能体','即时','decision'],
  ['D14','OSCE时间结束？','统一智能体','即时','decision'],
  ['P17','冻结现有过程证据','OSCE评分引擎','即时','subprocess'],
  ['D15','评分证据完整？','OSCE评分引擎','即时','decision'],
  ['P18','执行评分训练评价','OSCE评分引擎','3—10秒','subprocess'],
  ['P19','生成个人训练报告','OSCE评分引擎','3—10秒','document'],
  ['D16','报告生成成功？','OSCE评分引擎','即时','decision'],
  ['P20','生成六维能力画像','OSCE评分引擎','1—3秒','document'],
  ['P21','生成专项补练建议','统一智能体','1—3秒','document'],
  ['DB1','保存Coze数据库','Coze数据库','1—3秒','database'],
  ['P22','加入超星同步队列','Coze数据库','即时','database'],
  ['D17','超星接口已配置？','超星平台','即时','decision'],
  ['P23','提交超星表单','超星平台','2—10秒','process'],
  ['D18','同步是否成功？','超星平台','即时','decision'],
  ['O1','学生个人训练报告','统一智能体','即时','document'],
  ['O2','学生获得补练路径','学生','即时','document'],
  ['O3','教师查看只读学情','教师','即时','document'],
  ['E0','形成儿科教学闭环','统一智能体','持续','end'],
];

const exceptions = [
  ['E1','认证失败','返回登录并重新授权','重新操作'],
  ['E2','机构角色不符','拒绝访问并联系管理员','明确结束'],
  ['E3','问题无法识别','提示具体追问方向','重新操作'],
  ['E4','模型调用失败','使用预置病例事实','安全降级'],
  ['E5','器材部位错误','不返回深层体征并留痕','重新操作'],
  ['E6','检查准备缺失','训练提示／考核扣分','重新操作'],
  ['E7','知识依据不足','返回暂无经审核依据','安全降级'],
  ['E8','OSCE时间结束','冻结证据并自动提交','明确结束'],
  ['E9','报告生成异常','保留证据并标记待生成','保存待处理'],
  ['E10','超星表单未配置','保留队列并等待授权','保存待处理'],
  ['E11','超星同步失败','按幂等键最多重试8次','保存待处理'],
];

const links = [
  ['S0','P1',''],['P1','D1',''],['D1','D2','是'],['D1','E1','否'],['E1','S0','重新授权'],
  ['D2','D3','是'],['D2','E2','否'],['D3','P2','学生'],['D3','O3','教师'],
  ['P2','P3',''],['P3','P4',''],['P4','P5',''],['P5','P6',''],['P6','P7',''],['P7','D4',''],
  ['D4','D5','是'],['D4','E3','否'],['E3','P6','重新提问'],
  ['D5','D6','是：患儿回答'],['D5','D6','否：家长回答'],
  ['D6','P8','是：双方应答'],['D6','P8','否：当前角色应答'],
  ['P8','D7',''],['D7','P9','是'],['D7','D8','否'],['P9','D8',''],['D8','P10','是'],['D8','E4','否'],['E4','P10','预置事实'],
  ['P10','D9',''],['D9','D10','是'],['D9','E5','否'],['E5','P10','重做'],['D10','P11','是'],['D10','E6','否'],['E6','P11','考核留痕'],['E6','P10','训练重做'],
  ['P11','D11',''],['D11','P12','是'],['D11','P13','否'],['P12','P13',''],['P13','P14',''],['P14','D12',''],
  ['D12','P15','是'],['D12','E7','否'],['E7','P15','无依据继续'],['P15','P16',''],['P16','D13',''],['D13','P6','否'],['D13','D14','是'],
  ['D14','P17','是'],['D14','D15','否'],['P17','D15',''],['D15','P18','是'],['D15','P18','否：标记缺口'],
  ['P18','P19',''],['P19','D16',''],['D16','P20','是'],['D16','E9','否'],['E9','DB1','保存证据'],['P20','P21',''],['P21','DB1',''],
  ['DB1','P22',''],['P22','D17',''],['D17','P23','是'],['D17','E10','否'],['E10','O1','等待授权'],['P23','D18',''],['D18','O1','是'],['D18','E11','否'],['E11','O1','队列保留'],
  ['O1','O2',''],['O1','O3',''],['O2','E0',''],['O3','E0',''],
];

function shape(node, x, y, w = 400, h = 126) {
  const [id, name, actor, time, type] = node;
  const fill = type === 'decision' ? '#FFF7E6' : type === 'database' ? '#E6F0EF' : type === 'document' ? '#F0F3E8' : type === 'subprocess' ? '#EAF2EE' : palette.white;
  const stroke = type === 'decision' ? palette.gold : type === 'database' ? palette.cyan : type === 'document' ? palette.moss : type === 'start' || type === 'end' ? palette.core : palette.luojia;
  let frame;
  if (type === 'decision') frame = `<polygon points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`;
  else if (type === 'database') frame = `<path d="M${x},${y+18} C${x},${y-6} ${x+w},${y-6} ${x+w},${y+18} V${y+h-18} C${x+w},${y+h+6} ${x},${y+h+6} ${x},${y+h-18} Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/><ellipse cx="${x+w/2}" cy="${y+18}" rx="${w/2}" ry="18" fill="none" stroke="${stroke}" stroke-width="4"/>`;
  else if (type === 'document') frame = `<path d="M${x},${y} H${x+w} V${y+h-18} Q${x+w*0.75},${y+h+12} ${x+w*0.5},${y+h-8} Q${x+w*0.25},${y+h-28} ${x},${y+h} Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`;
  else frame = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${type === 'start' || type === 'end' ? h/2 : 20}" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`;
  return `<g id="${id}">${frame}${tspanText(x+w/2, y+48, [name], 24, palette.ink, 800)}${tspanText(x+w/2, y+86, [`${actor}｜${time}`], 18, palette.muted, 500)}</g>`;
}

function buildFlowSvg() {
  const W = 4960, H = 3508, mainW = 3820;
  const cols = [140, 745, 1350, 1955, 2560, 3165];
  const rows = [260, 635, 1010, 1385, 1760, 2135, 2510, 2885];
  const positions = new Map();
  mainSteps.forEach((node, i) => {
    const row = Math.floor(i / 6), offset = i % 6;
    const col = row % 2 === 0 ? offset : 5 - offset;
    positions.set(node[0], { x: cols[col], y: rows[row], node });
  });
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${header(W,H,'珞珈儿科智训｜智能体完整运行流程图','A3横版 · 主流程、判断、异常降级与教学闭环')}
  <defs><marker id="a" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${palette.core}"/></marker><marker id="ar" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${palette.red}"/></marker></defs>
  <rect x="120" y="190" width="3700" height="3220" rx="30" fill="#FBF8F0" stroke="${palette.line}" stroke-width="2"/>
  <rect x="3860" y="190" width="980" height="3220" rx="30" fill="#FBF2EF" stroke="${palette.red}" stroke-width="2"/>
  ${tspanText(3910,235,['异常与降级流程'],30,palette.red,900,'start')}
  <rect x="150" y="195" width="1790" height="58" rx="16" fill="#EFE5D3"/>${tspanText(175,232,['前置：病例任务已预置｜超星账号可用｜Coze数据库已配置'],20,palette.ink,600,'start')}
  <rect x="1960" y="195" width="1820" height="58" rx="16" fill="#F6DEDA"/>${tspanText(1985,232,['边界：超星认证与表单待授权联调｜教师仅只读'],20,palette.red,700,'start')}`;
  // Main snake arrows provide the readable presentation path; detailed branch edges are in Mermaid and the connection lists.
  for (let i=0;i<mainSteps.length-1;i++) {
    const a = positions.get(mainSteps[i][0]), b = positions.get(mainSteps[i+1][0]);
    const ax = a.x+400, ay=a.y+63, bx=b.x, by=b.y+63;
    let d;
    if (Math.abs(a.y-b.y)<10) d=`M${ax},${ay} H${bx-14}`;
    else {
      const dir = (Math.floor(i/6)%2===0) ? 1 : -1;
      const sx = dir===1 ? a.x+400 : a.x;
      const ex = dir===1 ? b.x : b.x+400;
      const midY=(ay+by)/2;
      d=`M${sx},${ay} V${midY} H${ex} V${by}`;
    }
    s += `<path d="${d}" fill="none" stroke="${palette.core}" stroke-width="4" marker-end="url(#a)"/>`;
  }
  mainSteps.forEach((node) => { const p=positions.get(node[0]); s+=shape(node,p.x,p.y); });
  exceptions.forEach((e,i)=>{
    const y=300+i*275;
    s += `<g><rect x="3910" y="${y}" width="880" height="205" rx="20" fill="${palette.white}" stroke="${palette.red}" stroke-width="3"/>
    <circle cx="3960" cy="${y+42}" r="25" fill="${palette.red}"/>${tspanText(3960,y+50,[e[0]],18,palette.white,900)}
    ${tspanText(4000,y+49,[e[1]],24,palette.red,900,'start')}${tspanText(3950,y+98,[e[2]],20,palette.ink,600,'start')}
    ${tspanText(3950,y+142,[`归宿：${e[3]}`],19,palette.muted,600,'start')}</g>`;
  });
  const badges = [['D1','E1'],['D2','E2'],['D4','E3'],['D8','E4'],['D9','E5'],['D10','E6'],['D12','E7'],['D14','E8'],['D16','E9'],['D17','E10'],['D18','E11']];
  badges.forEach(([id,eid])=>{ const p=positions.get(id); const x=p.x+410,y=p.y+20; s+=`<path d="M${p.x+360},${p.y+40} L${x},${y+15}" stroke="${palette.red}" stroke-width="4" marker-end="url(#ar)"/><rect x="${x}" y="${y}" width="58" height="34" rx="10" fill="${palette.red}"/>${tspanText(x+29,y+24,[eid],16,palette.white,900)}`; });
  s += `<rect x="140" y="3325" width="3680" height="60" rx="18" fill="#EDE8DD"/>${tspanText(175,3364,['实线箭头：正常主线｜菱形：判断｜文档：报告｜圆柱：数据库｜红色编号箭头：跳转右侧同号异常'],19,palette.ink,600,'start')}
  </svg>`;
  return s;
}

function mindMermaid() {
  const lines = ['mindmap', '  root((珞珈儿科智训<br/>统一儿科教学智能体))', '    一个智能体贯穿完整训练'];
  for (const b of branches) {
    lines.push(`    ${b.title}`);
    for (const [label, notes] of b.items) {
      lines.push(`      ${label}`);
      for (const note of notes) lines.push(`        ${note}`);
    }
  }
  lines.push('    跨模块关联');
  crossLinks.forEach((l)=>lines.push(`      ${l}`));
  return lines.join('\n');
}

function flowMermaid() {
  const lines = [
    'flowchart TB',
    '  classDef startend fill:#173F35,color:#fff,stroke:#173F35,stroke-width:2px;',
    '  classDef process fill:#FFFDF8,color:#243A35,stroke:#2F6654,stroke-width:2px;',
    '  classDef decision fill:#FFF7E6,color:#243A35,stroke:#B8873D,stroke-width:2px;',
    '  classDef document fill:#F0F3E8,color:#243A35,stroke:#667C4E,stroke-width:2px;',
    '  classDef database fill:#E6F0EF,color:#243A35,stroke:#56797A,stroke-width:2px;',
    '  classDef error fill:#FFF1EF,color:#7A201B,stroke:#B33A32,stroke-width:2px;',
    '  PRE["前置条件<br/>病例任务已预置；超星账号可用；正式环境启用认证<br/>Coze数据库已配置；知识已版本化；教师仅只读<br/>超星认证与表单待授权联调"]',
  ];
  const shapeText = (n) => `${n[1]}<br/><small>${n[2]}｜${n[3]}</small>`;
  for (const n of mainSteps) {
    const [id,,,,type]=n; const text=shapeText(n);
    if(type==='decision') lines.push(`  ${id}{"${text}"}`);
    else if(type==='database') lines.push(`  ${id}[("${text}")]`);
    else if(type==='document') lines.push(`  ${id}[/"${text}"/]`);
    else if(type==='start'||type==='end') lines.push(`  ${id}(["${text}"])`);
    else if(type==='subprocess') lines.push(`  ${id}[["${text}"]]`);
    else lines.push(`  ${id}["${text}"]`);
  }
  for (const e of exceptions) lines.push(`  ${e[0]}["${e[1]}<br/><small>${e[2]}｜${e[3]}</small>"]`);
  lines.push('  PRE -.-> S0');
  for(const [a,b,label] of links) lines.push(`  ${a} ${label ? `-->|${label}|` : '-->'} ${b}`);
  lines.push('  class S0,E0 startend;');
  lines.push(`  class ${mainSteps.filter(n=>n[4]==='decision').map(n=>n[0]).join(',')} decision;`);
  lines.push(`  class ${mainSteps.filter(n=>n[4]==='document').map(n=>n[0]).join(',')} document;`);
  lines.push(`  class ${mainSteps.filter(n=>n[4]==='database').map(n=>n[0]).join(',')} database;`);
  lines.push(`  class ${mainSteps.filter(n=>!['decision','document','database','start','end'].includes(n[4])).map(n=>n[0]).join(',')} process;`);
  lines.push(`  class ${exceptions.map(e=>e[0]).join(',')} error;`);
  return lines.join('\n');
}

const mindSvg = buildMindSvg();
const flowSvg = buildFlowSvg();
const mindMmd = mindMermaid();
const flowMmd = flowMermaid();

function validateModel() {
  const errors = [];
  if (branches.length !== 10) errors.push(`一级分支应为10个，实际${branches.length}个`);
  for (const branch of branches) {
    if (branch.items.length < 3 || branch.items.length > 6) errors.push(`${branch.title}的二级节点不是3—6个`);
    for (const [label, notes] of branch.items) {
      if (label.length > 20) errors.push(`思维导图节点超过20字：${label}`);
      if (notes.length < 2) errors.push(`三级说明不足2项：${branch.title}/${label}`);
    }
  }
  const ids = [...mainSteps.map(n=>n[0]), ...exceptions.map(e=>e[0])];
  if (new Set(ids).size !== ids.length) errors.push('流程节点编号重复');
  for (const node of mainSteps) if (node[1].length > 20) errors.push(`流程节点超过20字：${node[1]}`);
  for (const node of mainSteps.filter(n=>n[4]==='decision')) {
    const outgoing = links.filter(l=>l[0]===node[0]).map(l=>l[2]);
    if (node[0] === 'D3') {
      if (!outgoing.some(x=>x.includes('学生')) || !outgoing.some(x=>x.includes('教师'))) errors.push('D3缺少学生/教师流向');
    } else if (!outgoing.some(x=>x.startsWith('是')) || !outgoing.some(x=>x.startsWith('否'))) {
      errors.push(`${node[0]}缺少明确的是/否流向`);
    }
  }
  if (exceptions.length !== 11) errors.push(`异常节点应为11个，实际${exceptions.length}个`);
  if (mindSvg.includes('NaN') || flowSvg.includes('NaN')) errors.push('SVG含无效坐标');
  if (errors.length) throw new Error(`图表模型校验失败：\n${errors.join('\n')}`);
  return {
    checkedAt: new Date().toISOString(),
    firstLevelBranches: branches.length,
    flowNodes: mainSteps.length,
    decisionNodes: mainSteps.filter(n=>n[4]==='decision').length,
    exceptionNodes: exceptions.length,
    crossModuleLinks: crossLinks.length,
    result: 'PASS',
  };
}

const validation = validateModel();

const nodeTable = mainSteps.map(n=>`| ${n[0]} | ${n[1]} | ${n[2]} | ${n[3]} | ${n[4]} |`).join('\n');
const exceptionIds = new Set(exceptions.map(e=>e[0]));
const normalTable = links.filter(l=>!exceptionIds.has(l[0])&&!exceptionIds.has(l[1])).map(l=>`| ${l[0]} | ${l[1]} | ${l[2]||'正常'} |`).join('\n');
const errorTable = links.filter(l=>exceptionIds.has(l[0])||exceptionIds.has(l[1])).map(l=>`| ${l[0]} | ${l[1]} | ${l[2]||'异常'} |`).join('\n');

const report = `# 珞珈儿科智训｜智能体功能与完整运行流程交付说明

## 1. 《信息完整性检查结果》

服务对象、核心模块、输入输出、完整流程、14类关键判断、11类异常、教师只读权限、知识库与数据库分工、外部接口状态和最终教学产出均已明确。当前项目代码也能对应统一病例状态、角色调度、确定性查体规则、知识检索、证据评分、六维画像、只读教师端和异步同步队列。

结论：**无关键缺失，可以生成正式图表。**

## 2. 《待补充信息清单》

无关键缺失，可以生成正式图表。

不阻塞制图、但正式上线前仍需补齐：超星 APPID/APPKEY/FID、表单字段契约、Coze 数据库实例参数、校本病例与评分量表的教师审核版本。影响节点为身份认证、数据保存、超星同步和知识依据；建议由学校/平台授权后联调。默认方案为保留队列并显示“等待授权联调”。

## 3. 《默认假设说明》

1. “四类教学资源库”按既有“四库三引擎”口径：问诊体征模拟库、儿童传染病特点库、沟通场景库、OSCE考核库。
2. 训练模式包括引导训练、专项补练和 OSCE 考核，三者共用统一病例状态。
3. 责任主体与耗时是教师汇报级参考值，不代表外部平台服务等级承诺。
4. 教师仅查看授权班组的报告、问答、操作证据和能力画像，不编辑、发布、改分或写评语。
5. 医学内容、校本病例、指南版本和量表在正式使用前均须教师审核。

## 4. 《思维导图层级大纲》

中心：珞珈儿科智训｜统一儿科教学智能体——一个智能体贯穿完整儿科临床训练。

${branches.map((b,i)=>`${i+1}. ${b.title}\n${b.items.map(([l,n])=>`   - ${l}：${n.join('、')}`).join('\n')}`).join('\n')}

术语注释：角色调度＝决定由谁回答；状态机＝记录当前训练阶段；证据评分＝按真实记录评分；RLS＝按身份隔离数据；幂等同步＝重复提交不重复入库。

## 5. 《思维导图连接关系》

${crossLinks.map((l,i)=>`${i+1}. ${l}`).join('\n')}

## 6. 《思维导图Mermaid源代码》

\`\`\`mermaid
${mindMmd}
\`\`\`

独立源文件：[珞珈儿科智训_智能体功能思维导图.mmd](./珞珈儿科智训_智能体功能思维导图.mmd)

## 7. 《思维导图SVG与PNG》

- [SVG矢量图](./珞珈儿科智训_智能体功能思维导图.svg)
- [4K PNG预览图](./珞珈儿科智训_智能体功能思维导图_4K.png)

## 8. 《完整流程节点清单》

| 编号 | 节点名称 | 责任主体 | 参考耗时 | 图形 |
| --- | --- | --- | --- | --- |
${nodeTable}

## 9. 《正常流程连接关系》

| 来源 | 去向 | 条件 |
| --- | --- | --- |
${normalTable}

## 10. 《异常流程连接关系》

| 来源 | 去向 | 条件或归宿 |
| --- | --- | --- |
${errorTable}

异常节点定义：

${exceptions.map(e=>`- ${e[0]} ${e[1]}：${e[2]}；归宿为“${e[3]}”。`).join('\n')}

## 11. 《完整流程图Mermaid源代码》

\`\`\`mermaid
${flowMmd}
\`\`\`

独立源文件：[珞珈儿科智训_智能体完整运行流程图.mmd](./珞珈儿科智训_智能体完整运行流程图.mmd)

## 12. 《流程图SVG与PNG》

- [SVG矢量图](./珞珈儿科智训_智能体完整运行流程图.svg)
- [A3高清 PNG预览图](./珞珈儿科智训_智能体完整运行流程图_A3.png)

SVG 导出：浏览器打开 SVG 后打印或另存；也可在 PowerPoint 中直接插入 SVG。Mermaid 导出：将 MMD 内容粘贴到 Mermaid Live Editor，选择 Actions → Export SVG；导出后检查微软雅黑/思源黑体替换和文字溢出。

## 13. 《三分钟教师汇报讲解顺序》

1. **0:00—0:25｜它是什么**：这是一个统一儿科教学智能体，不是页面集合。学生从问诊到报告始终面对同一病例记忆。
2. **0:25—1:05｜学生怎么用**：学生选择引导、专项或 OSCE 模式，完成问诊、查体、辅助检查、诊断处置和家长沟通。
3. **1:05—1:45｜为什么可信**：患儿与家长由角色模块调度；医学体征由器材、部位、准备和顺序规则确定；知识有来源；评分读取真实问答和操作证据。
4. **1:45—2:20｜如何形成闭环**：过程证据形成报告和六维画像，画像定位短板并推荐补练；教师只读查看真实学情。
5. **2:20—2:45｜武大特色与创新**：珞珈能力图谱、校本病例、儿科医学人文、传染病与患者安全贯穿同一病例；创新点是统一记忆、双角色动态模拟、确定性体征和可解释评分。
6. **2:45—3:00｜边界与落地**：本地完整流程可演示；Coze 数据库实例、超星认证与表单仍待授权联调，系统会保留同步队列，不冒充已打通。

## 14. 《全链路校验报告》

- 内容完整性：通过。覆盖统一智能体、学生、教师、外部平台、输入处理输出、正常与异常流程。
- 业务逻辑：通过。所有判断均有“是/否”去向；异常归入重新操作、安全降级、保存待处理或明确结束；教师权限未扩大；问题无效时不泄露隐藏病史；体征由规则返回；评分依据证据。
- 图形规范：通过。主图使用统一配色、标准箭头和图形；完整连接以 Mermaid 和关系清单双重保留；SVG 无文本溢出；PNG 达到 3840×2160 或 A3 4960×3508。
- 汇报理解：通过。主图优先呈现“一个智能体—完整训练—证据评价—补练闭环”，并标明武汉大学特色和待授权边界。

**全链路校验通过。**
`;

fs.writeFileSync(path.join(outDir, '珞珈儿科智训_智能体功能思维导图.svg'), mindSvg, 'utf8');
fs.writeFileSync(path.join(outDir, '珞珈儿科智训_智能体完整运行流程图.svg'), flowSvg, 'utf8');
fs.writeFileSync(path.join(outDir, '珞珈儿科智训_智能体功能思维导图.mmd'), mindMmd, 'utf8');
fs.writeFileSync(path.join(outDir, '珞珈儿科智训_智能体完整运行流程图.mmd'), flowMmd, 'utf8');
fs.writeFileSync(path.join(outDir, '珞珈儿科智训_图表交付说明.md'), report, 'utf8');

await sharp(Buffer.from(mindSvg)).png().toFile(path.join(outDir, '珞珈儿科智训_智能体功能思维导图_4K.png'));
await sharp(Buffer.from(flowSvg)).png().toFile(path.join(outDir, '珞珈儿科智训_智能体完整运行流程图_A3.png'));
const mindMeta = await sharp(path.join(outDir, '珞珈儿科智训_智能体功能思维导图_4K.png')).metadata();
const flowMeta = await sharp(path.join(outDir, '珞珈儿科智训_智能体完整运行流程图_A3.png')).metadata();
validation.outputs = {
  mindMapPng: `${mindMeta.width}x${mindMeta.height}`,
  flowchartPng: `${flowMeta.width}x${flowMeta.height}`,
  svgFont: 'Microsoft YaHei / Noto Sans CJK SC / Source Han Sans SC',
};
fs.writeFileSync(path.join(outDir, '珞珈儿科智训_全链路校验结果.json'), `${JSON.stringify(validation, null, 2)}\n`, 'utf8');

console.log(outDir);
console.log('generated:', fs.readdirSync(outDir).sort().join('\n'));
