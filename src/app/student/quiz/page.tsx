'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, CircleCheck, CircleX, ListChecks, RefreshCw } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';

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

type Phase = 'loading' | 'answering' | 'reviewing' | 'error';

const DIFFICULTY_LABEL: Record<QuizQuestion['difficulty'], string> = { easy: '易', medium: '中', hard: '难' };

export default function QuizPage() {
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
    // 注：同步 setState 移至异步段（fetch 返回后），避免 effect 内同步置位触发级联渲染。
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

  // 初始取题：与外部系统（服务端 API）同步属 effect 合法用途；
  // loadQuestions 内所有 setState 均在 await 之后（异步段），无同步级联渲染。
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
      <p className="eyebrow">题库训练</p>
      <h1 className="page-title">儿科单题速练</h1>
      <p className="page-lead">题目随机分发、作答即判分；首次提交结果即锁定，解析在作答后展开，可在「错题复盘」中回顾历史记录。</p>

      <div className="quiz-toolbar">
        <button className="btn btn-secondary" type="button" onClick={() => void loadQuestions()}><RefreshCw size={14} /> 换一批题</button>
        <button className="btn btn-quiet" type="button" onClick={() => void loadReview()}><ListChecks size={14} /> 错题复盘{answeredCount > 0 ? `（${answeredCount} 已答 / ${wrongCount} 错）` : ''}</button>
      </div>

      {phase === 'loading' && <div className="empty-state"><p>正在加载…</p></div>}

      {phase === 'error' && (
        <div className="empty-state"><p>{errorMessage}</p><button className="btn btn-primary" type="button" onClick={() => void loadQuestions()}>重试</button></div>
      )}

      {phase === 'answering' && poolExhausted && questions.length === 0 && (
        <div className="empty-state"><BookOpenCheck /><p>题池已取完：你已完成当前全部可用题目。可进入「错题复盘」巩固，或等待教师扩充题库。</p></div>
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
