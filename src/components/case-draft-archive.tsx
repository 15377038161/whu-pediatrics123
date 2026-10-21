'use client';

/**
 * 教师病例草稿只读档案（D08 收口后）：
 * - GET /api/teacher/case-drafts 读取历史草稿列表（收口前保存的记录，保留只读）；
 * - 创建/导入入口已收口：本组件不提供任何新建、编辑、上传或删除操作；
 * - 不显示患者原文：仅病例 ID/名称、版本、来源、核对状态与时间。
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/format-date';
import { authedFetch } from '@/lib/authed-api';
import type { CaseDraftRecord } from '@/lib/case-draft-import';

export function CaseDraftArchive() {
  const [drafts, setDrafts] = useState<CaseDraftRecord[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await authedFetch<CaseDraftRecord[]>('/api/teacher/case-drafts');
      setDrafts(next);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '草稿档案读取失败');
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load 的 setState 均在异步 fetch 返回后执行
  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div role="alert" style={{ color: '#a4442f' }}>
        {error}{' '}
        <button type="button" className="btn btn-quiet" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  }
  if (!drafts) {
    return (
      <p role="status" style={{ color: '#697b78' }}>
        正在读取草稿档案…
      </p>
    );
  }
  if (!drafts.length) {
    return <p style={{ color: '#697b78' }}>暂无历史草稿记录。</p>;
  }
  return (
    <div className="table-scroll-wrap" style={{ overflowX: 'auto' }}>
      <table className="student-table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th>病例</th>
            <th>版本</th>
            <th>来源</th>
            <th>核对状态</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <tr key={draft.id}>
              <td data-label="病例">
                <strong>{draft.caseName || draft.caseId}</strong>
                <br />
                <small>{draft.caseId}</small>
              </td>
              <td data-label="版本">{draft.draftVersion}</td>
              <td data-label="来源">
                {draft.sourceName || '—'}
                <br />
                <small>{draft.sourceKind}{draft.aliasSourceId ? ` · 异名 ${draft.aliasSourceId}` : ''}</small>
              </td>
              <td data-label="核对状态">
                {draft.desensitized ? '已确认脱敏' : '未确认脱敏'} · {draft.mediaReviewed ? '媒体已复核' : '媒体未复核'}
                {draft.missingFields.length > 0 && (
                  <>
                    <br />
                    <small style={{ color: '#a4442f' }}>缺失：{draft.missingFields.join('、')}</small>
                  </>
                )}
              </td>
              <td data-label="创建时间">{formatDateTime(draft.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-quiet" style={{ marginTop: 10 }} onClick={() => void load()}>
        <RefreshCw size={14} style={{ verticalAlign: -2 }} /> 刷新档案
      </button>
    </div>
  );
}
