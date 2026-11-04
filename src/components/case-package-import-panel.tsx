'use client';

import { useCallback, useEffect, useState } from 'react';
import { CASE_NAME_BY_ID } from '@/domain/teacher-case-catalog';
import { authedFetch } from '@/lib/authed-api';

interface PackageMetadata {
  fingerprint: string;
  entryCount: number;
  sourceCount: number;
  aliasCount: number;
  subtypeCount: number;
}

interface ImportDiagnostic {
  total: number;
  loaded: number;
  pending: number;
  missingLocal: number;
  noSource: number;
}

interface PreflightResult {
  package: PackageMetadata;
  diagnostic: ImportDiagnostic;
}

interface ControlledImportResult {
  package: PackageMetadata;
  summary: {
    total: number;
    imported: number;
    unchanged: number;
    skipped: number;
    failed: number;
  };
  verification: {
    total: number;
    verified: number;
    incomplete: number;
    failed: number;
    skipped: number;
    cases: Array<{
      caseId: string;
      version: string;
      importStatus: string;
      factsMatched: boolean;
      answersMatched: boolean;
      status: 'verified' | 'incomplete' | 'failed' | 'skipped';
    }>;
  };
}

const statusLabels = {
  verified: '双表已核对',
  incomplete: '回读不完整',
  failed: '导入失败',
  skipped: '已跳过',
} as const;

export function CasePackageImportPanel() {
  const [busy, setBusy] = useState<'load' | 'import' | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [result, setResult] = useState<ControlledImportResult | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      setPreflight(await authedFetch<PreflightResult>('/api/teacher/case-package-import'));
    } catch (reason) {
      setError(`病例包校验失败：${(reason as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load 的 setState 均在异步 fetch 返回后执行
  useEffect(() => { void load(); }, [load]);

  async function runImport() {
    if (!preflight) return;
    if (!confirm(`确认导入服务器固定病例包（${preflight.package.sourceCount} 份源病例）？系统会逐例进行事实表与答案表回读；重复执行不会覆盖同版本历史数据。`)) return;
    setBusy('import');
    setError('');
    try {
      const imported = await authedFetch<ControlledImportResult>('/api/teacher/case-package-import', {
        method: 'POST',
        body: JSON.stringify({ packageFingerprint: preflight.package.fingerprint }),
      });
      setResult(imported);
      await load();
    } catch (reason) {
      setError(`受控导入未完成：${(reason as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="case-publication">
      <h2>固定病例包换版</h2>
      <p>
        仅使用服务器已登记并通过 SHA-256、schema 与完整性校验的病例包；不上传文件、不接收病例正文。导入沿用当前超星教师会话和数据库 RLS，逐例回读事实表与答案表，历史会话及报告快照不被覆盖。
      </p>
      <div className="case-import-actions">
        <button className="btn btn-secondary" onClick={() => void load()} disabled={busy !== null}>
          {busy === 'load' ? '校验中…' : '重新校验'}
        </button>
        <button className="btn btn-primary" onClick={() => void runImport()} disabled={busy !== null || !preflight}>
          {busy === 'import' ? '导入并回查中…' : '执行固定包导入'}
        </button>
      </div>
      {error && <div className="empty-state" role="alert"><p>{error}</p></div>}
      {preflight && (
        <div className="case-import-diagnostic" role="status">
          <p>
            固定包：{preflight.package.sourceCount} 份源病例，{preflight.package.entryCount} 个入口
            （{preflight.package.aliasCount} 个别名、{preflight.package.subtypeCount} 个亚型）。
          </p>
          <p>
            当前版本对照：已装载 {preflight.diagnostic.loaded}，待导入 {preflight.diagnostic.pending}，
            本地缺失 {preflight.diagnostic.missingLocal}，无来源 {preflight.diagnostic.noSource}。
          </p>
        </div>
      )}
      {result && (
        <div className="case-import-diagnostic" aria-live="polite">
          <p>
            本次写入：新增 {result.summary.imported}，同版本 {result.summary.unchanged}，
            跳过 {result.summary.skipped}，报告失败 {result.summary.failed}。
          </p>
          <p>
            最终双表回读：已核对 {result.verification.verified}/{result.verification.total}，
            不完整 {result.verification.incomplete}，失败 {result.verification.failed}，跳过 {result.verification.skipped}。
            {result.verification.verified !== result.verification.total ? ' 未通过项可用同一包指纹安全重试。' : ''}
          </p>
          <details>
            <summary>查看逐例脱敏状态（{result.verification.cases.length} 例）</summary>
            <table>
              <thead>
                <tr><th>病例</th><th>版本</th><th>事实表</th><th>答案表</th><th>最终状态</th></tr>
              </thead>
              <tbody>
                {result.verification.cases.map((row) => (
                  <tr key={row.caseId}>
                    <td>{row.caseId}{CASE_NAME_BY_ID.get(row.caseId) ? `（${CASE_NAME_BY_ID.get(row.caseId)}）` : ''}</td>
                    <td>{row.version || '—'}</td>
                    <td>{row.factsMatched ? '匹配' : '未匹配'}</td>
                    <td>{row.answersMatched ? '匹配' : '未匹配'}</td>
                    <td>{statusLabels[row.status]}</td>
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
