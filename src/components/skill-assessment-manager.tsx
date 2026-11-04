'use client';


/**
 * 批次8·教师手机现场考核评分组件（移动优先）。
 *
 * 三视图：考核列表 → 新建草稿 → 逐项打分（三档 + 未观察）+ 发布/撤回/补考。
 * 口径（2026-10-30 澄清确认）：
 * - 评分项内置统一（skill_rubric_items 种子，教师不可增删），保证全班口径一致；
 * - 逐项三档（2 达标 / 1 部分达标 / 0 未达标），NULL=未观察不计分；
 * - 总分 = 得分和 / 计分项满分 × 100（前端实时预览与发布 RPC 同口径）；
 * - 发布制：草稿可反复保存，发布后学生才可见；撤回纠错、补考留痕（retake_of 关联）。
 */


import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Plus, RefreshCw, Send, Undo2, RotateCcw } from 'lucide-react';
import { authedFetch, authedFetchRaw } from '@/lib/authed-api';
import { ASSESSMENT_SCORE_LEVELS, computeSkillAssessmentTotal } from '@/domain/skill-assessment';
import type { SkillCatalogItem } from '@/domain/skill-learning';
import type { SkillAssessmentDetail, SkillAssessmentListItem } from '@/lib/skill-assessment';
import styles from './skill-assessment-manager.module.css';


type ScoreValue = 0 | 1 | 2 | null;

interface StudentOption {
  id: string;
  displayName: string;
}

interface AssessmentItem extends SkillAssessmentListItem {
  studentName: string;
}

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'scoring'; assessmentId: string };


function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function levelLabel(score: ScoreValue): string {
  if (score === null) return '未观察';
  return ASSESSMENT_SCORE_LEVELS[score];
}

const SCORE_OPTIONS: readonly ScoreValue[] = [2, 1, 0, null];


