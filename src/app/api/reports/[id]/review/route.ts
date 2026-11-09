import {NextRequest} from 'next/server';
import {requireAuth} from '@/lib/request-auth';
import {AgentRepository} from '@/lib/repository';
import {ok,fail,errorFromUnknown} from '@/lib/api-result';
import {AIGatewayError,invokeCozeAI} from '@/lib/coze-ai';
import {platformForwardHeaders} from '@/lib/platform-forward-headers';
import {assertReviewContext,buildPostVisitReviewInput,buildPostVisitReviewMessages,parsePostVisitReview,POST_VISIT_REVIEW_PROMPT,savedReviewMatches} from '@/lib/post-visit-review';
import type {SavedPostVisitReview} from '@/domain/post-visit-review';

const pending=new Map<string,Promise<SavedPostVisitReview>>();
export const maxDuration=120;
export const dynamic='force-dynamic';
async function handle(request:NextRequest,context:{params:Promise<{id:string}>},generate:boolean){
  try{
    const user=await requireAuth(request);
    const {id}=await context.params,repo=new AgentRepository(user);
    const report=await repo.getReport(id),session=await repo.getSession(report.sessionId);
    assertReviewContext(report,session);
    if(generate&&report.userId!==user.id)return fail({code:'FORBIDDEN',message:'仅本次训练的本人可以发起综合复盘。',retryable:false},undefined,403);
    if(savedReviewMatches(session.postVisitReview,report,session))return ok(session.postVisitReview);
    if(!generate)return ok(null);
    const key=`${user.id}:${id}`;
    let task=pending.get(key);
    if(!task){
      task=(async()=>{
        const notes=await repo.listMyNotes(session.id);
        const note=notes.find(item=>(item.caseVersion??null)===(session.sourceSnapshotVersion??null)
          &&Date.parse(item.submittedAt)<=Date.parse(report.createdAt));
        const {input,evidence,inputHash}=buildPostVisitReviewInput(report,session,note?.content??null);
        const model=process.env.COZE_AI_REPORT_MODEL?.trim()||'doubao-seed-1-8-251228';
        const started=Date.now();
        const response=await invokeCozeAI({messages:buildPostVisitReviewMessages(input),
          forwardHeaders:platformForwardHeaders(request.headers,user.accessToken),
          llmConfig:{model,thinking:'enabled',temperature:0.2,maxTokens:8000},timeoutMs:90000,maxAttempts:1});
        const content=parsePostVisitReview(response.content,evidence,JSON.stringify(input));
        if(!content)throw Error('REVIEW_INVALID');
        const saved:SavedPostVisitReview={reportId:id,sourceVersion:session.sourceSnapshotVersion??null,teachingVersion:session.teachingPackageVersion??null,
          model,inputHash,promptVersion:POST_VISIT_REVIEW_PROMPT,generatedAt:new Date().toISOString(),attempts:response.attempts,durationMs:Date.now()-started,content};
        await repo.savePostVisitReview(session.id,saved);
        return saved;
      })();
      pending.set(key,task);
      void task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>undefined);
    }
    return ok(await task);
  }catch(error){
    if(error instanceof AIGatewayError)return fail({code:error.info.kind==='rate_limited'?'AI_RATE_LIMITED':'AI_REVIEW_UNAVAILABLE',message:error.info.kind==='rate_limited'?'综合复盘模型当前限流，未生成新意见；原报告、病历与成绩均保留。':'综合复盘模型暂时不可用，原报告、病历与成绩均保留。',retryable:error.info.retryable},undefined,error.info.kind==='rate_limited'?429:503);
    const detail=errorFromUnknown(error),message=error instanceof Error?error.message:'';
    if(message.startsWith('REVIEW_'))return fail({code:message,message:message==='REVIEW_NOT_COMPLETED'?'训练完成并生成报告后才能复盘。':message==='REVIEW_VERSION_CONFLICT'?'报告与会话版本不一致，本次未生成复盘。':'综合复盘未通过校验或未能保存；原报告、病历和成绩均保留。',retryable:message!=='REVIEW_NOT_COMPLETED'},undefined,message==='REVIEW_NOT_COMPLETED'||message==='REVIEW_VERSION_CONFLICT'?422:503);
    return fail(detail,undefined,detail.code==='AUTH_REQUIRED'?401:detail.code==='FORBIDDEN'?403:detail.code==='REPORT_NOT_FOUND'||detail.code==='SESSION_NOT_FOUND'?404:503);
  }
}
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){return handle(request,context,false);}
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return handle(request,context,true);}
