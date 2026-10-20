'use client';
import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import manifest from '../../public/models/anatomy/manifest.json';
import { anatomyStructures,anatomyRegions,anatomyAudit,structureNote } from '@/domain/anatomy-structures';
const AnatomyScene = dynamic(() => import('./anatomy-scene'), { ssr:false, loading:() => <p className="anatomy-loading">准备儿童骨骼视图…</p> });
const regions = anatomyRegions;
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
  const part = anatomyStructures.find(item => item.id === selected);
  const parts = anatomyStructures.filter(item => (region === 'all' || item.region === region) && `${item.label} ${item.parts.map(mesh => `${mesh.id} ${mesh.label}`).join(' ')}`.includes(query.trim()));
  function reset() { setExplode(0);setSelected(null);setIsolate(false);setRegion('all');setQuery('');setView({ direction:'front',version:view.version+1 }); }
  return <div className="anatomy-lab">
    <div className="anatomy-lab-head"><div><p className="eyebrow">儿科教学工具 · 6 岁儿童骨骼</p><h1 className="page-title">儿童骨骼结构探索</h1><p className="page-lead">从完整骨架到分区平铺，观察各结构的形状与原位关系。保留研究模型的几何与比例，展开只改变展示位置。</p></div><a className="btn btn-secondary" href="/student">返回训练中心</a></div>
    <div className="anatomy-lab-grid"><section className="anatomy-stage" aria-label="儿童骨骼三维交互视图" data-structure-count={anatomyStructures.length}>
      <div className="anatomy-stage-toolbar">{[['front','正面'],['back','背面'],['left','侧面'],['fit','适配全景']].map(([id,label]) => <button className="btn btn-secondary" type="button" key={id} onClick={() => setView({ direction:id,version:view.version+1 })}>{label}</button>)}<button className="btn btn-secondary" type="button" onClick={reset}>重置</button></div>
      <div className="anatomy-layout-actions" aria-label="骨骼展示方式"><button type="button" aria-pressed={explode===0} onClick={() => {setExplode(0);setIsolate(false);}}>原位骨架</button><button type="button" aria-pressed={explode===1} onClick={() => {setExplode(1);setIsolate(false);}}>一键平铺</button></div>
      <AnatomyScene explode={explode} selected={selected} region={region} isolate={isolate} view={view} onSelect={onSelect} onStatus={onStatus} />
      <div className="anatomy-zoom-controls"><button className="icon-btn" aria-label="放大模型" disabled={status !== 'ready'} onClick={() => setView({direction:'zoom-in',version:view.version+1})}>＋</button><button className="icon-btn" aria-label="缩小模型" disabled={status !== 'ready'} onClick={() => setView({direction:'zoom-out',version:view.version+1})}>−</button></div>
      <span className="anatomy-model-status" role="status">{status === 'ready' ? '儿童模型已加载 · 拖动旋转 / 双指缩放' : status === 'error' ? '模型不可用，请重试' : '加载儿童骨骼…'}</span>
      <label className="explode-control"><span>结构展开</span><input aria-label="结构分离" type="range" min="0" max="1" step=".01" value={explode} onChange={event => setExplode(Number(event.target.value))} /><output>{Math.round(explode*100)}%</output><small>0% 原位 · 100% 分区平铺；点选结构后可聚焦查看</small></label>
    </section><aside className="anatomy-info"><p className="eyebrow">结构导航</p><label htmlFor="anatomy-region">显示区域</label><select id="anatomy-region" value={region} onChange={event => { setRegion(event.target.value);setIsolate(false);setSelected(null); }}>{Object.entries({ all:'全部已收录结构',...regions }).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
      <h2>{part?.label ?? '选择一个骨骼部件'}</h2><p>{part ? `${regions[part.region]} · ${structureNote(part)}` : '点击模型或下方列表查看对应结构；完整平铺后可按区域进一步放大'}</p>
      {part && <details className="anatomy-source-parts"><summary>查看组成与来源网格</summary>{part.parts.map(mesh => <p key={mesh.id}>{mesh.label} · {mesh.id} · {mesh.surfaceKind}</p>)}</details>}
      <div className="anatomy-selection-actions"><button className="btn btn-secondary" type="button" disabled={!part || status !== 'ready'} onClick={() => setIsolate(!isolate)}>{isolate ? '恢复区域显示' : '只看选中部件'}</button><button className="btn btn-secondary" disabled={!part || status !== 'ready'} onClick={() => setView({direction:'focus',version:view.version+1,targetId:selected!})}>聚焦所选</button></div>
      <label className="anatomy-search-label">查找结构<input type="search" placeholder="输入骨骼名称或部件编号" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="anatomy-part-list">{parts.length ? parts.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} data-selected={selected === item.id} onClick={() => onSelect(item.id)}><span>{item.label}<small>{structureNote(item)}</small></span><small>{regions[item.region]}</small></button>) : <p role="status">当前区域没有匹配结构，请修改搜索词或切换区域。</p>}</div>
      <div className="anatomy-info-block"><strong>模型覆盖尚不完整</strong><p>6 岁儿童有限元研究模型，共 {manifest.parts.length} 个源网格，按 {anatomyStructures.length} 个展示结构组织，不代表骨头数量。手足仍是合并结构，颅骨按材料层展示；当前肋骨仅编号第 1—11 肋，不能作为逐骨齐全的教学图谱。同一长骨的分段保持原位关系。平铺不表示生理运动，不能用于骨龄判读或诊疗判断。</p><p>{anatomyAudit ? '已完成源网格与导出几何核对；部分命名仍为推断，医学审定尚未完成。' : '模型已更新，覆盖核查结果需要重新生成。'}</p></div>
      <p className="anatomy-attribution">PIPER Project · UCBL/Ifsttar、KTH、TU Berlin；足部来源 CEESAR。<a href="https://www.piper-project.org/child" target="_blank" rel="noreferrer">原项目</a> · <a href="/models/anatomy/LICENSE.txt">模型授权</a> · <a href="/models/anatomy/piper-corresponding-source.zip">对应源文件</a></p>
    </aside></div>
  </div>;
}