export function SkillAssessmentManager() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);

  // 新建表单
  const [studentId, setStudentId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [assessmentAt, setAssessmentAt] = useState('');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);

  // 评分视图
  const [detail, setDetail] = useState<SkillAssessmentDetail | null>(null);
  const [studentName, setStudentName] = useState('');
  const [scores, setScores] = useState<Record<string, ScoreValue>>({});
  const [scoringNote, setScoringNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState('');


  const refreshList = useCallback(async () => {
    try {
      const res = await authedFetch<{ assessments: AssessmentItem[] }>('/api/teacher/skill-assessments');
      setAssessments(res.assessments ?? []);
    } catch {
      // 列表静默刷新失败不阻塞当前操作
    }
  }, []);


  const exportCsv = useCallback(async () => {
    setActionBusy('export');
    setErrorMessage('');
    try {
      const response = await authedFetchRaw('/api/teacher/skill-assessments/export');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      anchor.href = objectUrl;
      anchor.download = `现场考核_${stamp}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setErrorMessage((e as Error).message || '导出失败，请稍后重试。');
    } finally {
      setActionBusy('');
    }
  }, []);


  const load = useCallback(async () => {
    setPhase('loading');
    setErrorMessage('');
    try {
      const [list, ws, cat] = await Promise.all([
        authedFetch<{ assessments: AssessmentItem[] }>('/api/teacher/skill-assessments'),
        authedFetch<{ students: StudentOption[] }>('/api/teacher/students'),
        authedFetch<{ skills: SkillCatalogItem[] }>('/api/skills'),
      ]);
      setAssessments(list.assessments ?? []);
      setStudents(ws.students ?? []);
      setSkills(cat.skills ?? []);
      setPhase('ready');
    } catch (e) {
      setErrorMessage((e as Error).message || '加载失败，请稍后重试。');
      setPhase('error');
    }
  }, []);


  // 初始加载：setState 均在异步回调中执行
  useEffect(() => {
    let active = true;
    Promise.all([
      authedFetch<{ assessments: AssessmentItem[] }>('/api/teacher/skill-assessments'),
      authedFetch<{ students: StudentOption[] }>('/api/teacher/students'),
      authedFetch<{ skills: SkillCatalogItem[] }>('/api/skills'),
    ])
      .then(([list, ws, cat]) => {
        if (!active) return;
        setAssessments(list.assessments ?? []);
        setStudents(ws.students ?? []);
        setSkills(cat.skills ?? []);
        setPhase('ready');
      })
      .catch((e) => {
        if (!active) return;
        setErrorMessage((e as Error).message || '加载失败，请稍后重试。');
        setPhase('error');
      });
    return () => { active = false; };
  }, []);


  const openScoring = useCallback(async (assessmentId: string) => {
    setErrorMessage('');
    try {
      const res = await authedFetch<{ assessment: SkillAssessmentDetail & { studentName: string } }>(
        `/api/teacher/skill-assessments/${assessmentId}`,
      );
      const a = res.assessment;
      setDetail(a);
      setStudentName(a.studentName);
      const map: Record<string, ScoreValue> = {};
      for (const item of a.rubric) map[item.itemKey] = null;
      for (const entry of a.scores) map[entry.itemKey] = entry.score;
      setScores(map);
      setScoringNote(a.note ?? '');
      setView({ kind: 'scoring', assessmentId });
    } catch (e) {
      setErrorMessage((e as Error).message || '考核详情加载失败。');
    }
  }, []);


  const saveDraft = useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    setErrorMessage('');
    try {
      const items = detail.rubric.map((r) => ({ itemKey: r.itemKey, score: scores[r.itemKey] ?? null }));
      await authedFetch(`/api/teacher/skill-assessments/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ items, note: scoringNote }),
      });
      await openScoring(detail.id);
    } catch (e) {
      setErrorMessage((e as Error).message || '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [detail, scores, scoringNote, openScoring]);


  const publish = useCallback(async () => {
    if (!detail) return;
    const total = computeSkillAssessmentTotal(detail.rubric.map((r) => scores[r.itemKey] ?? null));
    if (total === null) {
      setErrorMessage('请至少完成 1 项计分观察（达标/部分达标/未达标）后再发布。');
      return;
    }
    if (!window.confirm(`发布后学生即可查看成绩（当前总分 ${total.toFixed(2)}），确认发布？`)) return;
    setActionBusy('publish');
    setErrorMessage('');
    try {
      await authedFetch(`/api/teacher/skill-assessments/${detail.id}/publish`, { method: 'POST' });
      await openScoring(detail.id);
      await refreshList();
    } catch (e) {
      setErrorMessage((e as Error).message || '发布失败，请稍后重试。');
    } finally {
      setActionBusy('');
    }
  }, [detail, scores, openScoring, refreshList]);


  const retract = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm('撤回发布后学生将无法查看该成绩，确认撤回？')) return;
    setActionBusy('retract');
    setErrorMessage('');
    try {
      await authedFetch(`/api/teacher/skill-assessments/${detail.id}/retract`, { method: 'POST' });
      await openScoring(detail.id);
      await refreshList();
    } catch (e) {
      setErrorMessage((e as Error).message || '撤回失败，请稍后重试。');
    } finally {
      setActionBusy('');
    }
  }, [detail, openScoring, refreshList]);


  const retake = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm('补考将创建一条新考核记录（原成绩保留），需重新打分并发布。确认创建？')) return;
    setActionBusy('retake');
    setErrorMessage('');
    try {
      const res = await authedFetch<{ assessment: { id: string } }>(
        `/api/teacher/skill-assessments/${detail.id}/retake`,
        { method: 'POST' },
      );
      await openScoring(res.assessment.id);
      await refreshList();
    } catch (e) {
      setErrorMessage((e as Error).message || '补考创建失败，请稍后重试。');
    } finally {
      setActionBusy('');
    }
  }, [detail, openScoring, refreshList]);


  const create = useCallback(async () => {
    if (!studentId || !skillId) {
      setErrorMessage('请选择学生与技能。');
      return;
    }
    setCreating(true);
    setErrorMessage('');
    try {
      const clientEventId = crypto.randomUUID();
      const res = await authedFetch<{ assessment: { id: string } }>('/api/teacher/skill-assessments', {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          skillId,
          assessmentAt: assessmentAt || undefined,
          note: note.trim() || undefined,
          clientEventId,
        }),
      });
      await openScoring(res.assessment.id);
      await refreshList();
    } catch (e) {
      setErrorMessage((e as Error).message || '创建失败，请稍后重试。');
    } finally {
      setCreating(false);
    }
  }, [studentId, skillId, assessmentAt, note, openScoring, refreshList]);


  if (phase === 'loading') return <div className="empty-state"><p>正在加载…</p></div>;
  if (phase === 'error') {
    return (
      <div className="empty-state" role="alert">
        <p>{errorMessage}</p>
        <button className="btn btn-primary" type="button" onClick={() => void load()}>重试</button>
      </div>
    );
  }


  const publishedDetail = detail?.status === 'published';
  const previewTotal = detail
    ? computeSkillAssessmentTotal(detail.rubric.map((r) => scores[r.itemKey] ?? null))
    : null;


  return (
    <div className={styles.wrap}>
      {errorMessage ? <p className={styles.errorBar} role="alert">{errorMessage}</p> : null}

      {view.kind === 'list' ? (
        <section aria-label="现场考核列表">
          <div className={styles.listHead}>
            <div>
              <h1 className={styles.pageTitle}>现场考核评分</h1>
              <p className={styles.pageLead}>内置统一评分项，逐项三档打分（未观察不计分）；发布后学生可查看成绩。</p>
            </div>
            <div className={styles.headActions}>
              <button className="btn btn-quiet" type="button" onClick={() => void exportCsv()} disabled={actionBusy === 'export'}>
                <Download size={15} /> {actionBusy === 'export' ? '正在导出…' : '导出 CSV'}
              </button>
              <button className="btn btn-primary" type="button" onClick={() => { setErrorMessage(''); setAssessmentAt(nowLocalInputValue()); setView({ kind: 'create' }); }}>
                <Plus size={15} /> 新建考核
              </button>
            </div>
          </div>

          {assessments.length === 0 ? (
            <div className="empty-state"><p>暂无现场考核记录；点击「新建考核」开始第一次评分。</p></div>
          ) : (
            <div className={styles.cardList}>
              {assessments.map((a) => (
                <button key={a.id} type="button" className={styles.card} onClick={() => void openScoring(a.id)}>
                  <div className={styles.cardTop}>
                    <span className={styles.studentName}>{a.studentName}</span>
                    <span className={styles.statusChip} data-status={a.status}>{a.status === 'published' ? '已发布' : '草稿'}</span>
                  </div>
                  <p className={styles.cardMeta}>{a.skillTitle} · {formatDateTime(a.assessmentAt)}</p>
                  <div className={styles.cardBottom}>
                    <span className={styles.progressText}>
                      评分 {a.scoredCount}/{a.rubricItemCount}
                      {a.retakeOf ? <em className={styles.retakeChip}>补考</em> : null}
                    </span>
                    {a.status === 'published' && a.totalScore !== null ? (
                      <strong className={styles.totalText}>{a.totalScore.toFixed(2)} 分</strong>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view.kind === 'create' ? (
        <section aria-label="新建现场考核" className={styles.formSection}>
          <button className="btn btn-quiet" type="button" onClick={() => setView({ kind: 'list' })}>
            <ArrowLeft size={14} /> 返回列表
          </button>
          <h2 className={styles.sectionTitle}>新建现场考核</h2>
          <label className={styles.field}>
            <span>学生（本班）</span>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">请选择学生</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>考核技能</span>
            <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
              <option value="">请选择技能</option>
              {skills.map((s) => <option key={s.skillId} value={s.skillId}>{s.title}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>考核时间</span>
            <input type="datetime-local" value={assessmentAt} onChange={(e) => setAssessmentAt(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>备注（选填）</span>
            <textarea
              value={note}
              maxLength={500}
              rows={3}
              placeholder="现场观察补充说明（500 字以内）"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="button" disabled={creating} onClick={() => void create()}>
            {creating ? '正在创建…' : '创建并开始评分'}
          </button>
        </section>
      ) : null}

      {view.kind === 'scoring' && detail ? (
        <section aria-label="考核评分" className={styles.formSection}>
          <button className="btn btn-quiet" type="button" onClick={() => { setDetail(null); setView({ kind: 'list' }); }}>
            <ArrowLeft size={14} /> 返回列表
          </button>

          <div className={styles.scoringHead}>
            <div>
              <h2 className={styles.sectionTitle}>{studentName} · {detail.skillTitle}</h2>
              <p className={styles.cardMeta}>考核时间 {formatDateTime(detail.assessmentAt)}</p>
            </div>
            <span className={styles.statusChip} data-status={detail.status}>{detail.status === 'published' ? '已发布' : '草稿'}</span>
          </div>

          <div className={styles.previewBar}>
            <span>总分预览（未观察不计分）</span>
            <strong data-empty={previewTotal === null}>{previewTotal === null ? '--' : previewTotal.toFixed(2)}</strong>
          </div>

          <div className={styles.rubricList}>
            {detail.rubric.map((item) => {
              const current = scores[item.itemKey] ?? null;
              return (
                <div key={item.itemKey} className={styles.rubricItem}>
                  <p className={styles.rubricLabel}>{item.sortOrder}. {item.itemLabel}</p>
                  <div className={styles.scoreRow} role="radiogroup" aria-label={item.itemLabel}>
                    {SCORE_OPTIONS.map((level) => (
                      <button
                        key={String(level)}
                        type="button"
                        className={styles.scoreBtn}
                        data-level={String(level)}
                        data-active={current === level}
                        disabled={publishedDetail || actionBusy !== ''}
                        onClick={() => setScores((prev) => ({ ...prev, [item.itemKey]: level }))}
                      >
                        {levelLabel(level)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <label className={styles.field}>
            <span>备注（选填）</span>
            <textarea
              value={scoringNote}
              maxLength={500}
              rows={3}
              disabled={publishedDetail}
              placeholder="现场观察补充说明（500 字以内）"
              onChange={(e) => setScoringNote(e.target.value)}
            />
          </label>

          {detail.status === 'draft' ? (
            <div className={styles.actionRow}>
              <button className="btn btn-secondary" type="button" disabled={saving || actionBusy !== ''} onClick={() => void saveDraft()}>
                {saving ? '正在保存…' : '保存草稿'}
              </button>
              <button className="btn btn-primary" type="button" disabled={actionBusy !== ''} onClick={() => void publish()}>
                <Send size={14} /> {actionBusy === 'publish' ? '正在发布…' : '发布成绩'}
              </button>
            </div>
          ) : (
            <div className={styles.actionRow}>
              <button className="btn btn-secondary" type="button" disabled={actionBusy !== ''} onClick={() => void retract()}>
                <Undo2 size={14} /> {actionBusy === 'retract' ? '正在撤回…' : '撤回发布'}
              </button>
              <button className="btn btn-primary" type="button" disabled={actionBusy !== ''} onClick={() => void retake()}>
                <RotateCcw size={14} /> {actionBusy === 'retake' ? '正在创建…' : '发起补考'}
              </button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
