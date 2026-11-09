'use client';
import {useEffect,useState} from 'react';
import {authedFetch} from '@/lib/authed-api';
import type {SavedPostVisitReview} from '@/domain/post-visit-review';

const names={history:'问诊',exam:'查体',tests:'辅助检查',diagnosis:'诊断与鉴别',plan:'处置治疗',note:'病历书写',communication:'沟通'};
export function PostVisitReviewPanel({reportId,readonly=false}:{reportId:string;readonly?:boolean}){
  const [review,setReview]=useState<SavedPostVisitReview|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const endpoint=`/api/reports/${encodeURIComponent(reportId)}/review`;
  useEffect(()=>{let cancelled=false;authedFetch<SavedPostVisitReview|null>(endpoint)
    .then(value=>{if(!cancelled)setReview(value);}).catch(()=>{if(!cancelled)setError('综合复盘暂时无法读取，原报告仍可查看。');})
    .finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[endpoint]);
  async function generate(){
    if(busy)return;setBusy(true);setError('');
    try{setReview(await authedFetch<SavedPostVisitReview>(endpoint,{method:'POST'}));}
    catch(reason){setError(reason instanceof Error?reason.message:'综合复盘暂不可用，原报告和成绩不受影响。');}
    finally{setBusy(false);}
  }
  return <section className="workspace-panel" style={{marginBottom:18}} aria-labelledby="post-visit-heading">
    <div className="panel-head"><h2 id="post-visit-heading">AI 接诊综合复盘</h2>{!readonly&&!review&&<button className="btn btn-secondary" disabled={loading||busy} onClick={()=>void generate()}>{busy?'正在综合分析…':'生成综合复盘'}</button>}</div>
    <div className="panel-body">
      {loading&&<p role="status">正在读取已保存的复盘…</p>}
      {busy&&<p role="status">正在结合本次问答、查体、检查、诊疗方案与正式病历分析。完成后保存，刷新可恢复。</p>}
      {error&&<p role="alert">{error}</p>}
      {!loading&&!busy&&!review&&<p>{readonly?'学生尚未生成综合复盘。':'生成后按七个环节说明已做对的内容、遗漏与改进步骤。逐项核心表达与检查选择理由见下方教学反馈。'}</p>}
      {review&&<>
        <p>{review.content.summary}</p>
        <h3>优先改进</h3>
        <ol>{review.content.priorities.map((item,i)=><li key={i}><strong>{names[item.stage]} · {item.title}</strong><p>{item.reason}</p><p>{item.action}</p>{item.citations.map((cite,j)=><blockquote key={j}>{cite.quote}</blockquote>)}</li>)}</ol>
        {review.content.stages.map(item=><details key={item.stage} style={{margin:'12px 0'}} open={item.gaps.length>0}>
          <summary><strong>{names[item.stage]}</strong></summary>
          {item.strengths.length>0&&<><h4>做对了什么</h4><ul>{item.strengths.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
          {item.gaps.length>0&&<><h4>不足与遗漏</h4><ul>{item.gaps.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
          <h4>下次怎么做</h4><ul>{item.nextSteps.map((text,i)=><li key={i}>{text}</li>)}</ul>
          {item.citations.length>0&&<details><summary>本次记录依据</summary>{item.citations.map((cite,i)=><blockquote key={i}>{cite.quote}</blockquote>)}</details>}
        </details>)}
        <small>AI 教学建议 · 未医学审定 · 不改变固定评分、正式成绩或历史报告。模型 {review.model} · {review.promptVersion}</small>
      </>}
    </div>
  </section>;
}
