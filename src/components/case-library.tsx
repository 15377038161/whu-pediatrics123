'use client';

import { ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CASE_CATALOG } from '@/domain/case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';

export function CaseLibrary() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const categories = [...new Set(CASE_CATALOG.map((item) => item.category))];
  const visible = useMemo(() => CASE_CATALOG.filter((item) => (category === 'all' || item.category === category) && `${item.title} ${item.category} ${item.presentingSymptoms.join(' ')}`.includes(query.trim())), [category, query]);
  return <>
    <div className="case-library-filter"><label><Search size={17} /><input aria-label="搜索病例" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索病种、症状或系统" /></label><select aria-label="筛选疾病系统" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">全部系统</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select><span>全部开放 · {visible.length} / {CASE_CATALOG.length} 项</span></div>
    <div className="case-library">{visible.map((item) => {
      const link = TEACHER_CASE_LINKS[item.id];
      const source = TEACHER_CASE_CATALOG.find((entry) => entry.id === (link?.sourceId ?? item.id));
      return <article className="case-card" key={item.id}><div className="case-card-copy">
        <p className="case-number">{item.category}</p><h3>{item.title}</h3>
        <div className="case-meta"><span>{item.difficulty}</span>{item.expectedMinutes > 0 && <span>{item.expectedMinutes} 分钟</span>}{source?.folder && <span>{source.documentCount} 份文档 · {source.mediaCount} 项媒体</span>}</div>
        {link && <p className="case-source-note">学习资料：{source?.name}（{link.relation === 'subtype' ? '具体亚型' : '名称对应'}）</p>}
        {source && !source.folder && !link && <p className="case-source-note">可记录诊疗思路；此病种尚无独立病例正文。</p>}
        <div className="symptom-list" aria-label="就诊症状">{item.presentingSymptoms.map((symptom) => <span key={symptom}>{symptom}</span>)}</div>
        <div className="case-card-actions"><a className="btn btn-secondary" href={`/student/training?mode=guided&case=${encodeURIComponent(item.id)}`}>进入病例 <ArrowRight size={15} /></a><a className="text-link" href={`/student/training?mode=immersive&case=${encodeURIComponent(item.id)}`}>沉浸式教学</a><a className="text-link" href={`/student/training?mode=osce&case=${encodeURIComponent(item.id)}`}>OSCE 练习</a></div>
      </div></article>;
    })}</div>
    {visible.length === 0 && <p className="empty-state">没有找到病例，试试病种名称或切换疾病系统。</p>}
  </>;
}
