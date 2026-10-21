'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ClassWorkspace } from '@/domain/classroom';
import { authedFetch } from '@/lib/authed-api';
import { parseRosterText, type RosterRow } from '@/lib/class-roster';
import styles from './class-workspace.module.css';

/** 幂等请求键：服务端按（用户，requestId）去重，重复提交不重复执行、不重复扣换班次数 */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ClassWorkspacePanel({ teacher = false }: { teacher?: boolean }) {
  const [data, setData] = useState<ClassWorkspace | null>(null);
  const [selected, setSelected] = useState('');
  const [loadedClass, setLoadedClass] = useState('');
  const [name, setName] = useState('');
  const [rosterText, setRosterText] = useState('');
  const [preview, setPreview] = useState<RosterRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // 两步确认：学生换班 / 教师归档均需二次点击，避免误触不可逆操作
  const [changeTarget, setChangeTarget] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState('');
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
  const currentClass = data?.classes.find((item) => item.id === data.state.currentCohortId) ?? null;
  const onboarding = data?.state.onboardingDone !== false;
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><h1 className="page-title">{teacher ? '班级管理' : '我的班级'}</h1>
      <p className="page-lead">{teacher ? '创建班级、维护名单并核对归属；学生经首次自选或名单匹配入班，不再需要逐条审批。' : '首次使用请选择班级（或先跳过），学期内可自主更换一次班级。'}</p></div>
      {teacher && data?.isAdmin && <Link className="btn btn-secondary" href="/teacher/access">教师权限</Link>}
    </header>
    {error && <div className={styles.feedback} role="alert">{error} <button type="button" className="btn btn-quiet" onClick={() => void load().catch(() => setError('读取失败，请稍后重试'))}>重试</button></div>}
    {notice && <p className={styles.feedback} role="status">{notice}</p>}
    {!data && !error && <p role="status">正在读取班级…</p>}
    {teacher && <form className={styles.create} onSubmit={(e) => { e.preventDefault(); void mutate({ action: 'create', name }, '班级已创建'); }}>
      <label>班级名称<input required maxLength={80} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="例如：2026 级临床医学 1 班" /></label>
      <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>创建班级</button>
    </form>}
    {data && !teacher && <>
      {!onboarding && <section className={styles.card}>
        <h2>选择你的班级</h2>
        <p>从下方列表选择你所在的班级；名单匹配成功的学生可能已自动入班。也可以先跳过，以游客身份开始训练（训练记录保留在你的账号下，之后不能再自选班级，只能使用一次换班机会）。</p>
        {currentClass && <p className={styles.feedback} role="status">名单匹配到你已在「{currentClass.name}」，完成确认后生效。</p>}
        <div className={styles.actions}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void mutate({ action: 'skip', requestId: newRequestId() }, '已跳过班级选择，你可以游客身份开始训练')}>先跳过（游客身份）</button>
        </div>
      </section>}
      {onboarding && <section className={styles.card}>
        <h2>当前归属</h2>
        {data.state.currentCohortId ? <p>你当前在「{currentClass?.name ?? data.state.currentCohortId}」。更换班级一学期仅一次机会，确认后立即生效；已完成训练记录不受影响，原班老师对归属期间的记录保留只读。</p> : <p>你目前未加入任何班级（游客身份），可选择一个班级加入（计入一次换班机会）。</p>}
        <p>剩余换班机会：{data.state.changesRemaining} 次（已使用 {data.state.selfChangeCount} 次）</p>
      </section>}
      {!data.classes.length && <section className={styles.card}>暂时没有可选班级，请联系任课老师；也可先以游客身份开始训练。</section>}
    </>}
    {data && <>
      {teacher && !data.classes.length && <section className={styles.card}>还没有班级，先创建第一个班级。</section>}
      <div className={styles.grid}>{data.classes.map((item) => {
        const isCurrent = data.state.currentCohortId === item.id;
        const member = data.memberships.includes(item.id);
        return <button type="button" key={item.id} className={styles.classCard} aria-pressed={selected === item.id} disabled={busy} onClick={() => { setSelected(item.id); setPreview(null); setRosterText(''); setNotice(''); setChangeTarget(''); setArchiveConfirm(''); }}>
          <strong>{item.name}</strong><span>{item.ownerName || '任课老师'}</span>
          <small>{teacher
            ? `${item.memberCount} 名学生 · ${item.rosterCount} 条名单${item.conflictCount > 0 ? ` · ${item.conflictCount} 人待核对` : ''}`
            : isCurrent ? '当前班级' : member ? '已加入' : '可选班级'}</small>
        </button>;
      })}</div>
      {selected && loadedClass !== selected && <p role="status">正在读取班级详情…</p>}
      {selected && loadedClass === selected && <section className={styles.card}>
        <h2>{data.classes.find((c) => c.id === selected)?.name}</h2>
        {teacher ? <>
          <h3>导入学生名单</h3><p>从 Excel 复制并粘贴，或上传 UTF-8 CSV。表头包含姓名，以及 cxid 或学号；编号按文本保存。名单在学生首次登录时自动匹配入班。</p>
          <label className={styles.file}>选择 CSV 文件<input type="file" accept=".csv,.tsv,.txt" disabled={busy} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <label>学生名单<textarea rows={5} disabled={busy} value={rosterText} placeholder={'姓名\tcxid\t学号\n张同学\t123456\t\n李同学\t\t001234'} onChange={(e) => { setRosterText(e.target.value); setPreview(null); }} /></label>
          <div className={styles.actions}><button className="btn btn-secondary" type="button" disabled={busy || !rosterText.trim()} onClick={() => { try { setPreview(parseRosterText(rosterText)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : '名单格式错误'); } }}>预览名单</button>
          {preview && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void mutate({ action: 'import', classId: selected, rows: preview }, `已导入 ${preview.length} 条名单；未能验证的编号留待老师核对。`)}>确认导入 {preview.length} 人</button>}</div>
          {preview && <div className={styles.table}><table><caption>导入预览（尚未保存）</caption><thead><tr><th>姓名</th><th>cxid</th><th>学号</th></tr></thead><tbody>{preview.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.cxid || '—'}</td><td>{r.studentNo || '—'}</td></tr>)}</tbody></table></div>}
          {data.requests.some((r) => r.status === 'pending') && <>
            <h3>历史申请记录（只读）</h3>
            <p>入班申请审批流程已停用，以下为停用前的历史记录，仅供核对。</p>
            {data.requests.filter((r) => r.status === 'pending').map((r) => <div className={styles.request} key={r.id}><span><strong>{r.name}</strong><small>cxid：{r.cxid || '未提供'} · 学号：{r.studentNo || '未提供'}</small></span></div>)}
          </>}
          <h3>导入名单</h3><div className={styles.table}><table><thead><tr><th>姓名</th><th>cxid</th><th>学号</th><th>状态</th></tr></thead><tbody>{data.roster.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.cxid || '—'}</td><td>{r.studentNo || '—'}</td><td>{r.userId ? '已绑定' : '待绑定'}</td></tr>)}</tbody></table></div>
          <h3>已入班学生（{data.members.length} 人）</h3>
          {!data.members.length ? <p>暂时没有已入班学生。学生完成首次选班或名单唯一匹配后自动入班。</p> : <div className={styles.table}><table><thead><tr><th>姓名</th><th>cxid</th><th>学号</th></tr></thead><tbody>{data.members.map((m) => <tr key={m.userId}><td>{m.name}</td><td>{m.cxid || '—'}</td><td>{m.studentNo || '—'}</td></tr>)}</tbody></table></div>}
          <h3>归档班级</h3>
          <p>归档后班级停用、不再出现在可选列表，学生仍可经一次换班离开；已产生的训练记录不受影响。</p>
          <div className={styles.actions}>{archiveConfirm === selected
            ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void mutate({ action: 'archive', classId: selected, confirmed: true }, '班级已归档').then(() => { setSelected(''); setArchiveConfirm(''); })}>再次点击确认归档</button>
            : <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setArchiveConfirm(selected)}>归档该班级</button>}</div>
        </> : <>
          {!onboarding ? <>
            <p>确认加入「{data.classes.find((c) => c.id === selected)?.name}」？首次选择立即生效，之后只能使用一次换班机会。</p>
            <div className={styles.actions}><button type="button" className="btn btn-primary" disabled={busy || data.memberships.includes(selected)} onClick={() => void mutate({ action: 'initial_select', cohortId: selected, requestId: newRequestId() }, '已加入班级')}>{data.memberships.includes(selected) ? '已在班级中' : '加入该班级'}</button></div>
          </> : data.state.currentCohortId === selected ? <p>这是你当前所在的班级。</p> : <>
            <p>{changeTarget === selected
              ? `确认更换到「${data.classes.find((c) => c.id === selected)?.name}」？将消耗一次换班机会（剩余 ${data.state.changesRemaining} 次），确认后立即生效，不可撤销。`
              : '选择加入该班级将消耗一次换班机会。'}</p>
            <div className={styles.actions}>{changeTarget === selected
              ? <button type="button" className="btn btn-primary" disabled={busy || data.state.changesRemaining < 1} onClick={() => void mutate({ action: 'change_once', cohortId: selected, requestId: newRequestId() }, '已更换班级')}>确认更换（剩余机会将减 1）</button>
              : <button type="button" className="btn btn-secondary" disabled={busy || data.state.changesRemaining < 1} onClick={() => setChangeTarget(selected)}>申请更换到该班级</button>}</div>
            {data.state.changesRemaining < 1 && <p>你的换班机会已用完，如有特殊情况请联系项目管理员。</p>}
          </>}
        </>}
      </section>}
    </>}
  </div>;
}
