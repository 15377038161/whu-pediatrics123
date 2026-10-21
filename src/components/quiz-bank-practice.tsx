'use client';

/**
 * 学生题集练习面板（阶段 F / AI 题库闭环）：
 * - 可见题集列表经受控 RPC（已发布 + platform/本人所在 owner 班级，含本人练习概览）；
 * - 开始/续作/重练：同一题集最多一个进行中批次，重练需明确结束旧批次（fresh=true）；
 * - 作答：逐题提交，服务端判分（幂等：首次提交终局），答案与解析仅作答后释放；
 * - 复盘：URL 携带 ?attempt= 打开历史批次（completed 显示错题复盘，in_progress 可继续作答）。
 */

import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import { formatDateTime } from '@/lib/format-date';
import type { QuizAttemptAnswerResult, QuizAttemptStateView, QuizBankStudentSummary } from '@/lib/quiz-attempt';

const DIFFICULTY_LABEL: Record<'easy' | 'medium' | 'hard', string> = { easy: '易', medium: '中', hard: '难' };

interface BankStartResponse {
  attempt: QuizAttemptStateView;
}

function firstUnansweredIndex(attempt: QuizAttemptStateView): number {
  const index = attempt.items.findIndex((item) => !item.answered);
  return index === -1 ? attempt.items.length : index;
}

