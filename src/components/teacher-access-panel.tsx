'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TeacherAccessWorkspace, TeacherAccount } from '@/domain/classroom';
import { authedFetch } from '@/lib/authed-api';
import styles from './class-workspace.module.css';

export function TeacherAccessPanel() {
  const [data, setData] = useState<TeacherAccessWorkspace | null>(null);
  const [cxid, setCxid] = useState('');
  const [target, setTarget] = useState<TeacherAccount | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true;
    authedFetch<TeacherAccessWorkspace>('/api/teacher/access').then((next) => { if (active) setData(next); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取失败'); });
    return () => { active = false; };
  }, []);
  async function search() {
    setBusy(true); setError(''); setTarget(null); setConfirmed(false);
    try { setData(await authedFetch<TeacherAccessWorkspace>(`/api/teacher/access?cxid=${encodeURIComponent(cxid.trim())}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '查询失败'); }
    finally { setBusy(false); }
  }
  async function save(action: 'grant' | 'revoke') {
    if (!target || !confirmed || busy) return;
    setBusy(true); setError('');
    try {
      await authedFetch('/api/teacher/access', { method: 'POST', body: JSON.stringify({ action, userId: target.userId, ...(action === 'grant' ? { cxid: target.cxid } : {}), confirmed: true }) });
      setNotice(action === 'grant' ? '已开通教师权限，对方刷新页面后生效。' : '已撤销该账号的教师权限。');
      setTarget(null); setConfirmed(false);
      setData(await authedFetch<TeacherAccessWorkspace>('/api/teacher/access'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><h1 className="page-title">教师权限</h1><p className="page-lead">仅管理员可开通或撤销教师，普通教师管理自己的班级。</p></div><Link className="btn btn-secondary" href="/teacher/classes">返回班级管理</Link></header>
    {error && <p className={styles.feedback} role="alert">{error}</p>}{notice && <p className={styles.feedback} role="status">{notice}</p>}
    {!data && !error && <p role="status">正在校验管理员权限…</p>}
    {data && <>
      <section className={styles.card}><h2>开通教师</h2><p>对方先登录一次，再输入 cxid 查找并核对具体账号。cxid 用于查找，授权绑定到选定账号。</p>
        <form onSubmit={(e) => { e.preventDefault(); void search(); }}><label>cxid / uid<input required inputMode="numeric" pattern="[0-9]{1,32}" maxLength={32} value={cxid} disabled={busy} onChange={(e) => setCxid(e.target.value)} placeholder="输入对方的超星号" /></label><button className="btn btn-primary" disabled={busy}>查找账号</button></form>
        {data.candidates.map((item) => <div className={styles.request} key={item.userId}><span><strong>{item.name}</strong><small>cxid：{item.cxid} · 绑定邮箱：{item.email || '未提供'}</small><small>账号标识：{item.userId}</small></span><button type="button" className="btn btn-secondary" disabled={busy || item.isTeacher} onClick={() => { setTarget(item); setConfirmed(false); }}>{item.isTeacher ? '已是教师' : '选择账号'}</button></div>)}
        {cxid && !busy && !data.candidates.length && <p>未找到账号时，请对方先登录；不要根据相似姓名开通权限。</p>}
      </section>
      {target && <section className={styles.card}><h2>核对授权对象：{target.name}</h2><p>cxid：{target.cxid} · {target.email}</p><p>教师可以管理病例、创建班级，查看所管理班级学生的学情和报告。</p>
        <label><span><input type="checkbox" style={{width:18,minHeight:18,marginRight:8}} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />我已核对该账号与本人一致，确认{target.isTeacher ? '撤销' : '开通'}教师权限</span></label>
        <div className={styles.actions}><button type="button" className="btn btn-primary" disabled={!confirmed || busy} onClick={() => void save(target.isTeacher ? 'revoke' : 'grant')}>{busy ? '正在处理…' : target.isTeacher ? '确认撤销' : '确认开通'}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setTarget(null)}>取消</button></div>
      </section>}
      <section className={styles.card}><h2>已开通教师</h2>{data.teachers.map((item) => <div className={styles.request} key={item.userId}><span><strong>{item.name}{item.isAdmin ? ' · 管理员' : ''}</strong><small>cxid：{item.cxid || '未提供'}</small></span>{!item.isAdmin && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setTarget(item); setConfirmed(false); }}>撤销权限</button>}</div>)}</section>
    </>}
  </div>;
}
