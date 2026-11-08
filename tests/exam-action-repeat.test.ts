import './fixtures/legacy-engine-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialSession,runAgentTurn} from '../src/lib/agent-engine';
import {isRepeatedExamAction} from '../src/domain/exam-action-identity';
import type {AgentEvent,SessionState} from '../src/domain/agent';

const prepare:AgentEvent={type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}};
const lung:Extract<AgentEvent,{type:'EXAM_ACTION'}>={type:'EXAM_ACTION',data:{toolId:'stethoscope',bodyPartId:'chest',position:'standing',location:{side:'both',aspect:'front'}}};
test('repeated valid exam is quiet, stable after serialization, and does not add records, speech or score evidence',async()=>{
  let state=createInitialSession('repeat-test','immersive');
  await runAgentTurn(state,prepare,'prepare');await runAgentTurn(state,lung,'first');
  const saved=JSON.stringify({events:state.events,messages:state.messages,evidence:state.unlockedEvidence,vitals:state.vitals});
  state=JSON.parse(JSON.stringify(state)) as SessionState;
  assert.equal(isRepeatedExamAction(state,lung.data),true);
  const sameTransport=await runAgentTurn(state,lung,'first');
  assert.equal(sameTransport.repeated,true);assert.equal(sameTransport.feedback,null);
  const repeated=await runAgentTurn(state,lung,'new-transport-id');
  assert.equal(repeated.repeated,true);assert.equal(repeated.feedback,null);assert.deepEqual(repeated.newMessages,[]);
  assert.equal(JSON.stringify({events:state.events,messages:state.messages,evidence:state.unlockedEvidence,vitals:state.vitals}),saved);
  const other={...lung.data,location:{side:'left' as const,aspect:'front' as const}};
  assert.equal(isRepeatedExamAction(state,other),false,'another specified side is a distinct operation');
  assert.equal(isRepeatedExamAction(state,{...lung.data,position:'supine'}),false);
});
test('repeated wrong tool does not repeat feedback; completing preparation allows a previously blocked operation',async()=>{
  const state=createInitialSession('repeat-error-test','immersive');
  const wrong:AgentEvent={type:'EXAM_ACTION',data:{toolId:'axillary-thermometer',bodyPartId:'eyes',position:'standing'}};
  await runAgentTurn(state,wrong,'wrong-first');const count=state.events.length;
  const again=await runAgentTurn(state,wrong,'wrong-second');assert.equal(again.repeated,true);assert.equal(state.events.length,count);assert.equal(again.feedback,null);
  const blocked=createInitialSession('repeat-prep-test','immersive');
  await runAgentTurn(blocked,lung,'before-prep');
  await runAgentTurn(blocked,prepare,'do-prep');
  assert.equal(isRepeatedExamAction(blocked,lung.data),false);
  const result=await runAgentTurn(blocked,lung,'after-prep');assert.notEqual(result.repeated,true);assert.equal(blocked.events.at(-1)?.correct,true);
});
test('historical coarse evidence does not impersonate a new localized check',async()=>{
  const state=createInitialSession('repeat-legacy-test','immersive');
  await runAgentTurn(state,prepare,'prep');await runAgentTurn(state,lung,'old');
  delete state.events.at(-1)!.examAction;
  assert.equal(isRepeatedExamAction(state,lung.data),false);
});
