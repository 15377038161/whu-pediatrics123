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
  const [view,setView] = useState({ direction:'front', version:0 });
  const [ready,setReady] = useState(false);
  const onReady = useCallback(() => setReady(true),[]);
  const part = manifest.parts.find(item => item.id === selected);
  const parts = manifest.parts.filter(item => region === 'all' || item.region === region);
  function reset() { setExplode(0);setSelected(null);setIsolate(false);setRegion('all');setView({ direction:'front',version:view.version+1 }); }
  return <div className="anatomy-lab">
    <div className="anatomy-lab-head"><div><p className="eyebrow">儿科教学工具 · 6 岁儿童骨骼</p><h1 className="page-title">儿童骨骼结构探索</h1><p className="page-lead">旋转观察、点选结构，逐步分离骨骼部件。采用 PIPER 6 岁儿童研究模型，保留原始姿势与比例。</p></div><a className="btn btn-secondary" href="/student">返回训练中心</a></div>
    <div className="anatomy-lab-grid"><section className="anatomy-stage" aria-label="儿童骨骼三维交互视图">
      <div className="anatomy-stage-toolbar">{[['front','正面'],['back','背面'],['left','侧面']].map(([id,label]) => <button className="btn btn-secondary" type="button" key={id} onClick={() => setView({ direction:id,version:view.version+1 })}>{label}</button>)}<button className="btn btn-secondary" type="button" onClick={reset}>重置</button></div>
      <AnatomyScene explode={explode} selected={selected} region={region} isolate={isolate} view={view} onSelect={setSelected} onReady={onReady} />
      <span className="anatomy-model-status" role="status">{ready ? '儿童模型已加载 · 拖动旋转 / 双指缩放' : '加载儿童骨骼…'}</span>
      <label className="explode-control"><span>结构分离</span><input aria-label="结构分离" type="range" min="0" max="1" step=".01" value={explode} onChange={event => setExplode(Number(event.target.value))} /><output>{Math.round(explode*100)}%</output></label>
    </section><aside className="anatomy-info"><p className="eyebrow">结构导航</p><label htmlFor="anatomy-region">显示区域</label><select id="anatomy-region" value={region} onChange={event => { setRegion(event.target.value);setIsolate(false);setSelected(null); }}>{Object.entries({ all:'全部骨骼',...regions }).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
      <h2>{part?.label ?? '选择一个骨骼部件'}</h2><p>{part ? regions[part.region] : '点击模型或下方列表查看对应结构'}</p>
      <button className="btn btn-secondary" type="button" disabled={!part} onClick={() => setIsolate(!isolate)}>{isolate ? '恢复区域显示' : '只看选中部件'}</button>
      <div className="anatomy-part-list">{parts.map(item => <button type="button" key={item.id} data-selected={selected === item.id} onClick={() => setSelected(item.id)}><span>{item.label}</span><small>部件 {item.id}</small></button>)}</div>
      <div className="anatomy-info-block"><strong>模型说明</strong><p>6 岁儿童有限元研究模型的骨骼表面，共 {manifest.parts.length} 个网格部件。部分结构按研究用途合并，并非逐块完整解剖图谱。分离位移仅帮助观察，不表示生理运动。用于结构探索，不能用于骨龄判读或诊疗判断。</p></div>
      <p className="anatomy-attribution">PIPER Project · UCBL/Ifsttar、KTH、TU Berlin；足部来源 CEESAR。<a href="https://www.piper-project.org/child" target="_blank" rel="noreferrer">原项目</a> · <a href="/models/anatomy/LICENSE.txt">模型授权</a> · <a href="/models/anatomy/piper-corresponding-source.zip">对应源文件</a></p>
    </aside></div>
  </div>;
}
