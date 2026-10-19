'use client';

import { AlertCircle, FileWarning, Loader2, RotateCcw, Search, Star, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicCaseProfile } from '@/domain/case-catalog';
import {
  listSubjects,
  PAGE_SIZE,
  readRecentSelection,
  searchCases,
  writeRecentSelection,
  type CaseReadiness,
} from '@/domain/case-classification';
import { authedFetch } from '@/lib/authed-api';
import { useGateUser } from '@/components/auth-gate';

/**
 * 学生病例库（2026-10-16 七项重构）：
 * - 数据源 /api/cases（服务端发布过滤：教师已下架项不下发，学生不感知）；
 * - 多维分类（学科归一 + 资料完备度）+ 关键词搜索组合筛选，筛选变化重置页码；
 * - 分页 9/页，桌面三列；卡片仅目录元数据，正文/媒体进入训练才加载；
 * - 预览卡只含非答案信息；资料不足项（3 项）OSCE 禁用（服务端另有守卫）；
 * - 最近选择按当前用户 localStorage 键隔离，切换账号不泄露他人记录。
 */

const READINESS_OPTIONS: Array<{ value: CaseReadiness | 'all'; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'independent', label: '独立来源' },
  { value: 'linked', label: '关联来源' },
  { value: 'insufficient', label: '资料不足' },
];

