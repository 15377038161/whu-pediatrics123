import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionState } from '@/domain/agent';
import { resolveCommunicationProfile } from '@/domain/communication-profile';
import type { HistoryFact } from '@/domain/teaching-package';
import { contextualHistorySelection, historyDialogue, sourceHistoryFacts, validateHistoryDialogue,disclosedHistoryCodes,conversationAct } from '@/lib/history-dialogue';

const facts:HistoryFact[]=[
  {id:'hx-time',text:'咳嗽3天。',topics:['呼吸相关症状','起病与病程'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
  {id:'hx-treatment',text:'昨天用过退热药，体温下降后仍咳嗽。',topics:['已用药物与院外处理'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
  {id:'hx-pain',text:'孩子说右胸疼。',childText:'这里右边胸口疼。',topics:['疼痛及消化道症状'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
  {id:'hx-negative',text:'无血尿，无抽搐。',topics:['水肿及尿液变化','神经、意识与肢体功能'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
];
function state():SessionState{return {stage:'history',messages:[],askedIntents:[],behavior:{cooperation:50}} as unknown as SessionState;}
const profile=resolveCommunicationProfile('synthetic','8岁');
test('问诊和解释按内容识别，解释时不给模型尚未披露的病史',async()=>{
  assert.equal(conversationAct('接下来我们先抽血检查，您理解吗？'),'explanation');
  assert.equal(conversationAct('我先问一下，有没有过敏？'),'question');
  assert.equal(conversationAct('吃了以后呢？'),'question');
  const s=state();s.askedIntents=['hx-time'];
  const result=await historyDialogue(s,'接下来我们先检查，您理解吗？',facts,profile,undefined,async input=>{
    const content=JSON.parse(input.messages[1].content as string);
    assert.deepEqual(content.facts.map((f:{id:string})=>f.id),['hx-time']);
    return {content:JSON.stringify({topic:'检查配合',utterances:[{actor:'parent',text:'您刚才说的我听明白了，我们会配合。',factIds:[]}]})};
  },'explanation');
  assert.equal(result.runtime.execution,'model');assert.deepEqual(disclosedHistoryCodes(result.dialogue,facts),[]);
  assert.equal(validateHistoryDialogue({topic:'交流',utterances:[{actor:'parent',text:'谢谢医生，今天有血尿。',factIds:[]}]},facts,profile,'history'),null);
});
test('新病例包拆成细事实，剂量与药物相邻，旧编号规则保持',()=>{
  const text='咳嗽3天，昨日发热，无血尿。';
  assert.equal(sourceHistoryFacts(text).length,1);
  assert.equal(sourceHistoryFacts(text,true).length,3);
  assert.ok(sourceHistoryFacts(text,true).every(f=>/^SOURCE_HX_0_\d$/.test(f.id)));
});
test('未实际说出的引用不计分，漏说关键数值仅记部分证据',()=>{
  const make=(text:string)=>({topic:'症状',utterances:[{actor:'parent' as const,text,factIds:['hx-time']}]});
  assert.deepEqual(disclosedHistoryCodes(make('医生，我很担心。'),facts),[]);
  assert.deepEqual(disclosedHistoryCodes(make('有咳嗽。'),facts),['hx-time__partial']);
  assert.deepEqual(disclosedHistoryCodes(make('咳嗽3天了。'),facts),['hx-time']);
});

test('承接追问使用上一问的用药主题，不把“之后呢”当作无资料',()=>{
  const s=state();s.messages=[{actor:'student',content:'用过什么药？'}] as SessionState['messages'];s.dialogueMemory={topic:'已用药物与院外处理',lastFactIds:['hx-treatment'],clarifiedQuestion:null,concern:null};
  assert.ok(contextualHistorySelection(s,'吃了以后呢？',facts).facts.some(f=>f.id==='hx-treatment'));
});
test('模型选择不受前置三句截断，且只解锁实际引用的事实',async()=>{
  const many=Array.from({length:7},(_,i)=>({...facts[0],id:`fact-${i}`,text:`已有事实${i}。`}));
  const result=await historyDialogue(state(),'补充说说相关情况',many,profile,undefined,async()=>({content:JSON.stringify({topic:'本轮主题',utterances:[{actor:'parent',text:'已有事实6。',factIds:['fact-6']}]})}));
  assert.equal(result.runtime.execution,'model');assert.deepEqual(result.dialogue.utterances[0].factIds,['fact-6']);
});
test('不存在的事实、捏造数值、未到阶段及婴儿台词均拒绝',()=>{
  const reply=(text:string,id:string)=>({topic:'测试',utterances:[{actor:'parent',text,factIds:[id]}]});
  assert.equal(validateHistoryDialogue(reply('咳嗽9天','hx-time'),facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue(reply('咳嗽3天','other-case-id'),facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue(reply('咳嗽3天','hx-time'),[{...facts[0],availableFromStage:'tests'}],profile,'history'),null);
  assert.equal(validateHistoryDialogue({topic:'测试',utterances:[{actor:'child',text:'右胸疼',factIds:['hx-pain']}]},facts,resolveCommunicationProfile('synthetic','2天'),'history'),null);
});
test('保留关键阴性，不允许改成相反症状，也不允许角色给标准诊断',()=>{
  assert.equal(validateHistoryDialogue({topic:'测试',utterances:[{actor:'parent',text:'有血尿。',factIds:['hx-negative']}]},facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue({topic:'测试',utterances:[{actor:'parent',text:'正确诊断是肺炎。',factIds:['hx-time']}]},facts,profile,'history'),null);
});
test('中文数词保持原值可用，改天为周或用同义词翻转阴性仍拒绝',()=>{
  const make=(text:string)=>({topic:'病程',utterances:[{actor:'parent' as const,text,factIds:['hx-time']}]});
  assert.ok(validateHistoryDialogue(make('咳嗽三天了'),facts,profile,'history'));
  assert.deepEqual(disclosedHistoryCodes(make('咳嗽三天了'),facts),['hx-time']);
  assert.equal(validateHistoryDialogue(make('咳嗽三周了'),facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue(make('咳嗽十天了'),facts,profile,'history'),null);
  const negative={...facts[0],text:'无发热。'};
  assert.equal(validateHistoryDialogue(make('有发烧。'),[negative],profile,'history'),null);
});
test('直接问能表达的儿童自身感受可由儿童回答，出生用药仍由家长补充',async()=>{
  const old=process.env.ENABLE_AI_FIXTURE;process.env.ENABLE_AI_FIXTURE='true';
  try{
    const child=await historyDialogue(state(),'小朋友，你哪里疼？',facts,profile);
    assert.equal(child.dialogue.utterances[0].actor,'child');
    const parent=await historyDialogue(state(),'昨天用过什么药？',facts,profile);
    assert.equal(parent.dialogue.utterances[0].actor,'parent');
  }finally{if(old===undefined)delete process.env.ENABLE_AI_FIXTURE;else process.env.ENABLE_AI_FIXTURE=old;}
});
test('来源事实保持原索引证据码，身份字段先脱敏',()=>{
  const result=sourceHistoryFacts('姓名：合成姓名；咳嗽3天。无血尿。');
  assert.equal(result.some(f=>f.text.includes('合成姓名')),false);
  assert.ok(result.some(f=>f.id==='SOURCE_HX_1'&&f.text==='咳嗽3天'));
});
test('三类角色各20轮上下文与刷新恢复，模拟模型无越界输出',async()=>{
  for(const age of ['2天','6岁','13岁']){
    let session=state();const p=resolveCommunicationProfile('synthetic',age);
    for(let turn=0;turn<20;turn++){
      const question=turn%3===0?'用过什么药？':turn%3===1?'吃了以后呢？':'咳嗽多久了？';
      const id=turn%3<2?'hx-treatment':'hx-time';const selected=facts.find(f=>f.id===id)!;
      const result=await historyDialogue(session,question,facts,p,undefined,async()=>({content:JSON.stringify({topic:selected.topics[0],utterances:[{actor:'parent',text:selected.text,factIds:[id]}]})}));
      assert.equal(result.runtime.execution,'model');assert.equal(result.dialogue.utterances[0].factIds[0],id);
      session.messages.push({actor:'student',content:question} as SessionState['messages'][number],{actor:'parent',content:result.dialogue.utterances[0].text} as SessionState['messages'][number]);
      session.dialogueMemory={topic:result.dialogue.topic,lastFactIds:[id],clarifiedQuestion:null,concern:null};
      if(turn===9)session=JSON.parse(JSON.stringify(session));
    }
    assert.equal(session.messages.length,40);
  }
});
