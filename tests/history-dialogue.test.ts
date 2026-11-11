import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionState } from '@/domain/agent';
import { resolveCommunicationProfile } from '@/domain/communication-profile';
import type { HistoryFact } from '@/domain/teaching-package';
import { contextualHistorySelection, historyDialogue, inspectHistoryDialogue, sourceHistoryFacts, validateHistoryDialogue,disclosedHistoryCodes,conversationAct } from '@/lib/history-dialogue';

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

test('概括询问起病时只回答主诉对应的时间，不倾倒既往和排便日期',async()=>{
  const onset:HistoryFact[]=[
    {id:'SOURCE_HX_-2',text:'咳嗽3天，发热1天。',topics:['主要不适'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'now-cough',text:'咳嗽3天',topics:['起病与病程','呼吸相关症状'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'now-fever',text:'发热1天',topics:['起病与病程','发热与处理'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'past',text:'既往1个月前有过住院。',topics:['起病与病程','既往、过敏、接种及家族史'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
    {id:'stool',text:'大便2天1次。',topics:['起病与病程','一般状态、进食及排泄'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
  ];
  assert.deepEqual(contextualHistorySelection(state(),'孩子什么时候开始不舒服的？',onset).facts.map(f=>f.id),['now-cough','now-fever']);
  const result=await historyDialogue(state(),'孩子什么时候开始不舒服的？',onset,profile,undefined,async()=>{throw Error('synthetic model unavailable');});
  assert.equal(result.runtime.execution,'model_fallback');
  assert.deepEqual(disclosedHistoryCodes(result.dialogue,onset),['now-cough','now-fever']);
  assert.equal(result.dialogue.utterances.some(u=>/住院|大便/.test(u.text)),false);
  assert.ok(contextualHistorySelection(state(),'以前是什么时候住院的？',onset).facts.some(f=>f.id==='past'),'specific past-history question must retain its facts');
});
test('持续与年龄追问只取当前主题，模型和降级都不倾倒整段现病史',async()=>{
  const scoped:HistoryFact[]=[
    {id:'SOURCE_HX_-2',text:'发热、咳嗽伴声嘶1天',topics:['主要不适'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'SOURCE_HX_-1',text:'孩子8岁27天，女。',topics:['年龄与性别'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
    {id:'SOURCE_HX_3_0',text:'患儿1天前无明显诱因出现发热',topics:['起病与病程','发热与处理'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'SOURCE_HX_3_1',text:'最高体温为39℃',topics:['发热与处理'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'SOURCE_HX_3_5',text:'无吸气性呼吸困难',topics:['呼吸相关症状'],actor:'mixed',origin:'source',sourceLocator:'synthetic'},
    {id:'SOURCE_HX_4_0',text:'起病以来',topics:['起病与病程'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
    {id:'SOURCE_HX_4_1',text:'食欲及睡眠欠佳',topics:['一般状态、进食及排泄'],actor:'parent',origin:'source',sourceLocator:'synthetic'},
  ];
  assert.deepEqual(contextualHistorySelection(state(),'持续多久了？',scoped).facts.map(f=>f.id),['SOURCE_HX_-2']);
  assert.deepEqual(contextualHistorySelection(state(),'多大了？',scoped).facts.map(f=>f.id),['SOURCE_HX_-1']);
  let modelFactIds:string[]=[];
  const model=await historyDialogue(state(),'持续多久了？',scoped,profile,undefined,async input=>{
    const payload=JSON.parse(input.messages[1].content as string);
    modelFactIds=payload.facts.map((fact:HistoryFact)=>fact.id);
    return {content:JSON.stringify({topic:'主要不适',clarification:null,utterances:[{actor:'parent',text:'发热、咳嗽和声音嘶哑1天了。',factIds:['SOURCE_HX_-2']}]})};
  });
  assert.equal(model.runtime.execution,'model');
  assert.deepEqual(modelFactIds,['SOURCE_HX_-2']);
  const durationFallback=await historyDialogue(state(),'持续多久了？',scoped,profile,undefined,async()=>{throw Error('synthetic model unavailable');});
  assert.equal(durationFallback.runtime.execution,'model_fallback');
  assert.match(durationFallback.dialogue.utterances[0].text,/1天/);
  assert.doesNotMatch(durationFallback.dialogue.utterances[0].text,/39℃|呼吸|8岁|起病以来|食欲|睡眠/);
  const ageFallback=await historyDialogue(state(),'多大了？',scoped,profile,undefined,async()=>{throw Error('synthetic model unavailable');});
  assert.match(ageFallback.dialogue.utterances[0].text,/8岁27天/);
  assert.doesNotMatch(ageFallback.dialogue.utterances[0].text,/发热|咳嗽|起病以来|食欲|睡眠/);
});


test('模型只在筛选上下文内选择且不受前三句截断，只解锁实际引用的事实',async()=>{
  const many=Array.from({length:7},(_,i)=>({...facts[0],id:`fact-${i}`,text:`已有事实${i}。`}));
  let selectedId='';
  const result=await historyDialogue(state(),'咳嗽多久了？',many,profile,undefined,async input=>{
    const payload=JSON.parse(input.messages[1].content as string);
    const selected=payload.facts.at(-1) as HistoryFact;
    selectedId=selected.id;
    return {content:JSON.stringify({topic:'本轮主题',utterances:[{actor:'parent',text:selected.text,factIds:[selected.id]}]})};
  });
  assert.equal(result.runtime.execution,'model');assert.deepEqual(result.dialogue.utterances[0].factIds,[selectedId]);
});
test('不存在的事实、捏造数值、未到阶段及婴儿台词均拒绝',()=>{
  const reply=(text:string,id:string)=>({topic:'测试',utterances:[{actor:'parent',text,factIds:[id]}]});
  assert.equal(validateHistoryDialogue(reply('咳嗽9天','hx-time'),facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue(reply('咳嗽3天','other-case-id'),facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue(reply('咳嗽3天','hx-time'),[{...facts[0],availableFromStage:'tests'}],profile,'history'),null);
  assert.equal(validateHistoryDialogue({topic:'测试',utterances:[{actor:'child',text:'右胸疼',factIds:['hx-pain']}]},facts,resolveCommunicationProfile('synthetic','2天'),'history'),null);
});
test('模型降级只返回安全校验原因码，不包含模型原文或私有事实',async()=>{
  const invalid={topic:'病程',utterances:[{actor:'parent' as const,text:'咳嗽9天。',factIds:['hx-time']}]};
  const inspected=inspectHistoryDialogue(invalid,facts,profile,'history');
  assert.equal(inspected.dialogue,null);
  assert.deepEqual(inspected.issues.map(issue=>`${issue.code}@${issue.utteranceIndex}`),['ungrounded_number@0','ungrounded_quantity@0']);
  const result=await historyDialogue(state(),'咳嗽多久了？',facts,profile,undefined,async()=>({content:JSON.stringify(invalid)}));
  assert.equal(result.runtime.execution,'model_fallback');
  assert.equal(result.runtime.errorKind,'ungrounded_dialogue');
  assert.deepEqual(result.runtime.validationReasons,['ungrounded_number@0','ungrounded_quantity@0']);
  assert.equal(JSON.stringify(result.runtime).includes('咳嗽9天'),false);
});
test('首次绑定失败最多纠错一次，第二次仍须通过同一校验器',async()=>{
  let calls=0;
  const repaired=await historyDialogue(state(),'咳嗽多久了？',facts,profile,undefined,async input=>{
    calls++;
    if(calls===1)return {content:JSON.stringify({topic:'病程',utterances:[{actor:'parent',text:'咳嗽9天。',factIds:['hx-time']}]})};
    const correction=JSON.parse(input.messages.at(-1)?.content as string);
    assert.deepEqual(correction.validationReasons,['ungrounded_number@0','ungrounded_quantity@0']);
    return {content:JSON.stringify({topic:'病程',utterances:[{actor:'parent',text:'咳嗽3天。',factIds:['hx-time']}]})};
  });
  assert.equal(calls,2);assert.equal(repaired.runtime.execution,'model');assert.equal(repaired.runtime.attempts,2);
  let failedCalls=0;
  const failed=await historyDialogue(state(),'咳嗽多久了？',facts,profile,undefined,async()=>{
    failedCalls++;return {content:JSON.stringify({topic:'病程',utterances:[{actor:'parent',text:'咳嗽9天。',factIds:['hx-time']}]})};
  });
  assert.equal(failedCalls,2);assert.equal(failed.runtime.execution,'model_fallback');assert.equal(failed.runtime.attempts,2);
});
test('否定句中的有症状子串不误判，真正阴性翻转仍拒绝',()=>{
  const negative={...facts[0],text:'无腹痛腹泻。'};
  const make=(text:string)=>({topic:'消化道',utterances:[{actor:'parent' as const,text,factIds:['hx-time']}]});
  assert.ok(validateHistoryDialogue(make('没有拉肚子。'),[negative],profile,'history'));
  assert.ok(validateHistoryDialogue(make('未出现腹泻。'),[negative],profile,'history'));
  assert.equal(validateHistoryDialogue(make('有腹泻。'),[negative],profile,'history'),null);
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
test('中文范围、孕周和常见单位只做有源事实的等价转换',()=>{
  const source:HistoryFact={id:'hx-values',text:'胎龄38+5周，BW3.4Kg；配方奶30ml/次，2-3h/次，伴吐奶2次；大便1次/3-4天。',topics:['出生、喂养与生长发育'],actor:'parent',origin:'source',sourceLocator:'synthetic'};
  const make=(text:string)=>({topic:'数值',utterances:[{actor:'parent' as const,text,factIds:['hx-values']}]});
  assert.ok(validateHistoryDialogue(make('胎龄38周多5天，出生体重3.4公斤，配方奶每次30毫升，每两三个小时喂一次，吐奶两次，大便三四天一次。'),[source],profile,'history'));
  const wrongRange=inspectHistoryDialogue(make('胎龄38周多5天，出生体重3.4公斤，配方奶每次30毫升，每两三个小时喂一次，吐奶两次，大便四五天一次。'),[source],profile,'history');
  assert.equal(wrongRange.dialogue,null);assert.ok(wrongRange.issues.some(issue=>issue.code==='ungrounded_quantity'));
  assert.equal(validateHistoryDialogue(make('胎龄38周多6天，出生体重3.4公斤。'),[source],profile,'history'),null);
  assert.equal(validateHistoryDialogue(make('胎龄38周多5天，出生体重4.3公斤。'),[source],profile,'history'),null);
  assert.equal(validateHistoryDialogue(make('配方奶每次30毫升，每2到4小时喂。'),[source],profile,'history'),null);
});
test('指示性这一次不算次数，新增病史次数仍须拒绝',()=>{
  const infection:HistoryFact={id:'hx-infection',text:'前10天曾有新型冠状病毒感染病史',topics:['既往、过敏、接种及家族史'],actor:'parent',origin:'source',sourceLocator:'synthetic'};
  const make=(text:string)=>({topic:'既往史',utterances:[{actor:'parent' as const,text,factIds:['hx-infection']}]});
  assert.ok(validateHistoryDialogue(make('十天前得过新冠。'),[infection],profile,'history'));
  assert.equal(validateHistoryDialogue(make('十天前得过一次新冠。'),[infection],profile,'history'),null);
  const negative:HistoryFact={id:'hx-negative',text:'无发热',topics:['发热与处理'],actor:'parent',origin:'source',sourceLocator:'synthetic'};
  const treatment:HistoryFact={id:'hx-treatment',text:'静注治疗2天，仍有咳嗽伴喘息',topics:['已用药物与院外处理'],actor:'parent',origin:'source',sourceLocator:'synthetic'};
  assert.ok(validateHistoryDialogue({topic:'发热与治疗',utterances:[{actor:'parent',text:'孩子这一次从一开始就没发烧，在外院输了两天药也没见好。',factIds:['hx-negative','hx-treatment']}]},[negative,treatment],profile,'history'));
});
test('空编号只允许纯不确定性表达，不能夹带医学否定或阳性结论',()=>{
  const make=(text:string)=>({topic:'未知信息',utterances:[{actor:'parent' as const,text,factIds:[]}]});
  assert.ok(validateHistoryDialogue(make('这一点我没留意，不能确定。'),facts,profile,'history'));
  assert.ok(validateHistoryDialogue(make('这部分我不太记得，可以请家长补充一下吗？'),facts,profile,'history'));
  assert.ok(validateHistoryDialogue(make('有没有皮疹我记不得了。'),facts,profile,'history'));
  assert.ok(validateHistoryDialogue(make('湿疹情况我暂时没法确认。'),facts,profile,'history'));
  assert.equal(validateHistoryDialogue(make('这一点我不确定，没有皮疹。'),facts,profile,'history'),null);
  assert.equal(validateHistoryDialogue(make('没有水肿。'),facts,profile,'history'),null);
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