export function CaseLibrary() {
  const user = useGateUser();
  const [catalog, setCatalog] = useState<PublicCaseProfile[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [subject, setSubject] = useState('all');
  const [readiness, setReadiness] = useState<CaseReadiness | 'all'>('all');
  const [page, setPage] = useState(1);
  const [jumpPage, setJumpPage] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [recentUser, setRecentUser] = useState<string | null>(null);
  if (recentUser !== user.id) {
    // 用户切换时渲染期重置最近选择（React 官方模式）：仅本人键读取，切换账号即换键，互不泄露。
    // 组件处于客户端门控内，此分支仅在挂载后/账号变化时执行，localStorage 访问安全。
    setRecentUser(user.id);
    setRecent(readRecentSelection(localStorage, user.id));
  }

  const fetchCatalog = useCallback((): Promise<PublicCaseProfile[]> => authedFetch<PublicCaseProfile[]>('/api/cases'), []);
  const applyCatalog = (outcome: Promise<PublicCaseProfile[]>) => {
    outcome
      .then((data) => {
        setCatalog(data);
        setLoadError(false);
      })
      .catch(() => {
        setCatalog(null);
        setLoadError(true);
      });
  };

  useEffect(() => {
    applyCatalog(fetchCatalog());
  }, [fetchCatalog]);

  const subjects = useMemo(() => (catalog ? listSubjects(catalog) : []), [catalog]);
  const result = useMemo(
    () => (catalog ? searchCases(catalog, { keyword, subject, readiness, page }) : null),
    [catalog, keyword, subject, readiness, page],
  );

  const resetPage = (updater: () => void) => {
    updater();
    setPage(1);
    setJumpPage('');
  };

  const enterCase = (caseId: string) => {
    setRecent(writeRecentSelection(localStorage, user.id, caseId));
  };

  if (loadError) {
    return (
      <div className="empty-state" role="alert">
        <AlertCircle size={28} aria-hidden />
        <p>病例目录加载失败，请重试。</p>
        <button type="button" className="btn btn-primary" onClick={() => applyCatalog(fetchCatalog())}>
          <RotateCcw size={15} /> 重新加载
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="case-library-loading" role="status" aria-live="polite">
        <Loader2 size={22} className="spin" aria-hidden />
        正在加载病例目录…
      </div>
    );
  }

  return (
    <>
      <div className="case-library-filter">
        <label className="case-search">
          <Search size={17} aria-hidden />
          <input
            aria-label="搜索病例"
            value={keyword}
            onChange={(event) => resetPage(() => setKeyword(event.target.value))}
            placeholder="搜索病例、症状或系统"
          />
          {keyword && (
            <button type="button" aria-label="清空搜索" onClick={() => resetPage(() => setKeyword(''))}>
              <X size={14} aria-hidden />
            </button>
          )}
        </label>
        <select
          aria-label="按学科筛选"
          value={subject}
          onChange={(event) => resetPage(() => setSubject(event.target.value))}
        >
          <option value="all">全部学科</option>
          {subjects.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <details className="case-advanced-filter"><summary>更多筛选</summary><select
          aria-label="按资料来源筛选"
          value={readiness}
          onChange={(event) => resetPage(() => setReadiness(event.target.value as CaseReadiness | 'all'))}
        >
          {READINESS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select></details>
      </div>

      {recent.length > 0 && (
        <details className="case-recent"><summary>最近选择</summary><div aria-label="最近选择">
          <span className="case-recent-label">最近选择：</span>
          {recent.map((caseId) => {
            const profile = catalog?.find((item) => item.id === caseId);
            if (!profile) return null;
            return (
              <a
                href={`/student/training?mode=guided&case=${encodeURIComponent(caseId)}`}
                key={caseId}
                onClick={() => enterCase(caseId)}
              >
                {profile.title}
              </a>
            );
          })}
          <span className="case-note-hint">仅本账号可见</span>
        </div></details>
      )}

      <p className="case-note-hint case-hidden-note" role="status">
        共 {result.total} 个病例{result.total > 0 && ` · 显示第 ${(result.page - 1) * PAGE_SIZE + 1}–${Math.min(result.page * PAGE_SIZE, result.total)} 个`} · 仅展示接诊线索
      </p>

      <div className="case-library">
        {result.items.map((item) => {
          const insufficient = item.classification.readiness.readiness === 'insufficient';
          return (
            <article className="case-card" key={item.id}>
              <div className="case-card-copy">
                <div className="case-card-heading"><p className="case-number">{item.classification.subject}</p>
                  <span className="case-stars" aria-label={`教学难度 ${item.classification.stars} 星（${item.classification.starReason}）`} title={item.classification.starReason}>
                    {[1, 2].map((star) => (
                      <Star key={star} size={13} aria-hidden className={star <= item.classification.stars ? 'star-filled' : 'star-empty'} />
                    ))}
                  </span>
                </div>
                <h3><a className="case-card-entry" href={`/student/training?mode=guided&case=${encodeURIComponent(item.id)}`} onClick={() => enterCase(item.id)}>{item.title}</a></h3>
                <div className="case-meta">
                  <span className={`readiness-badge readiness-${item.classification.readiness.readiness}`}>{item.classification.readiness.label}</span>
                  {item.expectedMinutes > 0 && <span>{item.expectedMinutes} 分钟</span>}
                  <span>{item.age !== '待核验' ? `${item.age} · ${item.sex}` : '接诊信息待审核'}</span>
                </div>
                {insufficient && (
                  <p className="case-source-note case-insufficient-note"><FileWarning size={13} aria-hidden /> 资料不足：本病种无独立病例正文，仅可记录诊疗思路，不进入可评分测试。</p>
                )}
                <div className="symptom-list" aria-label="就诊症状">
                  {item.presentingSymptoms.length
                    ? item.presentingSymptoms.map((symptom) => <span key={symptom}>{symptom}</span>)
                    : <span className="symptom-pending">症状线索进入训练后采集</span>}
                </div>
                <div className="case-card-actions">
                  <details className="case-mode-menu"><summary>更多</summary><div>
                  {!insufficient && item.classification.readiness.note !== '演示病例' && <p className="case-source-note">{item.classification.readiness.note}{item.classification.readiness.readiness === 'linked' ? '（不另造新患者）' : ''}</p>}
                  <a className="text-link" href={`/student/training?mode=immersive&case=${encodeURIComponent(item.id)}`} onClick={() => enterCase(item.id)}>
                    沉浸式教学
                  </a>
                  {insufficient ? (
                    <span className="text-link disabled" aria-disabled="true" title="资料不足，不进入可评分测试">
                      OSCE 练习（不可用）
                    </span>
                  ) : (
                    <a className="text-link" href={`/student/training?mode=osce&case=${encodeURIComponent(item.id)}`} onClick={() => enterCase(item.id)}>
                      OSCE 练习
                    </a>
                  )}
                  </div></details>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {result.total === 0 && (
        <p className="empty-state">没有找到病例，试试病种名称或调整学科与来源筛选。</p>
      )}

      {result.pageCount > 1 && (
        <nav className="case-pagination" aria-label="病例分页">
          <button type="button" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)} aria-label="上一页">
            上一页
          </button>
          {Array.from({ length: result.pageCount }, (_, index) => index + 1).map((number) => (
            <button
              type="button"
              key={number}
              aria-label={`第 ${number} 页`}
              aria-current={number === result.page ? 'page' : undefined}
              className={number === result.page ? 'page-active' : ''}
              onClick={() => setPage(number)}
            >
              {number}
            </button>
          ))}
          <button type="button" disabled={result.page >= result.pageCount} onClick={() => setPage(result.page + 1)} aria-label="下一页">
            下一页
          </button>
          <span>每页 {PAGE_SIZE} 项 · 第 {result.page} / {result.pageCount} 页</span>
          <form className="case-page-jump" onSubmit={(event) => { event.preventDefault(); const target = Number(jumpPage); if (Number.isInteger(target) && target >= 1 && target <= result.pageCount) { setPage(target); setJumpPage(''); } }}>
            <label>跳至<input aria-label="跳转页码" type="number" inputMode="numeric" min={1} max={result.pageCount} step={1} required value={jumpPage} onChange={(event) => setJumpPage(event.target.value)} />页</label>
            <button type="submit">跳转</button>
          </form>
        </nav>
      )}
    </>
  );
}
