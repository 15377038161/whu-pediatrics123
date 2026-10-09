'use client';

/**
 * 教师病例导入面板（仅教师）：
 * - GET /api/teacher/case-import：本地 53 JSON 版本指纹与 DB 导入版本对照诊断（loaded/pending/missing_local/no_source）
 * - POST /api/teacher/case-import：服务端读本地受控产物双写持久缓存（客户端不传患者原文/token/role）
 * 不显示患者原文或密钥：诊断仅版本指纹与状态枚举；导入结果仅 caseId+状态+版本。
 */

import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from '@/lib/authed-api';

interface CaseImportDiagnostic {
  caseId: string;
  localVersion: string | null;
  dbVersion: string | null;
  status: 'loaded' | 'pending' | 'missing_local' | 'no_source';
}

interface ImportDiagnostic {
  total: number;
  loaded: number;
  pending: number;
  missingLocal: number;
  noSource: number;
  counts: { persistedFactsVersions: number | null; persistedAnswerVersions: number | null; boundTeacherSessions: number | null };
  cases: CaseImportDiagnostic[];
}

interface ImportResult {
  summary: { total: number; imported: number; unchanged: number; skipped: number; failed: number };
  results: Array<{ caseId: string; status: string; version: string | null }>;
}

const STATUS_LABEL: Record<CaseImportDiagnostic['status'], string> = {
  loaded: '已装载（本地与 DB 同版本）',
  pending: '待导入（本地有完整版本，DB 未装载）',
  missing_local: '本地缺失（冷启动场景，DB 已装载）',
  no_source: '暂无完整来源（资料不足）',
};

export function TeacherCaseImportPanel() {
  const [busy, setBusy] = useState<'diagnose' | 'import' | null>(null);
  const [diagnostic, setDiagnostic] = useState<ImportDiagnostic | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const loadDiagnostic = useCallback(async () => {
    setBusy('diagnose');
    setError('');
    try {
      const data = await authedFetch<ImportDiagnostic>('/api/teacher/case-import');
      setDiagnostic(data);
    } catch (e) {
      setError(`诊断读取失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loadDiagnostic 的 setState 均在异步 fetch 返回后执行
  useEffect(() => { void loadDiagnostic(); }, [loadDiagnostic]);

  async function runImport() {
    if (!confirm('将本地 53 份已审核病例以教师身份导入持久缓存（不覆盖已装载版本）。继续？')) return;
    setBusy('import');
    setError('');
    setImportResult(null);
    try {
      const data = await authedFetch<ImportResult>('/api/teacher/case-import', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setImportResult(data);
      await loadDiagnostic();
    } catch (e) {
      setError(`导入失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="teacher-case-import">
      <h2>已审核病例导入（53 份）</h2>
      <p>
        将本地受控交接产物（教师已审核、gitignored）以教师身份双写持久缓存：教学事实（学生按本人会话受控读取）与对照答案（仅教师）。客户端不传输患者原文、token 或角色；导入由服务端校验来源、schema 与内容哈希后执行。
      </p>
      <div className="case-import-actions">
        <button className="btn btn-secondary" onClick={() => void loadDiagnostic()} disabled={busy !== null}>
          {busy === 'diagnose' ? '诊断中…' : '刷新来源诊断'}
        </button>
        <button className="btn btn-primary" onClick={() => void runImport()} disabled={busy !== null}>
          {busy === 'import' ? '导入中…' : '导入已审核 53 份病例'}
        </button>
      </div>
      {error && <div className="empty-state" role="alert"><p>{error}</p></div>}
      {busy === 'import' && <div className="empty-state" role="status"><p>正在执行服务端导入（每例校验 schema 与内容哈希，可能需要数十秒）…</p></div>}
      {diagnostic && (
        <div className="case-import-diagnostic">
          <h3>来源覆盖诊断（仅教师可见）</h3>
          <p>
            共 {diagnostic.total} 例：已装载 {diagnostic.loaded}，待导入 {diagnostic.pending}，本地缺失 {diagnostic.missingLocal}，暂无完整来源 {diagnostic.noSource}。
            持久缓存：facts 版本 {diagnostic.counts.persistedFactsVersions ?? '未知'}，answers 版本 {diagnostic.counts.persistedAnswerVersions ?? '未知'}。
          </p>
          <details>
            <summary>按病例查看版本对照（{diagnostic.cases.length} 例）</summary>
            <table>
              <thead>
                <tr><th>病例</th><th>状态</th><th>本地版本</th><th>DB 版本</th></tr>
              </thead>
              <tbody>
                {diagnostic.cases.map((item) => (
                  <tr key={item.caseId}>
                    <td>{item.caseId}</td>
                    <td>{STATUS_LABEL[item.status]}</td>
                    <td>{item.localVersion ? `${item.localVersion.slice(0, 8)}…` : '缺失'}</td>
                    <td>{item.dbVersion ? `${item.dbVersion.slice(0, 8)}…` : '未装载'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
      {importResult && (
        <div className="case-import-result" role="status">
          <h3>导入结果</h3>
          <p>
            共 {importResult.summary.total} 例：新导入 {importResult.summary.imported}，幂等跳过 {importResult.summary.unchanged}，其他跳过 {importResult.summary.skipped}，失败 {importResult.summary.failed}。
          </p>
          {importResult.summary.failed > 0 && (
            <details open>
              <summary>失败明细</summary>
              <ul>
                {importResult.results.filter((r) => r.status === 'failed').map((r) => (
                  <li key={r.caseId}>{r.caseId}：{r.status}{r.version ? ` @ ${r.version.slice(0, 8)}…` : ''}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
