'use client';

import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';

type Part = { id: string; label: string; x: number; y: number; width: number; height: number; color: string };
const PARTS: Part[] = [
  { id: 'skull', label: '颅骨', x: 174, y: 24, width: 52, height: 48, color: '#f2e7cf' },
  { id: 'spine', label: '脊柱', x: 194, y: 80, width: 14, height: 202, color: '#dfc69b' },
  { id: 'ribs', label: '胸廓', x: 148, y: 90, width: 106, height: 110, color: '#ead8b8' },
  { id: 'pelvis', label: '骨盆', x: 164, y: 274, width: 76, height: 52, color: '#d6b27d' },
  { id: 'left-arm', label: '左上肢', x: 108, y: 100, width: 30, height: 132, color: '#e7d5b5' },
  { id: 'right-arm', label: '右上肢', x: 266, y: 100, width: 30, height: 132, color: '#e7d5b5' },
  { id: 'left-leg', label: '左下肢', x: 160, y: 326, width: 30, height: 176, color: '#d7bd91' },
  { id: 'right-leg', label: '右下肢', x: 214, y: 326, width: 30, height: 176, color: '#d7bd91' },
];

export function AnatomyLab() {
  const [explode, setExplode] = useState(0.35);
  const [selected, setSelected] = useState('spine');
  const [zoom, setZoom] = useState(1);
  const selectedPart = PARTS.find((part) => part.id === selected) ?? PARTS[1];
  return <div className="anatomy-lab">
    <div className="anatomy-lab-head"><div><p className="eyebrow">儿科教学工具 · 解剖基础</p><h1 className="page-title">3D 人体骨骼爆炸实验室</h1><p className="page-lead">拖动爆炸程度，点选骨骼结构，建立从整体到局部的空间认识。它是病例教学的解剖辅助，不替代临床判断。</p></div><a className="btn btn-secondary" href="/student">返回训练中心</a></div>
    <div className="anatomy-lab-grid"><section className="anatomy-stage" aria-label="人体骨骼交互视图"><div className="anatomy-stage-toolbar"><button className="icon-btn" type="button" onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))} aria-label="放大"><ZoomIn size={17} /></button><button className="icon-btn" type="button" onClick={() => setZoom((value) => Math.max(.75, value - 0.1))} aria-label="缩小"><ZoomOut size={17} /></button><button className="icon-btn" type="button" onClick={() => { setExplode(.35); setZoom(1); setSelected('spine'); }} aria-label="重置"><RotateCcw size={17} /></button></div><div className="anatomy-canvas" style={{ transform: `scale(${zoom})` }}><div className="anatomy-glow" />{PARTS.map((part) => { const dx = (part.x - 200) * explode; const dy = (part.y - 250) * explode; return <button key={part.id} type="button" className="anatomy-part" data-selected={selected === part.id} style={{ left: `${part.x}px`, top: `${part.y}px`, width: `${part.width}px`, height: `${part.height}px`, background: part.color, transform: `translate(${dx}px, ${dy}px)`, borderRadius: part.id === 'skull' ? '48% 48% 42% 42%' : part.id === 'ribs' ? '48% 48% 30% 30%' : '18px' }} onClick={() => setSelected(part.id)} aria-label={part.label}><span>{part.label}</span></button>; })}</div><label className="explode-control"><span>爆炸程度</span><input type="range" min="0" max="1" step=".01" value={explode} onChange={(event) => setExplode(Number(event.target.value))} /><output>{Math.round(explode * 100)}%</output></label></section><aside className="anatomy-info"><p className="eyebrow">当前选中结构</p><h2>{selectedPart.label}</h2><p>空间定位：第 {PARTS.indexOf(selectedPart) + 1} 个教学部件</p><div className="anatomy-info-block"><strong>学习提示</strong><p>先观察整体位置，再结合病例中的查体部位进行定位。教师后续可以将病例、图片和检查任务关联到具体结构。</p></div><div className="anatomy-part-list">{PARTS.map((part) => <button type="button" key={part.id} data-selected={selected === part.id} onClick={() => setSelected(part.id)}>{part.label}<span>›</span></button>)}</div></aside></div>
  </div>;
}
