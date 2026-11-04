'use client';

/**
 * 教师单例上下架面板（仅教师）：
 * - GET /api/teacher/case-publication：目录发布状态对照（全部教师病例目录条目，含
 *   folder=null 的 catalog-only 条目，missingSource 展示"缺少原始接诊资料"；无行=已发布缺省开放）
 * - POST /api/teacher/case-publication：{ caseId, published, reason? }
 * 语义：下架=可恢复停用（不删原文/历史会话/成绩）；学生不可新建该病例训练且目录隐藏；
 * 既有会话恢复与教师访问不受影响；幂等初始化不重置下架决定。
 * 不显示患者原文：仅病例 ID/名称、发布状态、时间与理由。
 */

import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format-date';
import { CASE_INDEX_NUMBER, CASE_NAME_BY_ID } from '@/domain/teacher-case-catalog';
import { authedFetch } from '@/lib/authed-api';

interface PublicationRow {
  caseId: string;
  published: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string;
  activeVersion: string | null;
  /** true = 目录条目缺少原始接诊资料（folder=null，catalog-only）。 */
  missingSource?: boolean;
}

interface PublicationOverview {
  total: number;
  unpublished: number;
  cases: PublicationRow[];
}

export function CasePublicationPanel() {
  const [busy, setBusy] = useState<'load' | string | null>(null);
  const [overview, setOverview] = useState<PublicationOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activationCaseId, setActivationCaseId] = useState('');
  const [activationVersion, setActivationVersion] = useState('');

  const load = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      const data = await authedFetch<PublicationOverview>('/api/teacher/case-publication');
      setOverview(data);
    } catch (e) {
      setError(`发布状态读取失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load 的 setState 均在异步 fetch 返回后执行
  useEffect(() => { void load(); }, [load]);

  async function toggle(row: PublicationRow) {
    const nextPublished = !row.published;
    const action = nextPublished ? '上架' : '下架';
    let reason = '';
    if (!nextPublished) {
      const input = prompt(`下架「${row.caseId}」的理由（可选，≤200 字，供审计记录）：`);
      if (input === null) return;
      reason = input.slice(0, 200);
    }
    if (!confirm(`确认${action}「${row.caseId}」？${nextPublished ? '' : '下架后学生不能基于该病例新建训练，已有训练记录不受影响，可随时重新上架。'}`)) return;
    setBusy(row.caseId);
    setError('');
    setNotice('');
    try {
      await authedFetch('/api/teacher/case-publication', {
        method: 'POST',
        body: JSON.stringify({ caseId: row.caseId, published: nextPublished, reason }),
      });
      setNotice(`已${action}：${row.caseId}`);
      await load();
    } catch (e) {
      setError(`${action}失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function activateVersion() {
    const caseId = activationCaseId.trim();
    const activeVersion = activationVersion.trim();
    if (!caseId || !/^[a-f0-9]{16}$/.test(activeVersion)) {
      setError('请输入有效病例 ID 和 16 位小写版本指纹。');
      return;
    }
    if (!confirm(`确认将「${caseId}」的新会话切换到版本 ${activeVersion}？既有会话、报告和上下架状态不变。`)) return;
    setBusy('activate');
    setError('');
    setNotice('');
    try {
      await authedFetch('/api/teacher/case-publication', {
        method: 'POST',
        body: JSON.stringify({ caseId, activeVersion, reason: '受控病例双表回读后切换新会话版本' }),
      });
      setNotice(`已激活新版本：${caseId} → ${activeVersion}；仅新会话生效。`);
      setActivationVersion('');
      await load();
    } catch (e) {
      setError(`版本激活失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="case-publication">
      <h2>病例发布状态（单例上下架）</h2>
      <p>
        下架是可恢复停用：不删除病例原文与历史训练记录，仅拦截学生新建该病例的训练并在学生目录中隐藏；教师仍可预览复核。重新上架随时可逆，操作留审计痕迹。
      </p>
      <div className="case-import-actions">
        <button className="btn btn-secondary" onClick={() => void load()} disabled={busy !== null}>
          {busy === 'load' ? '读取中…' : '刷新发布状态'}
        </button>
      </div>
      <div className="case-import-diagnostic">
        <h3>新会话版本激活</h3>
        <p>仅用于已通过双表回读的受控版本；激活不改变上下架状态，既有会话与报告仍使用原版本。</p>
        <div className="case-import-actions">
          <label>
            病例 ID
            <input value={activationCaseId} onChange={(event) => setActivationCaseId(event.target.value)} placeholder="teacher-病例名" autoComplete="off" />
          </label>
          <label>
            版本指纹
            <input value={activationVersion} onChange={(event) => setActivationVersion(event.target.value)} placeholder="16 位小写十六进制" maxLength={16} autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn btn-primary" onClick={() => void activateVersion()} disabled={busy !== null}>
            {busy === 'activate' ? '激活中…' : '激活新版本'}
          </button>
        </div>
      </div>
      {error && <div className="empty-state" role="alert"><p>{error}</p></div>}
      {notice && <div className="empty-state" role="status"><p>{notice}</p></div>}
      {overview && (
        <div className="case-import-diagnostic">
          <p>共 {overview.total} 例：已发布 {overview.total - overview.unpublished}，已下架 {overview.unpublished}。</p>
          <details>
            <summary>按病例管理发布状态（{overview.cases.length} 例）</summary>
            <table>
              <thead>
                <tr><th>编号</th><th>病例</th><th>状态</th><th>最近操作</th><th>理由</th><th>操作</th></tr>
              </thead>
              <tbody>
                {overview.cases.map((row) => (
                  <tr key={row.caseId}>
                    <td>#{CASE_INDEX_NUMBER[row.caseId] ?? '—'}</td>
                    <td>
                      {row.caseId}
                      {CASE_NAME_BY_ID.get(row.caseId) ? <span className="publication-case-name">（{CASE_NAME_BY_ID.get(row.caseId)}）</span> : null}
                      {row.missingSource && (
                        <span className="publication-missing-source" title="该目录条目缺少原始接诊资料（folder=null），下架不影响既有训练记录">缺少原始接诊资料</span>
                      )}
                    </td>
                    <td>
                      {row.published ? '已发布' : '已下架'}
                      <span className="publication-case-name">新会话版本：{row.activeVersion ?? '默认选择链'}</span>
                    </td>
                    <td>{row.updatedAt ? formatDateTime(row.updatedAt) : '—'}</td>
                    <td>{row.reason || '—'}</td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => void toggle(row)} disabled={busy !== null}>
                        {busy === row.caseId ? '处理中…' : row.published ? '下架' : '上架'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </section>
  );
}
