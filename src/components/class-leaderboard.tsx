'use client';

import { useEffect, useState } from 'react';
import type { ClassLeaderboard } from '@/domain/classroom';
import { authedFetch } from '@/lib/authed-api';
import styles from './class-workspace.module.css';

export function ClassLeaderboardPanel({ classId }: { classId: string }) {
  const [data, setData] = useState<ClassLeaderboard | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    authedFetch<ClassLeaderboard>(`/api/classes/leaderboard?classId=${encodeURIComponent(classId)}`)
      .then((next) => { if (active) setData(next); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '积分榜读取失败'); });
    return () => { active = false; };
  }, [classId, retry]);

  return <section className={styles.leaderboard} aria-labelledby={`leaderboard-${classId}`}>
    <div>
      <h3 id={`leaderboard-${classId}`}>班级积分榜</h3>
      <p>每个来源病例取最高临床过程分后累加；别名与亚型不重复计分。未评分报告和病历书写分不计入，同分并列、后续名次跳号。</p>
    </div>
    {error && <div className={styles.feedback} role="alert">{error} <button type="button" className="btn btn-quiet" onClick={() => { setError(''); setRetry((value) => value + 1); }}>重试</button></div>}
    {!data && !error && <p role="status">正在读取积分榜…</p>}
    {data && !data.entries.length && <p>还没有已入班学生。</p>}
    {data && data.entries.length > 0 && <div className={styles.table}><table>
      <caption>仅用于学习过程反馈，不属于正式课程成绩</caption>
      <thead><tr><th scope="col">名次</th><th scope="col">学生</th><th scope="col">临床积分</th><th scope="col">有效来源病例</th></tr></thead>
      <tbody>{data.entries.map((entry) => <tr key={entry.userId}>
        <td>第 {entry.rank} 名</td>
        <td>{entry.name}</td>
        <td className={styles.leaderboardPoints}>{entry.points}</td>
        <td>{entry.sourceCount} 个</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
