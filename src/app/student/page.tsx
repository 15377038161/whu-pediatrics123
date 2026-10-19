'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Bone, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { RandomAdmission } from '@/components/random-admission';
import { getPublicCase, isTrainableCase } from '@/domain/case-catalog';
import type { SessionState } from '@/domain/agent';
import { authedFetch } from '@/lib/authed-api';
import { useGateUser } from '@/components/auth-gate';
import { CaseLibrary } from '@/components/case-library';
import styles from './student-home.module.css';

/** 本人进度与目录分开加载；进度失败不阻塞病例库，不预取诊断或病例正文。 */
export default function StudentHome() {
  const user = useGateUser();
  const [sessions, setSessions] = useState<SessionState[] | null>(null);
  const [error, setError] = useState('');
  const loadSessions = useCallback(() => authedFetch<SessionState[]>('/api/sessions')
    .then((data) => { setSessions(data); setError(''); })
    .catch(() => setError('训练进度暂时无法读取')), []);
  useEffect(() => { void loadSessions(); }, [loadSessions]);
  const active = sessions?.find((session) => session.status === 'active' && isTrainableCase(session.caseId));
  const profile = active ? getPublicCase(active.caseId) : null;
  const complaint = active?.caseOptions?.complaint || profile?.title;

  return <div className={styles.home}>
    <section className={styles.hero} aria-labelledby="training-start-title">
      <Image className={styles.photo} src="/home-bg.webp" alt="" fill priority sizes="(min-width: 1024px) 80vw, 100vw" />
      <div className={styles.heroCopy}>
        <p className={styles.welcome}>你好，{user.displayName}</p>
        <h1 id="training-start-title">{active ? '继续你的接诊' : '从一次接诊开始'}</h1>
        <p className={styles.description}>{active ? complaint : '选择病例，自主完成问诊、查体与临床判断。'}</p>
        <div className={styles.actions}>
          {active && <Link className="btn btn-primary" href={`/student/training?session=${encodeURIComponent(active.id)}`}>继续上次 <ArrowRight size={16} /></Link>}
          <RandomAdmission excludeCaseId={active?.caseId} label={active ? '随机接诊' : '开始训练'} />
        </div>
        {!sessions && !error && <p className={styles.progress} role="status">正在读取上次训练…</p>}
        {error && <p className={styles.progress} role="alert">{error}，<button type="button" onClick={() => void loadSessions()}>重试</button></p>}
      </div>
    </section>
    <section aria-labelledby="case-library-title" id="case-library">
      <header className={styles.libraryHeading}>
        <h2 id="case-library-title">病例库</h2>
        <div className={styles.tools}>
          <Link href="/student/classes"><Users size={15} /> 我的班级</Link>
          <Link href="/student/anatomy"><Bone size={15} /> 儿童骨骼</Link>
        </div>
      </header>
      <CaseLibrary />
    </section>
  </div>;
}
