'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ClassWorkspace } from '@/domain/classroom';
import { authedFetch } from '@/lib/authed-api';
import { parseRosterText, type RosterRow } from '@/lib/class-roster';
import styles from './class-workspace.module.css';

export function ClassWorkspacePanel({ teacher = false }: { teacher?: boolean }) {
  const [data, setData] = useState<ClassWorkspace | null>(null);
  const [selected, setSelected] = useState('');
  const [loadedClass, setLoadedClass] = useState('');
  const [name, setName] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [rosterText, setRosterText] = useState('');
  const [preview, setPreview] = useState<RosterRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const next = await authedFetch<ClassWorkspace>(`/api/classes${selected ? `?classId=${selected}` : ''}`);
    setData(next); setLoadedClass(selected);
  }, [selected]);
  useEffect(() => { let active = true;
    authedFetch<ClassWorkspace>(`/api/classes${selected ? `?classId=${selected}` : ''}`)
      .then((next) => { if (active) { setData(next); setLoadedClass(selected); setError(''); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取失败'); });
    return () => { active = false; };
  }, [selected]);
  async function mutate(input: object, message: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await authedFetch('/api/classes', { method: 'POST', body: JSON.stringify(input) }); await load(); setPreview(null); setRosterText(''); setNotice(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setPreview(null); setError('');
    if (file.size > 500_000) { setError('名单文件过大，请分批导入'); return; }
    try { const text = await file.text(); setRosterText(text); setPreview(parseRosterText(text)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取名单失败'); }
  }
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><h1 className="page-title">{teacher ? '班级管理' : '我的班级'}</h1>
      <p className="page-lead">{teacher ? '创建班级、维护名单，审核学生入班申请。' : '名单匹配后自动入班，未匹配时可申请加入。'}</p></div>
      {teacher && data?.isAdmin && <Link className="btn btn-secondary" href="/teacher/access">教师权限</Link>}
    </header>
    {error && <div className={styles.feedback} role="alert">{error} <button type="button" className="btn btn-quiet" onClick={() => void load().catch(() => setError('读取失败，请稍后重试'))}>重试</button></div>}
    {notice && <p className={styles.feedback} role="status">{notice}</p>}
    {!data && !error && <p role="status">正在读取班级…</p>}
    {teacher && <form className={styles.create} onSubmit={(e) => { e.preventDefault(); void mutate({ action: 'create', name }, '班级已创建'); }}>
      <label>班级名称<input required maxLength={80} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="例如：2026 级临床医学 1 班" /></label>
      <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>创建班级</button>
    </form>}
    {data && <>
      {!data.classes.length && <section className={styles.card}>{teacher ? '还没有班级，先创建第一个班级。' : '暂时没有可申请的班级，请联系任课老师。'}</section>}
      <div className={styles.grid}>{data.classes.map((item) => {
        const member = data.memberships.includes(item.id);
        const pending = data.requests.some((r) => r.classId === item.id && r.status === 'pending');
        return <button type="button" key={item.id} className={styles.classCard} aria-pressed={selected === item.id} disabled={busy} onClick={() => { setSelected(item.id); setPreview(null); setRosterText(''); setNotice(''); }}>
          <strong>{item.name}</strong><span>{item.ownerName || '任课老师'}</span>
          <small>{teacher ? `${item.memberCount} 名学生 · ${item.pendingCount} 条待审核` : member ? '已加入' : pending ? '申请待审核' : '可申请加入'}</small>
        </button>;
      })}</div>
      {selected && loadedClass !== selected && <p role="status">正在读取班级详情…</p>}
      {selected && loadedClass === selected && <section className={styles.card}>
        <h2>{data.classes.find((c) => c.id === selected)?.name}</h2>
        {teacher ? <>
          <h3>导入学生名单</h3><p>从 Excel 复制并粘贴，或上传 UTF-8 CSV。表头包含姓名，以及 cxid 或学号；编号按文本保存。</p>
          <label className={styles.file}>选择 CSV 文件<input type="file" accept=".csv,.tsv,.txt" disabled={busy} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <label>学生名单<textarea rows={5} disabled={busy} value={rosterText} placeholder={'姓名\tcxid\t学号\n张同学\t123456\t\n李同学\t\t001234'} onChange={(e) => { setRosterText(e.target.value); setPreview(null); }} /></label>
          <div className={styles.actions}><button className="btn btn-secondary" type="button" disabled={busy || !rosterText.trim()} onClick={() => { try { setPreview(parseRosterText(rosterText)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : '名单格式错误'); } }}>预览名单</button>
          {preview && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void mutate({ action: 'import', classId: selected, rows: preview }, `已导入 ${preview.length} 条名单；未能验证的编号留待老师核对。`)}>确认导入 {preview.length} 人</button>}</div>
          {preview && <div className={styles.table}><table><caption>导入预览（尚未保存）</caption><thead><tr><th>姓名</th><th>cxid</th><th>学号</th></tr></thead><tbody>{preview.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.cxid || '—'}</td><td>{r.studentNo || '—'}</td></tr>)}</tbody></table></div>}
          <h3>入班申请</h3>
          {!data.requests.some((r) => r.status === 'pending') && <p>暂无待审核申请。</p>}
          {data.requests.filter((r) => r.status === 'pending').map((r) => <div className={styles.request} key={r.id}><span><strong>{r.name}</strong><small>cxid：{r.cxid || '未提供'} · 学号：{r.studentNo || '未提供'}（待核对）</small></span><div className={styles.actions}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void mutate({ action: 'review', requestId: r.id, approve: true }, '已同意入班')}>同意</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void mutate({ action: 'review', requestId: r.id, approve: false }, '已拒绝申请')}>拒绝</button></div></div>)}
          <h3>导入名单</h3><div className={styles.table}><table><thead><tr><th>姓名</th><th>cxid</th><th>学号</th><th>状态</th></tr></thead><tbody>{data.roster.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.cxid || '—'}</td><td>{r.studentNo || '—'}</td><td>{r.userId ? '已绑定' : '待绑定'}</td></tr>)}</tbody></table></div>
          <h3>已入班学生（{data.members.length} 人）</h3>
          {!data.members.length ? <p>暂时没有已入班学生。未绑定名单不会仅凭姓名匹配账号。</p> : <div className={styles.table}><table><thead><tr><th>姓名</th><th>cxid</th><th>学号</th></tr></thead><tbody>{data.members.map((m) => <tr key={m.userId}><td>{m.name}</td><td>{m.cxid || '—'}</td><td>{m.studentNo || '—'}</td></tr>)}</tbody></table></div>}
        </> : data.memberships.includes(selected) ? <p>你已加入该班级。</p> : <form onSubmit={(e) => { e.preventDefault(); void mutate({ action: 'request', classId: selected, studentNo }, '申请已提交，等待任课老师审核'); }}>
          <label>学号（选填）<input value={studentNo} maxLength={64} disabled={busy} onChange={(e) => setStudentNo(e.target.value)} placeholder="如名单使用学号，可在此填写供老师核对" /></label>
          <button type="submit" className="btn btn-primary" disabled={busy || data.requests.some((r) => r.classId === selected && r.status === 'pending')}>申请加入班级</button>
        </form>}
      </section>}
    </>}
  </div>;
}
