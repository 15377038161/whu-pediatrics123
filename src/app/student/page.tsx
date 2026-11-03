'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PublicCaseProfile } from '@/domain/case-catalog';
import type { SessionState } from '@/domain/agent';
import { normalizeCategory } from '@/domain/case-classification';
import { authedFetch } from '@/lib/authed-api';
import styles from './student-home.module.css';

const systems = [
  { name: '呼吸系统', categories: ['呼吸系统疾病'], x: 16, y: 36 },
  { name: '心血管系统', categories: ['心血管系统疾病'], x: 42, y: 27 },
  { name: '消化系统', categories: ['消化系统疾病', '急性中毒'], x: 66, y: 29 },
  { name: '神经系统', categories: ['神经系统'], x: 90, y: 25 },
  { name: '泌尿系统', categories: ['泌尿系统疾病'], x: 13, y: 58 },
  { name: '血液系统', categories: ['造血系统疾病'], x: 37, y: 50 },
  { name: '内分泌', categories: ['内分泌疾病'], x: 61, y: 50 },
  { name: '新生儿', categories: ['新生儿与新生儿疾病'], x: 83, y: 48 },
  { name: '营养', categories: ['营养性疾病'], x: 18, y: 82 },
  { name: '感染', categories: ['感染性疾病'], x: 43, y: 81 },
  { name: '免疫', categories: ['免疫性疾病'], x: 64, y: 75 },
  { name: '遗传', categories: ['遗传性疾病'], x: 87, y: 72 },
];

export default function StudentHome() {
  const [selected, setSelected] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<PublicCaseProfile[] | null>(null);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void authedFetch<PublicCaseProfile[]>('/api/cases')
      .then((data) => { if (current) setCatalog(data); })
      .catch(() => { if (current) setError(true); });
    void authedFetch<SessionState[]>('/api/sessions')
      .then((data) => { if (current) setSessions(data); })
      .catch(() => {});
    return () => { current = false; };
  }, [attempt]);
  const system = selected === null ? null : systems[selected];
  const active = sessions.find((session) => session.status === 'active');
  let level = 0;

  return <div className={styles.home}>
    <header className={styles.heading}>
      <div>
        <h1>{system ? system.name : '儿科病例闯关'}</h1>
        <p>{system ? '选择病例，开始接诊。' : '选择一个系统，进入病例训练。'}</p>
      </div>
      <div className={styles.tools}>
        {system && <button className="btn btn-secondary" onClick={() => setSelected(null)}>返回系统地图</button>}
        {active && <Link href={`/student/training?session=${encodeURIComponent(active.id)}`}>继续上次</Link>}
        <Link href="/student/classes">我的班级</Link>
        <Link href="/student/anatomy">儿童骨骼</Link>
      </div>
    </header>
    {!system ? <nav className={styles.map} aria-label="选择儿科系统">
      {/* Coordinates use the original artwork's aspect ratio. */}
      <div className={styles.mapArt} aria-hidden="true" />
      {systems.map((item, index) => <button key={item.name} type="button"
        className={styles.island} style={{ left: `${item.x}%`, top: `${item.y}%` }}
        onClick={() => setSelected(index)}>{item.name}</button>)}
    </nav> : error ? <div role="alert">病例目录加载失败。 <button type="button" onClick={() => { setError(false); setAttempt(attempt + 1); }}>重试</button></div>
      : !catalog ? <p role="status">正在加载病例目录…</p>
      : system.categories.map((category) => {
        const cases = catalog.filter((item) => normalizeCategory(item.category) === category);
        return <section key={category} aria-label={category}>
          {system.categories.length > 1 && <h2>{category}</h2>}
          {!cases.length && <p>当前暂无开放病例。</p>}
          <ol className={styles.levels}>
            {cases.map((item) => {
              level += 1;
              const completed = sessions.some((session) => session.caseId === item.id && session.status === 'completed');
              const ongoing = sessions.find((session) => session.caseId === item.id && session.status === 'active');
              const target = ongoing ? `session=${encodeURIComponent(ongoing.id)}` : `mode=guided&case=${encodeURIComponent(item.id)}`;
              return <li key={item.id}><Link href={`/student/training?${target}`}>
                <span>第 {level} 关 · {completed ? '已完成' : ongoing ? '进行中' : '开始接诊'}</span>
                <strong>{item.title}</strong>
              </Link></li>;
            })}
          </ol>
        </section>;
      })}
  </div>;
}
