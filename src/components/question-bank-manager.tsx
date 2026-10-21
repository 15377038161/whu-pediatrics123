'use client';

/**
 * 教师题集管理面板（阶段 F / AI 题库闭环）：
 * - 题集工作流：新建草稿 → AI 生成草稿题目 → 逐题审核/编辑 → 发布（版本冻结）→ 下架/修订再发布；
 * - 权限：普通教师仅管理本人题集（RLS），platform 全平台发布仅项目管理员可选（服务端 RPC 强制）；
 * - AI 生成幂等：同一批次 requestId 重复提交返回既有草稿，不重复消耗生成调用；
 * - 已发布版本的题目以冻结快照为准：此处编辑仅影响下一次发布，不影响进行中与已完成练习。
 */

import { useCallback, useEffect, useState } from 'react';
import { LibraryBig, RefreshCw, Sparkles } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import { formatDateTime } from '@/lib/format-date';
import type { BankStatus, BankVisibility, QuestionBankDetail, QuestionBankItemRecord, QuestionBankSummary } from '@/lib/question-bank';
import styles from './question-bank-manager.module.css';

const STATUS_LABEL: Record<BankStatus, string> = {
  draft: '草稿',
  ready_for_review: '待审核',
  published: '已发布',
  retired: '已下架',
};

