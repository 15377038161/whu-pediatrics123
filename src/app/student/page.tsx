'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Trophy } from 'lucide-react';
import type { PublicCaseProfile } from '@/domain/case-catalog';
import type { SessionState } from '@/domain/agent';
import type { ClassLeaderboard, ClassWorkspace } from '@/domain/classroom';
import { normalizeCategory } from '@/domain/case-classification';
import { buildLevelLocks } from '@/domain/case-progression';
import {
  DESKTOP_SYSTEM_HOTSPOTS,
  MOBILE_SYSTEM_HOTSPOTS,
  PEDIATRIC_SYSTEMS,
  type PediatricSystemHotspot,
  type PediatricSystemKey,
} from '@/domain/pediatric-system-map';
import { useGateUser } from '@/components/auth-gate';
import { authedFetch } from '@/lib/authed-api';
import styles from './student-home.module.css';

function hotspotStyle(hotspot: PediatricSystemHotspot) {
  return {
    left: `${hotspot.x}%`,
    top: `${hotspot.y}%`,
    width: `${hotspot.w}%`,
    height: `${hotspot.h}%`,
  };
}

export default function StudentHome() {
  const me = useGateUser();
  const [selected, setSelected] = useState<PediatricSystemKey | null>(null);
  const [catalog, setCatalog] = useState<PublicCaseProfile[] | null>(null);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [standing, setStanding] = useState<{ rank: number; points: number; sourceCount: number; total: number; className: string } | null>(null);
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
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const workspace = await authedFetch<ClassWorkspace>('/api/classes');
        const classId = workspace.state.currentCohortId ?? workspace.memberships[0] ?? null;
        if (!classId) return;
        const board = await authedFetch<ClassLeaderboard>(`/api/classes/leaderboard?classId=${encodeURIComponent(classId)}`);
        const mine = board.entries.find((entry) => entry.userId === me.id);
        if (!current || !mine) return;
        setStanding({
          rank: mine.rank, points: mine.points, sourceCount: mine.sourceCount, total: board.entries.length,
          className: workspace.classes.find((item) => item.id === classId)?.name ?? '我的班级',
        });
      } catch { /* 积分榜读取失败不阻塞首页其余内容，入口仍在 */ }
    })();
    return () => { current = false; };
  }, [me.id]);
  const system = PEDIATRIC_SYSTEMS.find((item) => item.key === selected) ?? null;
  // 门控只出现在分类病例层；顶层 13 个系统始终全开，不设锁。
  const cases = system && catalog
    ? catalog.filter((item) => normalizeCategory(item.category) === system.category)
    : [];
  // 续诊入口也必须服从各系统内的顺序解锁，不能直接进入历史遗留的后段 active 会话。
  const unlockedCaseIds = new Set(
    catalog
      ? PEDIATRIC_SYSTEMS.flatMap((item) =>
          buildLevelLocks(
            catalog
              .filter((entry) => normalizeCategory(entry.category) === item.category)
              .map((entry) => entry.id),
            sessions,
          )
            .filter((lock) => lock.unlocked)
            .map((lock) => lock.caseId),
        )
      : [],
  );
  const active = sessions.find((session) => session.status === 'active' && unlockedCaseIds.has(session.caseId));
  const lockOf = new Map(buildLevelLocks(cases.map((item) => item.id), sessions).map((lock) => [lock.caseId, lock]));

  return <div className={styles.home}>
    <header className={styles.heading}>
      <div>
        {!system && <p className={styles.hospital}>武汉大学中南医院</p>}
        <h1>{system ? system.label : '儿科病例训练'}</h1>
        {system && <p>选择病例，开始接诊。</p>}
      </div>
      {system && <div className={styles.tools}>
        <button className="btn btn-secondary" onClick={() => setSelected(null)}>返回系统地图</button>
      </div>}
    </header>
    {!system ? <nav className={styles.map} aria-label="选择儿科系统">
      <picture>
        <source media="(max-width: 600px)" srcSet="/pediatric-systems-map-mobile.webp" />
        <img
          className={styles.mapArt}
          src="/pediatric-systems-map-desktop.webp"
          alt="武汉大学中南医院与儿科各系统群岛地图"
          width={1586}
          height={992}
          fetchPriority="high"
        />
      </picture>
      <div className={styles.desktopHotspots}>
        {PEDIATRIC_SYSTEMS.map((item) => <button key={item.key} type="button"
          className={styles.island} data-system={item.key} aria-label={`进入${item.label}病例`}
          style={hotspotStyle(DESKTOP_SYSTEM_HOTSPOTS[item.key])}
          onClick={() => setSelected(item.key)}>
          <span className={styles.islandLabel}>{item.label}</span>
        </button>)}
      </div>
      <div className={styles.mobileHotspots}>
        {PEDIATRIC_SYSTEMS.map((item) => <button key={item.key} type="button"
          className={styles.island} data-system={item.key} aria-label={`进入${item.label}病例`}
          style={hotspotStyle(MOBILE_SYSTEM_HOTSPOTS[item.key])}
          onClick={() => setSelected(item.key)}>
          <span className={styles.islandLabel}>{item.label}</span>
        </button>)}
      </div>
    </nav> : error ? <div role="alert">病例目录加载失败。 <button type="button" onClick={() => { setError(false); setAttempt(attempt + 1); }}>重试</button></div>
      : !catalog ? <p role="status">正在加载病例目录…</p>
      : <section aria-label={`${system.label}病例`}>
        {!cases.length && <p>当前暂无开放病例。</p>}
        <ol className={styles.levels}>
          {cases.map((item) => {
            const lock = lockOf.get(item.id);
            const ongoingSession = sessions.find((session) => session.caseId === item.id && session.status === 'active');
            const completed = Boolean(lock?.completed);
            const unlocked = lock?.unlocked ?? true;
            const levelNumber = lock?.level ?? 1;
            const target = ongoingSession ? `session=${encodeURIComponent(ongoingSession.id)}` : `mode=guided&case=${encodeURIComponent(item.id)}`;
            const statusText = !unlocked ? '未解锁' : completed ? '已完成' : ongoingSession ? '进行中' : '开始接诊';
            return <li key={item.id}>
              {unlocked ? <Link href={`/student/training?${target}`}>
                <span>第 {levelNumber} 关 · {statusText}</span>
                <strong>{item.title}</strong>
              </Link> : <div className={styles.lockedLevel} aria-disabled="true">
                <span>第 {levelNumber} 关 · {statusText} <Lock size={12} aria-hidden="true" /></span>
                <strong>{item.title}</strong>
                <small>完成上一关后解锁</small>
              </div>}
            </li>;
          })}
        </ol>
      </section>}
    {!system && <section className={styles.shortcuts} aria-label="积分与继续训练">
      <Link className={styles.pointsCard} href="/student/classes">
        <Trophy aria-hidden="true" />
        <span>
          <strong>{standing ? `第 ${standing.rank} 名 · ${standing.points} 积分` : '班级积分榜'}</strong>
          <small>{standing ? `${standing.className}（共 ${standing.total} 人）· 已完成 ${standing.sourceCount} 个来源病例` : '积分口径：每个来源病例取最高临床过程分，累加为总积分'}</small>
        </span>
      </Link>
      {active && <Link className={styles.continueCard} href={`/student/training?session=${encodeURIComponent(active.id)}`}>
        <span><strong>继续上次接诊</strong><small>会话已保留，可从当前阶段接着完成。</small></span>
      </Link>}
    </section>}
  </div>;
}
