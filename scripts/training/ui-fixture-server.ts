/** Loopback-only UI acceptance adapter. Existing engine + projection, synthetic user, no database/auth writes.
 * Browser request routing explicitly uses this adapter; the app's real auth is never changed.
 */
import {createServer,request as httpRequest} from 'node:http';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {projectSessionForRole} from '../../src/lib/session-projection';
import {buildReport} from '../../src/lib/scoring';
import {findReleasedMedia,getCaseMediaLink} from '../../src/lib/case-media';
import {NOTE_TEMPLATE,NOTE_TEMPLATE_VERSION,normalizeNoteContent,type NoteContent} from '../../src/domain/medical-note';
import type {NoteView} from '../../src/lib/note-projection';
import {projectReportForRole} from '../../src/lib/report-projection';
import {agentTurnSchema,createSessionSchema} from '../../src/lib/validation';
import type {TrainingReport} from '../../src/domain/agent';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {readTeachingPackage} from '../../src/lib/teaching-package-store';
import {recordSchema} from '../../src/lib/teacher-case-data';
import {registerControlledCase} from '../../src/lib/controlled-case-store';
import {computeCaseDataVersion} from '../../src/lib/case-data-version';
import type {SessionMode,PracticeFocus} from '../../src/domain/agent';

process.env.ENABLE_AI_FIXTURE='true';
function createFixtureSession(mode:SessionMode,caseId:string,focus?:PracticeFocus){
  const generation=process.env.PEDIATRICS_UI_FIXTURE_GENERATION_ROOT;
  const pack=generation?readTeachingPackage(caseId):null;
  if(generation){
    if(!pack)throw Error('FIXTURE_PACKAGE_NOT_FOUND');
    const record=recordSchema.parse(JSON.parse(readFileSync(path.join(generation,'source-cases',`${pack.sourceId}.json`),'utf8')));
    if(record.caseId!==pack.sourceId||computeCaseDataVersion(record)!==pack.sourceVersion)throw Error('FIXTURE_SOURCE_VERSION_MISMATCH');
    registerControlledCase(record,pack.sourceVersion);
  }
  return createInitialSession('local-ui-validation',mode,caseId,focus,pack?.sourceVersion);
}
let session=createFixtureSession('guided','teacher-i型糖尿病伴有酮症酸中毒');
let report:TrainingReport|null=null;
let draft:{content:NoteContent}|null=null;
let notes:NoteView[]=[];
const noteEvents=new Map<string,NoteView>();
const creationRequests=new Map<string,string>();
const user={id:'local-ui-validation',role:'student',displayName:'本地界面验收',studentNo:'LOCAL-ONLY',className:'本地界面验收'};
createServer(async(req,res)=>{
  if(!req.url?.startsWith('/api/') && req.url !== '/reset'){
    const upstream=httpRequest({hostname:'127.0.0.1',port:8876,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:8876'}},incoming=>{res.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end('Local Next preview is not running on 8876.');});
    req.pipe(upstream);return;
  }
  const reply=(data:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({ok:status<400,data}));};
  try{
    const url=new URL(req.url??'/', 'http://127.0.0.1:8786');
    let body='';for await(const chunk of req)body+=chunk;
    const data=body?JSON.parse(body):{};
    if(url.pathname==='/reset'){session=createFixtureSession(data.mode??'guided',data.caseId??session.caseId,data.practiceFocus);report=null;draft=null;notes=[];noteEvents.clear();return reply({id:session.id});}
    if(url.pathname==='/api/auth/me')return reply({user});
    if(url.pathname==='/api/agent/turn'){
      const parsed=agentTurnSchema.parse(data);
      if(parsed.sessionId!==session.id)return reply(null,404);
      const turn=await runAgentTurn(session,parsed.event,parsed.clientEventId);
      return reply({...turn,session:projectSessionForRole(session,'student')});
    }
    if(url.pathname.endsWith('/direction-hint'))return reply({used:0,remaining:3,hint:'先核对当前主题的已有记录。'});
    if(url.pathname.endsWith('/media')){
      const id=url.searchParams.get('fileId')??'';const media=findReleasedMedia(session,id);
      if(!media)return reply(null,404);
      return reply({...await getCaseMediaLink(id),caption:media.caption});
    }
    if(url.pathname.endsWith('/finish')){await runAgentTurn(session,{type:'FINISH_SESSION',data:{}},'finish-'+session.id);report=buildReport(session,session.id,{noteText:notes[0]?NOTE_TEMPLATE.map(s=>s.label+'：'+notes[0].content[s.key]).join('；'):''});return reply(projectReportForRole(report,'student'),201);}
    if(/^\/api\/reports\/[^/]+\/review$/.test(url.pathname)){
      if(req.method==='GET')return reply(null);
      res.writeHead(503,{'content-type':'application/json'});
      res.end(JSON.stringify({ok:false,error:{code:'REVIEW_FIXTURE_UNAVAILABLE',message:'本地界面适配器不调用真实综合复盘模型；请在受控服务器预览验证。',retryable:false}}));return;
    }
    if(url.pathname.startsWith('/api/reports/'))return reply(report?projectReportForRole(report,'student'):null);
    if(url.pathname==='/api/speech/capabilities')return reply({available:false,tts:{available:false},asr:{available:false}});
    if(url.pathname==='/api/sessions'&&req.method==='POST'){
      const parsed=createSessionSchema.parse(data);
      if(parsed.clientRequestId&&creationRequests.has(parsed.clientRequestId)){
        if(creationRequests.get(parsed.clientRequestId)!==session.id)return reply(null,409);
        return reply(projectSessionForRole(session,'student'),201);
      }
      // Single-session local harness: actually create the requested mode/focus;
      // never return a guided session and label it OSCE/practice coverage.
      session=createFixtureSession(parsed.mode,parsed.caseId??session.caseId,parsed.focus);
      report=null;draft=null;notes=[];noteEvents.clear();
      if(parsed.clientRequestId)creationRequests.set(parsed.clientRequestId,session.id);
      return reply(projectSessionForRole(session,'student'),201);
    }
    if(url.pathname.startsWith('/api/sessions/')){
      if(url.pathname!==`/api/sessions/${session.id}`)return reply(null,404);
      return reply(projectSessionForRole(session,'student'));
    }
    if(url.pathname==='/api/notes/draft'&&req.method==='PUT'){draft={content:normalizeNoteContent(data.content)};return reply(draft);}
    if(url.pathname==='/api/notes'&&req.method==='POST'){
      const old=noteEvents.get(data.clientEventId);if(old)return reply(old);
      const content=normalizeNoteContent(data.content);if(!Object.values(content).some(t=>t.trim()))return reply(null,422);
      const now=new Date().toISOString();const note:NoteView={id:crypto.randomUUID(),userId:user.id,sessionId:session.id,templateVersion:NOTE_TEMPLATE_VERSION,content,submittedAt:now,createdAt:now,aiReviewStatus:'pending',aiReview:null,aiPromptVersion:null,revisionIndex:notes.length+1};
      notes.unshift(note);noteEvents.set(data.clientEventId,note);return reply(note,201);
    }
    if(url.pathname==='/api/notes')return reply({draft,submissions:notes});
    if(url.pathname.startsWith('/api/notes/'))return reply(null,503);
    if(url.pathname==='/api/engagement')return reply({accepted:true});
    return reply([]);
  }catch{reply(null,422);}
}).listen(8875,'127.0.0.1',()=>console.log(JSON.stringify({localFixturePort:8875,databaseWrites:false,realAuthentication:false,sourceSnapshotVersion:session.sourceSnapshotVersion,teachingPackageVersion:session.teachingPackageVersion})));
