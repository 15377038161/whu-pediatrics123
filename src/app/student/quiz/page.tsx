'use client';

/**
 * 学生题库页（阶段 F / AI 题库闭环）：
 * - 题集练习（默认）：教师发布题集 → attempt 重练/续答/错题复盘（QuizBankPractice）；
 * - 单题速练（legacy）：既有 43 题随机分发链路原样保留，与题集体系互不影响；
 * - 两模式共用页面入口，学生可自由切换。
 */

import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, CircleCheck, CircleX, ListChecks, RefreshCw } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import { QuizBankPractice } from '@/components/quiz-bank-practice';

interface QuizQuestion {
  id: string;
  caseId: string;
  stem: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

interface AnswerResult {
  correct?: boolean;
  answer?: string;
  explanation?: string;
  alreadyAnswered?: boolean;
  submittedAnswer?: string;
}

interface ReviewItem extends QuizQuestion {
  submittedAnswer: string | null;
  isCorrect: boolean | null;
  answeredAt: string | null;
  answer: string | null;
  explanation: string | null;
}

type Mode = 'banks' | 'classic';
type Phase = 'loading' | 'answering' | 'reviewing' | 'error';

const DIFFICULTY_LABEL: Record<QuizQuestion['difficulty'], string> = { easy: '易', medium: '中', hard: '难' };

/** 单题速练（legacy 43 题）：取题/判分/复盘链路原样保留。 */
function QuizQuickPractice() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [poolExhausted, setPoolExhausted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const loadQuestions = useCallback(async () => {
    try {
      const data = await authedFetch<{ questions: QuizQuestion[]; poolExhausted: boolean }>('/api/quiz/questions?count=5');
      setResult(null);
      setSelected(null);
      setQuestions(data.questions ?? []);
      setPoolExhausted(Boolean(data.poolExhausted));
      setCurrent(0);
      setPhase('answering');
    } catch (e) {
      setErrorMessage((e as Error).message || '取题失败，请稍后重试。');
      setPhase('error');
    }
  }, []);

  const loadReview = useCallback(async () => {
    try {
      const data = await authedFetch<{ records: ReviewItem[] }>('/api/quiz/review');
      setReview(data.records ?? []);
      setPhase('reviewing');
    } catch (e) {
      setErrorMessage((e as Error).message || '复盘记录读取失败。');
      setPhase('error');
    }
  }, []);

  // 初始取题：与外部系统（服务端 API）同步属 effect 合法用途；loadQuestions 内所有
  // setState 均在 await 之后（异步段），无同步级联渲染（与旧版题库页同模式）。
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadQuestions(); }, [loadQuestions]);

  const submit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      const data = await authedFetch<AnswerResult>('/api/quiz/answer', {
        method: 'POST',
        body: JSON.stringify({ questionId: questions[current].id, answer: selected }),
      });
      setResult(data);
    } catch (e) {
      setErrorMessage((e as Error).message || '提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (current + 1 < questions.length) {
      setCurrent(current + 1);
      setSelected(null);
      setResult(null);
    } else {
      void loadQuestions();
    }
  };

  const answeredCount = review.filter((item) => item.answeredAt !== null).length;
  const wrongCount = review.filter((item) => item.isCorrect === false).length;
  const question = questions[current];

  return (
    <>
      <div className="quiz-toolbar">
        <button className="btn btn-secondary" type="button" onClick={() => void loadQuestions()}><RefreshCw size={14} /> 换一批题</button>
        <button className="btn btn-quiet" type="button" onClick={() => void loadReview()}><ListChecks size={14} /> 错题复盘{answeredCount > 0 ? `（${answeredCount} 已答 / ${wrongCount} 错）` : ''}</button>
      </div>

      {phase === 'loading' && <div className="empty-state"><p>正在加载…</p></div>}

      {phase === 'error' && (
        <div className="empty-state"><p>{errorMessage}</p><button className="btn btn-primary" type="button" onClick={() => void loadQuestions()}>重试</button></div>
      )}

      {phase === 'answering' && poolExhausted && questions.length === 0 && (
        <div className="empty-state"><BookOpenCheck /><p>题池已取完：你已完成当前全部可用题目。可回到「题集练习」继续，或在「错题复盘」中巩固。</p></div>
      )}

      {phase === 'answering' && question && (
        <section className="quiz-panel">
          <div className="quiz-meta">
            <span>第 {current + 1} / {questions.length} 题</span>
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
              <button className="btn btn-primary" type="button" onClick={next}>{current + 1 < questions.length ? '下一题' : '再来一批'}</button>
            </>
          ) : (
            <button className="btn btn-primary" type="button" disabled={!selected || submitting} onClick={() => void submit()}>
              {submitting ? '提交中…' : '提交答案'}
            </button>
          )}
        </section>
      )}

      {phase === 'reviewing' && (
        <section className="quiz-panel">
          <h2 className="quiz-stem">错题复盘（共 {answeredCount} 已答 / {wrongCount} 错）</h2>
          {review.length === 0 && <div className="empty-state"><p>暂无作答记录，先做一批题吧。</p></div>}
          <div className="quiz-review-list">
            {review.map((item) => (
              <article key={item.id} className="quiz-review-item" data-correct={item.isCorrect === true ? 'true' : item.isCorrect === false ? 'false' : undefined}>
                <div className="quiz-meta">
                  <span>{DIFFICULTY_LABEL[item.difficulty]} · {item.caseId}</span>
                  {item.answeredAt === null ? <span>未作答</span> : item.isCorrect ? <span data-correct="true">已答对</span> : <span data-correct="false">已答错</span>}
                </div>
                <h3>{item.stem}</h3>
                {item.submittedAnswer && <p className="quiz-submitted">你的作答：{item.submittedAnswer}</p>}
                {item.answer && <div className="feedback"><strong>正确答案：{item.answer}</strong><p>{item.explanation}</p></div>}
              </article>
            ))}
          </div>
          <button className="btn btn-primary" type="button" onClick={() => void loadQuestions()}>继续答题</button>
        </section>
      )}
    </>
  );
}

export default function QuizPage() {
  const [mode, setMode] = useState<Mode>('banks');

  return (
    <>
      <p className="eyebrow">题库训练</p>
      <h1 className="page-title">儿科题库练习</h1>
      <p className="page-lead">
        {mode === 'banks'
          ? '练习老师发布的题集：按冻结版本作答，首次提交结果即锁定，解析在作答后展开；支持中断续答、重练与错题复盘。'
          : '经典单题速练：题目随机分发、作答即判分；首次提交结果即锁定，解析在作答后展开。'}
      </p>

      <div className="quiz-toolbar" role="tablist" aria-label="练习模式">
        <button
          type="button"
          className="btn btn-secondary"
          role="tab"
          aria-selected={mode === 'banks'}
          data-active={mode === 'banks' || undefined}
          onClick={() => setMode('banks')}
        >
          <BookOpenCheck size={14} /> 题集练习
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          role="tab"
          aria-selected={mode === 'classic'}
          data-active={mode === 'classic' || undefined}
          onClick={() => setMode('classic')}
        >
          <ListChecks size={14} /> 单题速练
        </button>
      </div>

      {mode === 'banks' ? <QuizBankPractice /> : <QuizQuickPractice />}
    </>
  );
}
