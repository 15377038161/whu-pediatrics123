/** Authorized local evaluation. Uses normal application configuration, never prints credentials or patient text. */
import dotenv from 'dotenv';
import {writeFileSync} from 'node:fs';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {hasAICredentials} from '../../src/lib/coze-ai';
import type {SessionState} from '../../src/domain/agent';

dotenv.config({path:['.env.local','.env'],quiet:true});
const scenarios=[
  {id:'teacher-i型糖尿病伴有酮症酸中毒',questions:['最早是什么不舒服？','这种情况持续多久了？','后来有什么变化？','喝水和小便有什么变化？','比之前明显吗？','吃东西和体重呢？','小朋友，你觉得哪里不舒服？','什么时候更难受？','已经做过什么处理？','吃了以后呢？','最近精神怎么样？有没有呕吐？','以前有类似情况吗？','出生和生长发育情况呢？','家里有没有类似疾病？','您现在最担心什么？','我会先了解清楚，再向您说明安排。还有要补充的吗？','那个变化是一直存在吗？','我指的是前面说的小便变化。','有过敏或者长期用药吗？','谢谢，先请孩子放松，我们接着做检查。']},
  {id:'teacher-新生儿abo溶血性黄疸',questions:['宝宝出生多久了？因为什么来就诊？','皮肤颜色从什么时候开始变化？','后来呢？','范围有变化吗？','吃奶怎么样？','小便和大便是什么样的？','精神和哭声呢？','有没有发热？','出生时情况怎么样？','孕期和分娩有什么特别情况？','之前做过什么处理？','做完以后呢？','以前查过什么？您记得哪些结果？','家里有过类似情况吗？','您最担心什么？','我先检查宝宝，同时会解释每一步。','刚才说的那个是什么意思？','我是问吃奶量有没有变化。','还有什么没有问到的变化？','谢谢您补充，宝宝的情况需要结合检查一起评估。']},
  {id:'teacher-肺炎支原体肺炎',questions:['孩子主要哪里不舒服？','最早什么时候开始？','后来呢？','咳嗽是什么样子的？','晚上和白天有区别吗？','有没有发烧？量过多少？','已经用过什么药？','吃了以后呢？','现在呼吸费力吗？','小朋友，你觉得哪里疼或者不舒服？','还是那个地方吗？','这几天精神和吃饭怎么样？','小便呢？','以前有类似的病吗？','有过敏或接触类似病人吗？','家长现在最担心什么？','我会轻轻检查，不舒服可以告诉我。','这个情况是一直这样，还是后来才有？','我是问咳嗽的变化。','还有需要补充的吗？']},
];
async function main(){
  const records=[];const configured=hasAICredentials();
  for(const scenario of scenarios){
    let state:SessionState=createInitialSession('local-dialogue-evaluation','guided',scenario.id);
    const turns=[];
    for(let i=0;i<scenario.questions.length;i++){
      const result=await runAgentTurn(state,{type:'ASK_QUESTION',data:{text:scenario.questions[i]}},`dialogue-${i}`);
      state=result.session;
      turns.push({turn:i+1,question:scenario.questions[i],runtime:result.runtime,reply:result.newMessages.filter(m=>m.actor!=='student').map(m=>({actor:m.actor,text:m.content})),factIds:state.dialogueMemory?.lastFactIds});
      if(i===9)state=JSON.parse(JSON.stringify(state));
      console.log(JSON.stringify({scenario:records.length+1,turn:i+1,execution:result.runtime?.execution,errorKind:result.runtime?.errorKind??null}));
    }
    records.push({caseId:scenario.id,version:state.teachingPackageVersion,refreshAt:10,turns});
  }
  const executions=records.flatMap(r=>r.turns).reduce((a,t)=>{const key=t.runtime?.execution??'unknown';a[key]=(a[key]??0)+1;return a;},{} as Record<string,number>);
  writeFileSync('outputs/training-20261107/dialogue-evaluation.json',JSON.stringify({configured,executions,records},null,2));
  console.log(JSON.stringify({configured,scenarios:records.length,turns:60,executions}));
}
void main();