export function QuizBankPractice({ onOpenAttempt }: { onOpenAttempt?: () => void }) {
  const [banks, setBanks] = useState<QuizBankStudentSummary[] | null>(null);
  const [attempt, setAttempt] = useState<QuizAttemptStateView | null>(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<QuizAttemptAnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmFresh, setConfirmFresh] = useState('');

  const loadBanks = useCallback(async () => {
    try {
      const data = await authedFetch<{ banks: QuizBankStudentSummary[] }>('/api/quiz/banks');
      setBanks(data.banks ?? []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '题集列表读取失败，请稍后重试。');
    }
  }, []);

  const openAttempt = useCallback(async (attemptId: string) => {
    try {
      const data = await authedFetch<BankStartResponse>(`/api/quiz/attempts/${attemptId}`);
      setAttempt(data.attempt);
      setCurrent(firstUnansweredIndex(data.attempt));
      setSelected(null);
      setResult(null);
      setError('');
      onOpenAttempt?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '练习记录读取失败。');
    }
  }, [onOpenAttempt]);

  const startAttempt = useCallback(async (bankId: string, fresh: boolean) => {
    setBusy(true);
    setError('');
    try {
      const data = await authedFetch<BankStartResponse>('/api/quiz/attempts', {
        method: 'POST',
        body: JSON.stringify({ bankId, fresh }),
      });
      setAttempt(data.attempt);
      setCurrent(firstUnansweredIndex(data.attempt));
      setSelected(null);
      setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '开始练习失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, []);

  // 初始加载：题集列表 + URL ?attempt= 深链（历史批次复盘/续答）；loadBanks/openAttempt
  // 内所有 setState 均在 await 之后（异步段），无同步级联渲染。
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    let active = true;
    // 初始加载与外部系统（服务端 API）同步属 effect 合法用途；loadBanks/openAttempt
    // 内所有 setState 均在 await 之后（异步段），无同步级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBanks();
    const attemptId = new URLSearchParams(window.location.search).get('attempt');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (attemptId) void openAttempt(attemptId);
    return () => { active = false; };
  }, [loadBanks, openAttempt]);

  const submit = async () => {
    if (!attempt || !selected || submitting) return;
    const item = attempt.items[current];
    setSubmitting(true);
    try {
      const data = await authedFetch<QuizAttemptAnswerResult>(`/api/quiz/attempts/${attempt.attemptId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ itemId: item.itemId, answer: selected }),
      });
      setResult(data);
      setAttempt((prev) => (prev
        ? {
            ...prev,
            status: data.completed ? 'completed' : prev.status,
            completedAt: data.completed ? new Date().toISOString() : prev.completedAt,
            items: prev.items.map((entry) => (entry.itemId === item.itemId
              ? { ...entry, answered: true, submittedAnswer: selected, isCorrect: data.correct ?? false, answer: data.answer ?? null, explanation: data.explanation ?? null }
              : entry)),
          }
        : prev));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!attempt) return;
    const remaining = attempt.items.findIndex((item, index) => index > current && !item.answered);
    if (remaining !== -1) {
      setCurrent(remaining);
      setSelected(null);
      setResult(null);
    } else {
      // 无剩余未作答题：刷新批次状态（服务端原子迁移 completed）
      void openAttempt(attempt.attemptId);
    }
  };

  const exitAttempt = () => {
    setAttempt(null);
    setCurrent(0);
    setSelected(null);
    setResult(null);
    void loadBanks();
    if (typeof window !== 'undefined' && window.location.search.includes('attempt=')) {
      window.history.replaceState(null, '', '/student/quiz');
    }
  };

  const answeredCount = attempt?.items.filter((item) => item.answered).length ?? 0;
  const correctCount = attempt?.items.filter((item) => item.isCorrect === true).length ?? 0;
  const wrongItems = attempt?.items.filter((item) => item.isCorrect === false) ?? [];
  const question = attempt?.items[current];
  const finished = attempt?.status === 'completed';
  const allAnswered = attempt ? answeredCount >= attempt.items.length : false;

  if (attempt && question && !allAnswered) {
    return (
      <section className="quiz-panel">
        <div className="quiz-meta">
          <span>第 {current + 1} / {attempt.items.length} 题 · 已答 {answeredCount} 题</span>
          <span data-difficulty={question.difficulty}>{DIFFICULTY_LABEL[question.difficulty]}</span>
        </div>
        <h2 className="quiz-stem">{question.stem}</h2>
        <div className="choice-list">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className="choice"
              data-selected={selected === option || undefined}
              data-correct={result ? (result.correct && selected === option) || result.answer === option || undefined : undefined}
              data-wrong={result ? (result.correct === false && selected === option) || undefined : undefined}
              disabled={Boolean(result) || submitting}
              onClick={() => setSelected(option)}
            >
              <strong>{option}</strong>
            </button>
          ))}
        </div>
        {result ? (
          <>
            <p className="quiz-verdict" data-correct={result.correct ? 'true' : 'false'}>
              {result.correct ? <CircleCheck /> : <CircleX />}
              {result.correct ? '回答正确' : '回答不正确'}
              {result.alreadyAnswered ? '（本题此前已作答，展示首次结果）' : ''}
            </p>
            <div className="feedback"><strong>正确答案：{result.answer}</strong><p>{result.explanation}</p></div>
            <button className="btn btn-primary" type="button" onClick={next}>下一题</button>
          </>
        ) : (
          <button className="btn btn-primary" type="button" disabled={!selected || submitting} onClick={() => void submit()}>
            {submitting ? '提交中…' : '提交答案'}
          </button>
        )}
        <div className="quiz-toolbar">
          <button className="btn btn-quiet" type="button" onClick={exitAttempt}>返回题集列表</button>
        </div>
      </section>
    );
  }

  if (attempt && (finished || allAnswered)) {
    const rate = attempt.items.length ? Math.round((correctCount / attempt.items.length) * 100) : 0;
    return (
      <section className="quiz-panel">
        <div className="quiz-meta"><span>练习完成</span><span data-correct="true">正确率 {rate}%</span></div>
        <h2 className="quiz-stem">本轮 {attempt.items.length} 题 · 答对 {correctCount} 题 · 答错 {wrongItems.length} 题</h2>
        {wrongItems.length > 0 ? (
          <>
            <p className="page-lead">错题复盘：以下题目建议结合解析巩固。</p>
            <div className="quiz-review-list">
              {wrongItems.map((item) => (
                <article key={item.itemId} className="quiz-review-item" data-correct="false">
                  <div className="quiz-meta">
                    <span>{DIFFICULTY_LABEL[item.difficulty]}{item.knowledgePoint ? ` · ${item.knowledgePoint}` : ''}</span>
                    <span data-correct="false">已答错</span>
                  </div>
                  <h3>{item.stem}</h3>
                  {item.submittedAnswer && <p className="quiz-submitted">你的作答：{item.submittedAnswer}</p>}
                  <div className="feedback"><strong>正确答案：{item.answer}</strong><p>{item.explanation}</p></div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="page-lead">本轮全部答对，继续保持。</p>
        )}
        <div className="quiz-toolbar">
          <button className="btn btn-primary" type="button" onClick={exitAttempt}>返回题集列表</button>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void startAttempt(attempt.bankId, true)}>再练一轮</button>
        </div>
      </section>
    );
  }

  if (attempt && !question && !allAnswered) {
    return <div className="empty-state" role="status"><p>正在读取练习内容…</p></div>;
  }

  return (
    <>
      <div className="quiz-toolbar">
        <button className="btn btn-secondary" type="button" onClick={() => void loadBanks()}><RefreshCw size={14} /> 刷新题集</button>
      </div>
      {error && <div className="empty-state" role="alert"><p>{error}</p><button className="btn btn-primary" type="button" onClick={() => void loadBanks()}>重试</button></div>}
      {!banks && !error && <div className="empty-state" role="status"><p>正在读取题集列表…</p></div>}
      {banks && banks.length === 0 && !error && (
        <div className="empty-state"><BookOpenCheck /><p>暂无可用题集。老师发布的题集会出现在这里；也可以先用「单题速练」。</p></div>
      )}
      {banks && banks.length > 0 && (
        <div className="quiz-review-list">
          {banks.map((bank) => {
            const rate = bank.bestCorrectRate === null ? null : Math.round(bank.bestCorrectRate * 100);
            return (
              <article key={bank.bankId} className="quiz-review-item">
                <div className="quiz-meta">
                  <span>{bank.topic || '综合练习'} · {bank.itemCount} 题 · v{bank.version}{bank.platformWide ? ' · 全平台' : ''}</span>
                  {bank.inProgressAttemptId ? <span>进行中</span> : bank.completedAttempts > 0 ? <span data-correct="true">已完成 {bank.completedAttempts} 轮{rate !== null ? ` · 最佳 ${rate}%` : ''}</span> : <span>未开始</span>}
                </div>
                <h3>{bank.title}</h3>
                {bank.description && <p className="quiz-submitted">{bank.description}</p>}
                <small style={{ display: 'block', marginTop: 6, color: 'var(--muted, #697b78)' }}>更新于 {formatDateTime(bank.updatedAt)}</small>
                <div className="quiz-toolbar" style={{ marginTop: 10 }}>
                  {bank.inProgressAttemptId ? (
                    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void openAttempt(bank.inProgressAttemptId ?? '')}>继续练习</button>
                  ) : (
                    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void startAttempt(bank.bankId, false)}>开始练习</button>
                  )}
                  {bank.completedAttempts > 0 && (
                    confirmFresh === bank.bankId ? (
                      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { setConfirmFresh(''); void startAttempt(bank.bankId, true); }}>
                        确认重开新一轮
                      </button>
                    ) : (
                      <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setConfirmFresh(bank.bankId)}>再练一轮</button>
                    )
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
