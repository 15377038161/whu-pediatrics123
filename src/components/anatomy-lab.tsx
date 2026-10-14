'use client';
import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import manifest from '../../public/models/anatomy/manifest.json';
const AnatomyScene = dynamic(() => import('./anatomy-scene'), { ssr:false, loading:() => <p className="anatomy-loading">准备儿童骨骼视图…</p> });
const regions: Record<string,string> = manifest.regions;
export function AnatomyLab() {
  const [explode,setExplode] = useState(0);
  const [selected,setSelected] = useState<string|null>(null);
  const [region,setRegion] = useState('all');
  const [isolate,setIsolate] = useState(false);
  const [view,setView] = useState<{direction:string;version:number;targetId?:string}>({ direction:'front', version:0 });
  const [status,setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [query,setQuery] = useState('');
  const onStatus = useCallback((value:'loading'|'ready'|'error') => setStatus(value),[]);
  const onSelect = useCallback((id:string|null) => { setSelected(id);if (!id) setIsolate(false); },[]);
  const part = manifest.parts.find(item => item.id === selected);
  const parts = manifest.parts.filter(item => (region === 'all' || item.region === region) && `${item.label} ${item.id}`.includes(query.trim()));
  function reset() { setExplode(0);setSelected(null);setIsolate(false);setRegion('all');setQuery('');setView({ direction:'front',version:view.version+1 }); }
  return <div className="anatomy-lab">
    <div className="anatomy-lab-head"><div><p className="eyebrow">儿科教学工具 · 6 岁儿童骨骼</p><h1 className="page-title">儿童骨骼结构探索</h1><p className="page-lead">旋转观察、点选结构，逐步分离骨骼部件。采用 PIPER 6 岁儿童研究模型，保留原始姿势与比例。</p></div><a className="btn btn-secondary" href="/student">返回训练中心</a></div>
    <div className="anatomy-lab-grid"><section className="anatomy-stage" aria-label="儿童骨骼三维交互视图">
      <div className="anatomy-stage-toolbar">{[['front','正面'],['back','背面'],['left','侧面']].map(([id,label]) => <button className="btn btn-secondary" type="button" key={id} onClick={() => setView({ direction:id,version:view.version+1 })}>{label}</button>)}<button className="btn btn-secondary" type="button" onClick={reset}>重置</button></div>
      <AnatomyScene explode={explode} selected={selected} region={region} isolate={isolate} view={view} onSelect={onSelect} onStatus={onStatus} />
      <div className="anatomy-zoom-controls"><button className="icon-btn" aria-label="放大模型" disabled={status !== 'ready'} onClick={() => setView({direction:'zoom-in',version:view.version+1})}>＋</button><button className="icon-btn" aria-label="缩小模型" disabled={status !== 'ready'} onClick={() => setView({direction:'zoom-out',version:view.version+1})}>−</button></div>
      <span className="anatomy-model-status" role="status">{status === 'ready' ? '儿童模型已加载 · 拖动旋转 / 双指缩放' : status === 'error' ? '模型不可用，请重试' : '加载儿童骨骼…'}</span>
      <label className="explode-control"><span>结构分离</span><input aria-label="结构分离" type="range" min="0" max="1" step=".01" value={explode} onChange={event => setExplode(Number(event.target.value))} /><output>{Math.round(explode*100)}%</output></label>
    </section><aside className="anatomy-info"><p className="eyebrow">结构导航</p><label htmlFor="anatomy-region">显示区域</label><select id="anatomy-region" value={region} onChange={event => { setRegion(event.target.value);setIsolate(false);setSelected(null); }}>{Object.entries({ all:'全部骨骼',...regions }).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
      <h2>{part?.label ?? '选择一个骨骼部件'}</h2><p>{part ? `${regions[part.region]} · ${part.surfaceKind}` : '点击模型或下方列表查看对应结构'}</p>
      <div className="anatomy-selection-actions"><button className="btn btn-secondary" type="button" disabled={!part || status !== 'ready'} onClick={() => setIsolate(!isolate)}>{isolate ? '恢复区域显示' : '只看选中部件'}</button><button className="btn btn-secondary" disabled={!part || status !== 'ready'} onClick={() => setView({direction:'focus',version:view.version+1,targetId:selected!})}>聚焦所选</button></div>
      <label className="anatomy-search-label">查找结构<input type="search" placeholder="输入骨骼名称或部件编号" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="anatomy-part-list">{parts.length ? parts.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} data-selected={selected === item.id} onClick={() => onSelect(item.id)}><span>{item.label}<small>{item.surfaceKind}</small></span><small>部件 {item.id}</small></button>) : <p role="status">当前区域没有匹配结构，请修改搜索词或切换区域。</p>}</div>
      <div className="anatomy-info-block"><strong>模型说明</strong><p>6 岁儿童有限元研究模型的骨骼表面，共 {manifest.parts.length} 个网格部件。部分结构按研究用途合并，并非逐块完整解剖图谱。分离位移仅帮助观察，不表示生理运动。用于结构探索，不能用于骨龄判读或诊疗判断。</p></div>
      <p className="anatomy-attribution">PIPER Project · UCBL/Ifsttar、KTH、TU Berlin；足部来源 CEESAR。<a href="https://www.piper-project.org/child" target="_blank" rel="noreferrer">原项目</a> · <a href="/models/anatomy/LICENSE.txt">模型授权</a> · <a href="/models/anatomy/piper-corresponding-source.zip">对应源文件</a></p>
    </aside></div>
  </div>;
}