const REVIEW_LABEL: Record<QuestionBankItemRecord['reviewStatus'], string> = {
  draft: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const DIFFICULTY_LABEL: Record<QuestionBankItemRecord['difficulty'], string> = {
  easy: '易',
  medium: '中',
  hard: '难',
};

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface BankListResponse {
  banks: QuestionBankSummary[];
  isAdmin: boolean;
}

interface GenerateResponse {
  items: QuestionBankItemRecord[];
  reused: boolean;
}

interface ItemEditState {
  stem: string;
  options: string;
  answer: string;
  explanation: string;
  knowledgePoint: string;
  difficulty: QuestionBankItemRecord['difficulty'];
}

function itemToEditState(item: QuestionBankItemRecord): ItemEditState {
  return {
    stem: item.stem,
    options: item.options.join('\n'),
    answer: item.answer,
    explanation: item.explanation,
    knowledgePoint: item.knowledgePoint ?? '',
    difficulty: item.difficulty,
  };
}

export function QuestionBankManager() {
  const [list, setList] = useState<QuestionBankSummary[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<QuestionBankDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDeleteBank, setConfirmDeleteBank] = useState(false);
  const [creating, setCreating] = useState({ title: '', topic: '', description: '' });
  const [generate, setGenerate] = useState({ topic: '', count: 5, difficulty: 'mixed', extraRequirements: '' });
  const [visibility, setVisibility] = useState<BankVisibility>('own_class');
  const [editingItemId, setEditingItemId] = useState('');
  const [editState, setEditState] = useState<ItemEditState | null>(null);

  const loadList = useCallback(async (): Promise<BankListResponse | null> => {
    try {
      const next = await authedFetch<BankListResponse>('/api/teacher/question-banks');
      setList(next.banks ?? []);
      setIsAdmin(Boolean(next.isAdmin));
      setError('');
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '题集列表读取失败');
      return null;
    }
  }, []);

  const loadDetail = useCallback(async (bankId: string): Promise<QuestionBankDetail | null> => {
    try {
      const next = await authedFetch<{ bank: QuestionBankDetail }>(`/api/teacher/question-banks/${bankId}`);
      setDetail(next.bank);
      setVisibility(next.bank.visibility);
      setError('');
      return next.bank;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '题集详情读取失败');
      return null;
    }
  }, []);

  // 初始列表加载：setState 均在异步 fetch 返回后执行
  useEffect(() => {
    let active = true;
    authedFetch<BankListResponse>('/api/teacher/question-banks')
      .then((next) => {
        if (!active) return;
        setList(next.banks ?? []);
        setIsAdmin(Boolean(next.isAdmin));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '题集列表读取失败');
      });
    return () => { active = false; };
  }, []);

  const selectBank = useCallback(async (bankId: string) => {
    setSelectedId(bankId);
    setDetail(null);
    setNotice('');
    setConfirmDeleteBank(false);
    setEditingItemId('');
    setEditState(null);
    await loadDetail(bankId);
  }, [loadDetail]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const createBank = () => void run(async () => {
    const created = await authedFetch<{ bank: QuestionBankSummary }>('/api/teacher/question-banks', {
      method: 'POST',
      body: JSON.stringify({
        title: creating.title,
        topic: creating.topic || undefined,
        description: creating.description || undefined,
      }),
    });
    setCreating({ title: '', topic: '', description: '' });
    await loadList();
    await selectBank(created.bank.id);
    setNotice('题集已创建，可继续 AI 生成题目或手动录入。');
  });

  const patchBank = (patch: Record<string, unknown>, message: string) => void run(async () => {
    if (!selectedId) return;
    await authedFetch(`/api/teacher/question-banks/${selectedId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await Promise.all([loadList(), loadDetail(selectedId)]);
    setNotice(message);
  });

  const deleteBank = () => void run(async () => {
    if (!selectedId) return;
    await authedFetch(`/api/teacher/question-banks/${selectedId}`, { method: 'DELETE' });
    setSelectedId('');
    setDetail(null);
    setConfirmDeleteBank(false);
    await loadList();
    setNotice('题集已删除。');
  });

  const generateItems = () => void run(async () => {
    if (!selectedId) return;
    const result = await authedFetch<GenerateResponse>(`/api/teacher/question-banks/${selectedId}/generate`, {
      method: 'POST',
      body: JSON.stringify({
        topic: generate.topic,
        count: generate.count,
        difficulty: generate.difficulty,
        extraRequirements: generate.extraRequirements || undefined,
        requestId: newRequestId(),
      }),
    });
    await Promise.all([loadList(), loadDetail(selectedId)]);
    setNotice(result.reused
      ? '该批次请求已生成过题目，已为你载入既有草稿（未重复生成）。'
      : `AI 已生成 ${result.items.length} 道草稿题目，请逐题审核；审核通过后才能发布。`);
  });

  const patchItem = (itemId: string, patch: Record<string, unknown>, message: string) => void run(async () => {
    if (!selectedId) return;
    await authedFetch(`/api/teacher/question-banks/${selectedId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    await Promise.all([loadList(), loadDetail(selectedId)]);
    setNotice(message);
  });

  const deleteItem = (itemId: string) => void run(async () => {
    if (!selectedId) return;
    await authedFetch(`/api/teacher/question-banks/${selectedId}/items/${itemId}`, { method: 'DELETE' });
    await Promise.all([loadList(), loadDetail(selectedId)]);
    setNotice('题目已删除（不影响已发布版本与进行中练习）。');
  });

  const saveItemEdit = () => void run(async () => {
    if (!selectedId || !editState) return;
    const options = editState.options.split('\n').map((option) => option.trim()).filter(Boolean);
    await patchItemDirect(selectedId, editingItemId, {
      stem: editState.stem,
      options,
      answer: editState.answer,
      explanation: editState.explanation,
      knowledgePoint: editState.knowledgePoint || null,
      difficulty: editState.difficulty,
    });
    setEditingItemId('');
    setEditState(null);
    await Promise.all([loadList(), loadDetail(selectedId)]);
    setNotice('题目已保存（修改仅影响下一次发布）。');
  });

  async function patchItemDirect(bankId: string, itemId: string, patch: Record<string, unknown>): Promise<void> {
    await authedFetch(`/api/teacher/question-banks/${bankId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const publishBank = () => void run(async () => {
    if (!selectedId) return;
    const result = await authedFetch<{ publish: { version: number; itemCount: number } }>(
      `/api/teacher/question-banks/${selectedId}/publish`,
      { method: 'POST', body: JSON.stringify({ visibility }) },
    );
    await Promise.all([loadList(), loadDetail(selectedId)]);
    setNotice(`已发布第 ${result.publish.version} 版（${result.publish.itemCount} 题），学生现在可以开始练习。`);
  });

  const approvedCount = detail?.items.filter((item) => item.reviewStatus === 'approved').length ?? 0;
  const canPublish = approvedCount >= 1;

  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">教学资料 · AI 题库</p>
          <h1 className="page-title">题集管理</h1>
          <p className="page-lead">
            AI 生成题目草稿 → 逐题审核与编辑 → 发布为版本快照（学生按冻结版本作答）→ 下架或修订再发布。普通教师发布的题集面向本人班级学生；全平台发布仅项目管理员可设置。
          </p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => void loadList()}>
          <RefreshCw size={14} style={{ verticalAlign: -2 }} /> 刷新
        </button>
      </header>

      {error && <div className={styles.feedback} role="alert">
        {error} <button type="button" className="btn btn-quiet" onClick={() => void loadList()}>重试</button>
      </div>}
      {notice && <p className={styles.feedback} role="status">{notice}</p>}

      <form className={styles.create} onSubmit={(event) => { event.preventDefault(); createBank(); }}>
        <label>
          新建题集标题
          <input
            required
            minLength={2}
            maxLength={120}
            value={creating.title}
            disabled={busy}
            placeholder="例如：新生儿黄疸专题"
            onChange={(event) => setCreating((prev) => ({ ...prev, title: event.target.value }))}
          />
        </label>
        <label>
          主题（可选）
          <input
            maxLength={120}
            value={creating.topic}
            disabled={busy}
            placeholder="例如：新生儿高胆红素血症"
            onChange={(event) => setCreating((prev) => ({ ...prev, topic: event.target.value }))}
          />
        </label>
        <label>
          说明（可选）
          <input
            maxLength={600}
            value={creating.description}
            disabled={busy}
            placeholder="面向哪类学生、练习目标"
            onChange={(event) => setCreating((prev) => ({ ...prev, description: event.target.value }))}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || creating.title.trim().length < 2}>
          <LibraryBig size={14} /> 创建题集
        </button>
      </form>

      {!list && !error && <p role="status">正在读取题集列表…</p>}
      {list && list.length === 0 && (
        <section className={styles.card}>
          还没有题集。先创建一个题集，再用 AI 生成题目草稿；也可以直接发布后让学生练习。
        </section>
      )}

      {list && list.length > 0 && (
        <div className={styles.grid}>
          {list.map((bank) => (
            <button
              type="button"
              key={bank.id}
              className={styles.bankCard}
              aria-pressed={selectedId === bank.id}
              disabled={busy}
              onClick={() => void selectBank(bank.id)}
            >
              <strong>{bank.title}</strong>
              <span className={styles.badge} data-status={bank.status}>{STATUS_LABEL[bank.status]}{bank.visibility === 'platform' ? ' · 全平台' : ''}</span>
              <small>
                {bank.itemCount} 题 · 已审核 {bank.approvedCount} 题
                {bank.publishedVersion ? ` · 已发布 v${bank.publishedVersion}` : ''}
              </small>
              <small>{bank.topic || '未设主题'} · 更新于 {formatDateTime(bank.updatedAt)}</small>
            </button>
          ))}
        </div>
      )}

      {selectedId && !detail && <p role="status">正在读取题集详情…</p>}

      {detail && (
        <section className={styles.card}>
          <div className={styles.actions}>
            <h2>{detail.title}</h2>
            <span className={styles.badge} data-status={detail.status}>{STATUS_LABEL[detail.status]}</span>
          </div>
          <p>
            {detail.description || '暂无说明'}
            {detail.topic ? ` · 主题：${detail.topic}` : ''}
          </p>

          <div className={styles.actions}>
            {detail.status === 'draft' && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => patchBank({ status: 'ready_for_review' }, '题集已标记为待审核。')}>
                标记待审核
              </button>
            )}
            {detail.status === 'ready_for_review' && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => patchBank({ status: 'draft' }, '题集已退回草稿。')}>
                退回草稿
              </button>
            )}
            {(detail.status === 'draft' || detail.status === 'ready_for_review' || detail.status === 'published') && (
              <>
                <label className={styles.gap} style={{ minWidth: 150 }}>
                  发布范围
                  <select value={visibility} disabled={busy || (!isAdmin && detail.visibility !== 'platform')} onChange={(event) => setVisibility(event.target.value as BankVisibility)}>
                    <option value="own_class">本人班级</option>
                    <option value="platform" disabled={!isAdmin}>全平台（仅管理员）</option>
                  </select>
                </label>
                <button type="button" className="btn btn-primary" disabled={busy || !canPublish} onClick={publishBank}>
                  <Sparkles size={14} /> {detail.status === 'published' ? '发布新版本' : '发布题集'}
                </button>
                {!canPublish && <small>需先审核通过至少 1 题才能发布。</small>}
              </>
            )}
            {detail.status === 'published' && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => patchBank({ status: 'retired' }, '题集已下架：学生不再可见，已有练习记录保留。')}>
                下架
              </button>
            )}
            {detail.status === 'retired' && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => patchBank({ status: 'draft' }, '题集已恢复为草稿，可修订后再发布。')}>
                恢复为草稿
              </button>
            )}
            {!detail.currentVersionId && (
              confirmDeleteBank
                ? <button type="button" className="btn btn-primary" disabled={busy} onClick={deleteBank}>再次点击确认删除</button>
                : <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setConfirmDeleteBank(true)}>删除题集</button>
            )}
          </div>

          {detail.versions.length > 0 && (
            <div className={styles.table}>
              <table>
                <caption>版本历史（学生作答始终按其绑定版本判分）</caption>
                <thead><tr><th>版本</th><th>题目数</th><th>发布时间</th></tr></thead>
                <tbody>
                  {detail.versions.map((version) => (
                    <tr key={version.id}>
                      <td>v{version.version}{detail.currentVersionId === version.id ? '（当前）' : ''}</td>
                      <td>{version.itemCount}</td>
                      <td>{formatDateTime(version.publishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form
            className={styles.metaGrid}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget.elements;
              patchBank({
                title: (form.namedItem('title') as HTMLInputElement).value.trim(),
                topic: (form.namedItem('topic') as HTMLInputElement).value.trim() || null,
                description: (form.namedItem('description') as HTMLInputElement).value.trim() || null,
              }, '题集信息已更新。');
            }}
          >
            <label>标题<input name="title" required minLength={2} maxLength={120} defaultValue={detail.title} disabled={busy} /></label>
            <label>主题<input name="topic" maxLength={120} defaultValue={detail.topic ?? ''} disabled={busy} /></label>
            <label>说明<input name="description" maxLength={600} defaultValue={detail.description ?? ''} disabled={busy} /></label>
            <button type="submit" className="btn btn-secondary" disabled={busy}>保存信息</button>
          </form>

          <div className={styles.gap}>
            <h3>AI 生成题目草稿</h3>
            <p>生成结果为草稿（未审核不出现在发布版本中）；同一批次重复提交不会重复生成。生成后请逐题审核与编辑。</p>
            <form
              className={styles.metaGrid}
              onSubmit={(event) => { event.preventDefault(); generateItems(); }}
            >
              <label>命题主题<input required minLength={2} maxLength={120} value={generate.topic} disabled={busy} placeholder="例如：小儿肺炎的鉴别诊断" onChange={(event) => setGenerate((prev) => ({ ...prev, topic: event.target.value }))} /></label>
              <label>数量
                <select value={generate.count} disabled={busy} onChange={(event) => setGenerate((prev) => ({ ...prev, count: Number(event.target.value) }))}>
                  {[3, 4, 5, 6, 8, 10].map((count) => <option key={count} value={count}>{count} 题</option>)}
                </select>
              </label>
              <label>难度
                <select value={generate.difficulty} disabled={busy} onChange={(event) => setGenerate((prev) => ({ ...prev, difficulty: event.target.value }))}>
                  <option value="mixed">混合</option>
                  <option value="easy">易</option>
                  <option value="medium">中</option>
                  <option value="hard">难</option>
                </select>
              </label>
              <label>补充要求（可选）<input maxLength={400} value={generate.extraRequirements} disabled={busy} placeholder="例如：侧重辅助检查判读" onChange={(event) => setGenerate((prev) => ({ ...prev, extraRequirements: event.target.value }))} /></label>
              <button type="submit" className="btn btn-primary" disabled={busy || generate.topic.trim().length < 2}>
                <Sparkles size={14} /> 生成草稿题目
              </button>
            </form>
          </div>

          <div className={styles.gap}>
            <h3>题目条目（{detail.items.length} 题 · 已审核通过 {detail.items.filter((item) => item.reviewStatus === 'approved').length} 题）</h3>
            {!detail.items.length && <p>暂无题目。使用上方 AI 生成，或等待手动录入入口。</p>}
            <div className={styles.itemList}>
              {detail.items.map((item) => (
                <article key={item.id} className={styles.item}>
                  <div className={styles.itemMeta}>
                    <span className={styles.badge} data-status={item.reviewStatus === 'approved' ? 'published' : item.reviewStatus === 'rejected' ? 'retired' : 'draft'}>
                      {REVIEW_LABEL[item.reviewStatus]}
                    </span>
                    <span>{DIFFICULTY_LABEL[item.difficulty]} · {item.source === 'ai' ? 'AI 生成' : '手动录入'}</span>
                    {item.knowledgePoint && <span>知识点：{item.knowledgePoint}</span>}
                  </div>
                  {editingItemId === item.id && editState ? (
                    <form className={styles.editForm} onSubmit={(event) => { event.preventDefault(); saveItemEdit(); }}>
                      <label>题干<textarea rows={3} required minLength={8} maxLength={600} value={editState.stem} disabled={busy} onChange={(event) => setEditState((prev) => (prev ? { ...prev, stem: event.target.value } : prev))} /></label>
                      <label>选项（每行一个）<textarea rows={4} required value={editState.options} disabled={busy} onChange={(event) => setEditState((prev) => (prev ? { ...prev, options: event.target.value } : prev))} /></label>
                      <label>正确答案<input required value={editState.answer} disabled={busy} onChange={(event) => setEditState((prev) => (prev ? { ...prev, answer: event.target.value } : prev))} /></label>
                      <label>解析<textarea rows={3} required minLength={8} maxLength={2000} value={editState.explanation} disabled={busy} onChange={(event) => setEditState((prev) => (prev ? { ...prev, explanation: event.target.value } : prev))} /></label>
                      <label>知识点<input maxLength={120} value={editState.knowledgePoint} disabled={busy} onChange={(event) => setEditState((prev) => (prev ? { ...prev, knowledgePoint: event.target.value } : prev))} /></label>
                      <label>难度
                        <select value={editState.difficulty} disabled={busy} onChange={(event) => setEditState((prev) => (prev ? { ...prev, difficulty: event.target.value as QuestionBankItemRecord['difficulty'] } : prev))}>
                          <option value="easy">易</option>
                          <option value="medium">中</option>
                          <option value="hard">难</option>
                        </select>
                      </label>
                      <div className={styles.actions}>
                        <button type="submit" className="btn btn-primary" disabled={busy}>保存修改</button>
                        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { setEditingItemId(''); setEditState(null); }}>取消</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <h3>{item.stem}</h3>
                      <ul className={styles.options}>
                        {item.options.map((option) => (
                          <li key={option} data-answer={option === item.answer ? 'true' : undefined}>{option}</li>
                        ))}
                      </ul>
                      <p>{item.explanation}</p>
                      <div className={styles.actions}>
                        {item.reviewStatus !== 'approved' && (
                          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => patchItem(item.id, { reviewStatus: 'approved' }, '题目已审核通过。')}>通过</button>
                        )}
                        {item.reviewStatus !== 'rejected' && (
                          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => patchItem(item.id, { reviewStatus: 'rejected' }, '题目已驳回。')}>驳回</button>
                        )}
                        {item.reviewStatus !== 'draft' && (
                          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => patchItem(item.id, { reviewStatus: 'draft' }, '题目已退回待审核。')}>退回待审核</button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => { setEditingItemId(item.id); setEditState(itemToEditState(item)); }}
                        >
                          编辑
                        </button>
                        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => deleteItem(item.id)}>删除</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
