import type { SessionState, Stage } from '@/domain/agent';
import { teachingHints } from '@/domain/teaching-copy';

/** Uses acquired progress only; never reads standard answers or tool/body mappings. */
export function progressHints(session:SessionState, stage:Stage):string[] {
  const hints:string[]=[];
  const asked=new Set(session.askedIntents);
  if(stage==='history') {
    if(!asked.size) hints.push('先听主诉，再核实起病时间和症状演变。');
    if(!asked.has('SOURCE_HX_0')&&!asked.has('HPI_ONSET')) hints.push('起病时间和病程演变还没有形成已采集记录，可继续核实。');
    if(!asked.has('SOURCE_HX_2')&&!asked.has('GENERAL')) hints.push('可继续了解精神、进食、睡眠和排泄情况；资料未知时明确记录。');
    if(!asked.has('SOURCE_HX_4')&&!asked.has('PAST_HISTORY')) hints.push('检查是否已询问既往、过敏和家族等相关病史。');
    if(session.plan&&!session.communication) return ['处置计划已保存，现在用家长能理解的语言解释下一步，并确认对方理解。'];
  }
  if(stage==='exam') {
    if(!session.unlockedEvidence.includes('EX_PREP')) return ['尚未完成手卫生与检查说明，请先完成必要准备。'];
    if(session.events.at(-1)?.type==='EXAM_ACTION'&&session.events.at(-1)?.correct===false) hints.push('最近一次查体未获得有效结果，请复核自己选择的体位、方法和部位。');
    hints.push('根据本次病史自行选择器材、体位与解剖部位；已完成的检查可在记录中回看。');
  }
  if(stage==='tests') hints.push(session.orderedTests.length ? '已有检查记录，请先阅读结果并联系病史、查体；补开时说明要解决的问题。' : '尚无已完成检查，请依据本次已采集的信息提出申请，避免无目的开单。');
  if(stage==='assessment') hints.push(session.decision?'诊断已保存，可回查实际获得的证据后修订依据。':'请先归纳本轮已获得的信息，再说明初步诊断与依据。');
  if(stage==='plan') hints.push(session.plan?'处置计划已保存，核对复评和后续安排后继续沟通。':'先说明当前最优先的处置，再写后续观察、复评与安排。');
  if(stage==='communication'&&session.communication) hints.push('已有沟通记录，可确认家长是否理解下一步，再整理病历。');
  const general=stage==='exam'&&session.unlockedEvidence.includes('EX_PREP')?teachingHints.exam.slice(1):teachingHints[stage];
  return [...new Set([...hints,...general])];
}
