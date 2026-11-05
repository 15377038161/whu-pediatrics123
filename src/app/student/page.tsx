'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Trophy } from 'lucide-react';
import type { PublicCaseProfile } from '@/domain/case-catalog';
import type { SessionState } from '@/domain/agent';
import type { ClassLeaderboard, ClassWorkspace } from '@/domain/classroom';
import { normalizeCategory } from '@/domain/case-classification';
import { buildLevelLocks } from '@/domain/case-progression';
import { useGateUser } from '@/components/auth-gate';
import { authedFetch } from '@/lib/authed-api';
import styles from './student-home.module.css';

// 热区坐标基于最终稿 pediatric-systems-map.png（1586×992）逐岛核对，
// w/h 略小于视觉轮廓，避免相邻岛屿重叠误触。
const systems = [
  { name: '呼吸系统', categories: ['呼吸系统疾病'], x: 16, y: 32, w: 20, h: 20 },
  { name: '心血管系统', categories: ['心血管系统疾病'], x: 41, y: 22, w: 19, h: 20 },
  { name: '消化系统', categories: ['消化系统疾病', '急性中毒'], x: 65, y: 23, w: 17, h: 19 },
  { name: '神经系统', categories: ['神经系统'], x: 90, y: 21, w: 16, h: 18 },
  { name: '泌尿系统', categories: ['泌尿系统疾病'], x: 13, y: 53, w: 20, h: 20 },
  { name: '血液系统', categories: ['造血系统疾病'], x: 36, y: 47, w: 16, h: 20 },
  { name: '内分泌', categories: ['内分泌疾病'], x: 61, y: 45, w: 18, h: 23 },
  { name: '新生儿', categories: ['新生儿与新生儿疾病'], x: 84, y: 42, w: 18, h: 20 },
  { name: '营养', categories: ['营养性疾病'], x: 17, y: 77, w: 21, h: 20 },
  { name: '感染', categories: ['感染性疾病'], x: 42, y: 76, w: 19, h: 20 },
  { name: '免疫', categories: ['免疫性疾病'], x: 63, y: 71, w: 18, h: 19 },
  { name: '遗传', categories: ['遗传性疾病'], x: 87, y: 68, w: 19, h: 20 },
];

export default function StudentHome() {
  const me = useGateUser();
  const [selected, setSelected] = useState<number | null>(null);
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
  const system = selected === null ? null : systems[selected];
  const active = sessions.find((session) => session.status === 'active');
  // 关卡顺序按系统内全部病例的展示顺序（跨分类连续编号）；门控只出现在系统内这一层，
  // 顶层 12 个系统始终全开，不设锁。
  const systemGroups = system && catalog
    ? system.categories.map((category) => ({ category, cases: catalog.filter((item) => normalizeCategory(item.category) === category) }))
    : [];
  const orderedCases = systemGroups.flatMap((group) => group.cases);
  const lockOf = new Map(buildLevelLocks(orderedCases.map((item) => item.id), sessions).map((lock) => [lock.caseId, lock]));

  return <div className={styles.home}>
    {!system && <section className={styles.slogan}>
      <p className={styles.sloganKicker}>珞珈儿科智训 · 武汉大学儿科学</p>
      <h2 className={styles.sloganTitle}>大医精诚敬畏生命，练一次，会接诊</h2>
      <p className={styles.sloganPurpose}>把真实儿科病历变成可反复训练的接诊过程：每一次问诊、查体、检查与沟通都留下可回放的证据与反馈。</p>
      <dl className={styles.sloganList}>
        <div><dt>功能</dt><dd>12 个系统真实病例接诊 · 查体与辅助检查 · 病历书写与 AI 点评 · 知识回顾题库 · OSCE 考站 · 班级积分榜</dd></div>
        <div><dt>技能</dt><dd>病史采集 · 体格检查与技能操作 · 辅助检查判读 · 诊断与鉴别 · 处理原则 · 医患沟通（对标执业医师实践技能三站）</dd></div>
      </dl>
    </section>}
    <section className={styles.shortcuts} aria-label="积分与继续训练">
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
    </section>
    <header className={styles.heading}>
      <div>
        <h1>{system ? system.name : '儿科病例训练'}</h1>
        <p>{system ? '选择病例，开始接诊。' : '选择一个系统，进入病例训练。'}</p>
      </div>
      {system && <div className={styles.tools}>
        <button className="btn btn-secondary" onClick={() => setSelected(null)}>返回系统地图</button>
      </div>}
    </header>
    {!system ? <nav className={styles.map} aria-label="选择儿科系统">
      {/* Coordinates use the original artwork's aspect ratio. */}
      <div className={styles.mapArt} aria-hidden="true" />
      {systems.map((item, index) => <button key={item.name} type="button"
        className={styles.island} aria-label={`进入${item.name}病例`}
        style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%` }}
        onClick={() => setSelected(index)}>
        <span className={styles.islandLabel}>{item.name}</span>
      </button>)}
    </nav> : error ? <div role="alert">病例目录加载失败。 <button type="button" onClick={() => { setError(false); setAttempt(attempt + 1); }}>重试</button></div>
      : !catalog ? <p role="status">正在加载病例目录…</p>
      : systemGroups.map(({ category, cases }) => {
        return <section key={category} aria-label={category}>
          {system.categories.length > 1 && <h2>{category}</h2>}
          {!cases.length && <p>当前暂无开放病例。</p>}
          <ol className={styles.levels}>
            {cases.map((item) => {
              const lock = lockOf.get(item.id);
              const ongoingSession = sessions.find((session) => session.caseId === item.id && session.status === 'active');
              const completed = Boolean(lock?.completed);
              const unlocked = lock?.unlocked ?? true;
              const levelNumber = lock?.level ?? 1;
              const target = ongoingSession ? `session=${encodeURIComponent(ongoingSession.id)}` : `mode=guided&case=${encodeURIComponent(item.id)}`;
              const statusText = completed ? '已完成' : ongoingSession ? '进行中' : unlocked ? '开始接诊' : '未解锁';
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
        </section>;
      })}
  </div>;
}
