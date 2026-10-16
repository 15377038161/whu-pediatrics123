'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  Plus,
  Search,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { formatDateTime } from '@/lib/format-date';
import { authedFetch } from '@/lib/authed-api';
import type {
  CaseDraftDetail,
  CaseDraftPayload,
  CaseDraftPrecheckResult,
  CaseDraftRecord,
} from '@/lib/case-draft-import';

const labels = {
  history: '病史',
  exam: '体格检查',
  tests: '辅助检查',
  diagnosis: '诊断与临床思路',
  plan: '治疗与随访计划',
} as const;
type Prepared = {
  payload: CaseDraftPayload;
  sourceName: string;
  issues: string[];
};

export function CaseDraftImporter() {
  const [mode, setMode] = useState<'import' | 'drafts'>('import');
  const [payload, setPayload] = useState<CaseDraftPayload | null>(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('v1');
  const [issues, setIssues] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [desensitized, setDesensitized] = useState(false);
  const [mediaReviewed, setMediaReviewed] = useState(false);
  const [busy, setBusy] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [drafts, setDrafts] = useState<CaseDraftRecord[]>([]);
  const [listError, setListError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [check, setCheck] = useState<CaseDraftPrecheckResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const loadDrafts = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      setDrafts(
        await authedFetch<CaseDraftRecord[]>('/api/teacher/case-drafts'),
      );
    } catch {
      setListError('草稿暂时无法加载，请重试。');
    } finally {
      setLoadingList(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初次挂载同步服务端草稿；重试复用同一加载函数。
    void loadDrafts();
  }, [loadDrafts]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function changed() {
    setDirty(true);
    setCheck(null);
    setMessage('');
    if (saved) {
      setSaved(false);
      setVersion(`rev-${crypto.randomUUID()}`);
    }
  }
  function canReplace() {
    return (
      !dirty ||
      window.confirm('当前有未保存的修改，确定放弃并打开另一份资料吗？')
    );
  }
  function newCase() {
    if (busy || !canReplace()) return;
    setPayload(null);
    setName('');
    setPaste('');
    setCheck(null);
    setIssues([]);
    setError('');
    setMessage('');
    setDirty(false);
    setSaved(false);
    setMode('import');
  }
  function acceptPrepared(data: Prepared) {
    setPayload(data.payload);
    setName(data.sourceName);
    setIssues(data.issues);
    setVersion('v1');
    setDesensitized(false);
    setMediaReviewed(false);
    setCheck(null);
    setSaved(false);
    setDirty(true);
    setMessage('');
    setMode('import');
  }
  async function upload(file: File) {
    if (lock.current || !canReplace()) return;
    lock.current = true;
    setBusy('upload');
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error('文件超过 10 MB，请拆分为单个病例。');
      const form = new FormData();
      form.set('file', file);
      acceptPrepared(
        await authedFetch<Prepared>('/api/teacher/case-drafts/document', {
          method: 'POST',
          body: form,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  async function openDraft(id: string) {
    if (lock.current || !canReplace()) return;
    lock.current = true;
    setBusy(id);
    setError('');
    try {
      const record = await authedFetch<CaseDraftDetail>(
        `/api/teacher/case-drafts?id=${encodeURIComponent(id)}`,
      );
      setPayload(record.payload);
      setName(record.sourceName);
      setVersion(`rev-${crypto.randomUUID()}`);
      setDesensitized(record.desensitized);
      setMediaReviewed(record.mediaReviewed);
      setIssues([]);
      setCheck(null);
      setSaved(false);
      setDirty(false);
      setMessage('已打开已保存的草稿。修改后另存修订版本，原记录保留。');
      setMode('import');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  async function submit(save: boolean) {
    if (!payload || lock.current) return;
    if (!name.trim()) {
      setError('请填写病例名称，便于以后查找。');
      return;
    }
    lock.current = true;
    setBusy(save ? 'save' : 'check');
    setError('');
    setMessage('');
    const body = {
      payload,
      draftVersion: version,
      desensitized,
      mediaReviewed,
      sourceName: name.trim(),
    };
    try {
      const data = await authedFetch<{ precheck: CaseDraftPrecheckResult }>(
        '/api/teacher/case-drafts',
        {
          method: 'POST',
          body: JSON.stringify({ ...body, action: 'precheck' }),
        },
      );
      setCheck(data.precheck);
      if (save) {
        const result = await authedFetch<{ result: string }>(
          '/api/teacher/case-drafts',
          { method: 'POST', body: JSON.stringify({ ...body, action: 'save' }) },
        );
        setMessage(
          result.result === 'duplicate'
            ? '这份版本已经保存，无需重复提交。原记录未被覆盖。'
            : '已保存为待审核草稿，仅教师可见。',
        );
        setSaved(true);
        setDirty(false);
        await loadDrafts();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  const filtered = drafts.filter((d) =>
    `${d.sourceName} ${d.caseName}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="case-studio" aria-busy={Boolean(busy)}>
      <div className="studio-tabs" aria-label="病例工作区">
        <button
          className={mode === 'import' ? 'active' : ''}
          onClick={() => setMode('import')}
          aria-pressed={mode === 'import'}
        >
          <UploadCloud size={18} />
          导入病例资料
        </button>
        <button
          className={mode === 'drafts' ? 'active' : ''}
          onClick={() => setMode('drafts')}
          aria-pressed={mode === 'drafts'}
        >
          <FolderOpen size={18} />
          病例草稿 <span>{drafts.length}</span>
        </button>
      </div>
      {error && (
        <p className="studio-alert error" role="alert">
          {error}
        </p>
      )}
      {mode === 'import' ? (
        <>
          {!payload ? (
            <div className="studio-intake">
              <section className="studio-upload">
                <span className="studio-icon">
                  <UploadCloud size={30} strokeWidth={1.5} />
                </span>
                <h2>把现有病例资料带进来</h2>
                <p>
                  上传老师整理好的
                  Word，按病史、查体、检查等内容自动分段，再逐项核对。
                </p>
                <label
                  className={`studio-primary studio-file ${busy ? 'disabled' : ''}`}
                >
                  <Plus size={18} />
                  {busy === 'upload' ? '正在读取文档…' : '选择病例文档'}
                  <input
                    type="file"
                    aria-label="选择病例文档"
                    accept=".docx,.txt"
                    disabled={Boolean(busy)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <small>
                  每次一份 · Word（.docx）或文本（.txt）· 最大 10 MB
                </small>
                <small>
                  旧版 .doc 请在 Word 中“另存为 .docx”。图片与扫描件暂不识别。
                </small>
              </section>
              <aside className="studio-guide">
                <p className="eyebrow">三步完成病例整理</p>
                <ol>
                  <li>
                    <b>上传资料</b>
                    <span>使用现有文档，无需了解技术格式</span>
                  </li>
                  <li>
                    <b>核对与补充</b>
                    <span>中文表单逐项编辑，缺失内容不自动编造</span>
                  </li>
                  <li>
                    <b>保存待审核</b>
                    <span>草稿仅教师可见，不直接进入学生训练</span>
                  </li>
                </ol>
                <div className="studio-safety">
                  <ShieldCheck size={20} />
                  <span>请上传已获教学使用授权的资料，并核对患儿隐私。</span>
                </div>
              </aside>
              <details className="studio-paste">
                <summary>没有 Word？粘贴正文或手动填写</summary>
                <label>
                  病例原文
                  <textarea
                    value={paste}
                    maxLength={150000}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={7}
                    placeholder="可直接粘贴含主诉、现病史、体格检查等标题的病例正文"
                  />
                </label>
                <div className="studio-actions">
                  <button
                    disabled={Boolean(busy) || !paste.trim()}
                    onClick={() =>
                      void upload(
                        new File([paste], '粘贴的病例资料.txt', {
                          type: 'text/plain',
                        }),
                      )
                    }
                  >
                    整理粘贴内容 <ArrowRight size={16} />
                  </button>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      acceptPrepared({
                        payload: {
                          caseId: `intake-${crypto.randomUUID()}`,
                          sections: {},
                        },
                        sourceName: '',
                        issues: [],
                      })
                    }
                  >
                    直接填写病例表单
                  </button>
                </div>
              </details>
            </div>
          ) : (
            <div className="studio-editor">
              <div className="studio-editor-heading">
                <div>
                  <p className="eyebrow">核对病例资料</p>
                  <h2>{name || '新病例'}</h2>
                  <p>
                    按原始资料填写；暂时无法确认的内容可以留空，先保存待审核。
                  </p>
                </div>
                <button
                  className="studio-secondary"
                  disabled={Boolean(busy)}
                  onClick={newCase}
                >
                  <Plus size={16} />
                  导入另一份
                </button>
              </div>
              {message && (
                <p className="studio-alert success" role="status">
                  <Check size={18} />
                  {message}
                </p>
              )}
              <div className="studio-editor-layout">
                <fieldset disabled={Boolean(busy)} className="studio-form">
                  <section className="studio-card">
                    <h3>
                      <span>01</span> 接诊信息
                    </h3>
                    <label>
                      病例名称
                      <input
                        value={name}
                        maxLength={200}
                        onChange={(e) => {
                          changed();
                          setName(e.target.value);
                        }}
                        placeholder="供教师查找的病例名称"
                      />
                    </label>
                    <div className="studio-demographics">
                      <label>
                        年龄
                        <input
                          value={payload.age ?? ''}
                          maxLength={100}
                          onChange={(e) => {
                            changed();
                            setPayload({ ...payload, age: e.target.value });
                          }}
                          placeholder="如：1岁3月"
                        />
                      </label>
                      <label>
                        性别
                        <select
                          value={payload.sex ?? ''}
                          onChange={(e) => {
                            changed();
                            setPayload({ ...payload, sex: e.target.value });
                          }}
                        >
                          <option value="">待核对</option>
                          {payload.sex &&
                            !['男', '女'].includes(payload.sex) && (
                              <option>{payload.sex}</option>
                            )}
                          <option>男</option>
                          <option>女</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      主诉
                      <textarea
                        rows={2}
                        value={payload.complaint ?? ''}
                        maxLength={5000}
                        onChange={(e) => {
                          changed();
                          setPayload({ ...payload, complaint: e.target.value });
                        }}
                        placeholder="主要症状及持续时间，以原始资料为准"
                      />
                    </label>
                  </section>
                  <section className="studio-card">
                    <h3>
                      <span>02</span> 临床资料
                    </h3>
                    {Object.entries(labels).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <textarea
                          rows={key === 'history' ? 7 : 5}
                          maxLength={150000}
                          value={
                            payload.sections[key as keyof typeof labels] ?? ''
                          }
                          onChange={(e) => {
                            changed();
                            setPayload({
                              ...payload,
                              sections: {
                                ...payload.sections,
                                [key]: e.target.value,
                              },
                            });
                          }}
                          placeholder={`填写原始${label}；原文未提供时留空`}
                        />
                      </label>
                    ))}
                  </section>
                  <section className="studio-card">
                    <h3>
                      <span>03</span> 来源与审核
                    </h3>
                    {payload.documents?.map((document, index) => (
                      <details key={index} className="studio-source">
                        <summary>
                          <FileText size={16} />
                          {document.source || `来源资料 ${index + 1}`} ·
                          查看与脱敏
                        </summary>
                        <p>
                          保留原始依据；如含身份信息，请在这里一并处理。修改表单不会自动改写原文。
                        </p>
                        <label>
                          来源正文
                          <textarea
                            rows={10}
                            value={document.text ?? ''}
                            maxLength={150000}
                            onChange={(e) => {
                              changed();
                              setPayload({
                                ...payload,
                                documents: payload.documents?.map((item, i) =>
                                  i === index
                                    ? { ...item, text: e.target.value }
                                    : item,
                                ),
                              });
                            }}
                          />
                        </label>
                      </details>
                    ))}
                    {!payload.documents?.length && (
                      <p className="studio-muted">
                        暂无来源正文，请在临床资料中注明依据与待核对项。
                      </p>
                    )}
                    <label className="studio-checkbox">
                      <input
                        type="checkbox"
                        checked={desensitized}
                        onChange={(e) => {
                          changed();
                          setDesensitized(e.target.checked);
                        }}
                      />
                      我已核对正文脱敏情况，无患儿姓名、证件号、联系方式等身份信息
                    </label>
                    {Boolean(payload.media?.length) && (
                      <label className="studio-checkbox">
                        <input
                          type="checkbox"
                          checked={mediaReviewed}
                          onChange={(e) => {
                            changed();
                            setMediaReviewed(e.target.checked);
                          }}
                        />
                        已有媒体引用已完成授权及脱敏审核（
                        {payload.media?.length} 项）
                      </label>
                    )}
                  </section>
                </fieldset>
                <aside className="studio-review">
                  <div className="studio-card">
                    <p className="eyebrow">整理提示</p>
                    <h3>由教师把好最后一关</h3>
                    {issues.length ? (
                      <ul>
                        {issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        请核对病史、检查结果与诊疗内容是否一致，尤其是年龄、性别、时间及单位。
                      </p>
                    )}
                    {check && (
                      <div className="studio-check" role="status">
                        <b>
                          资料齐备 {check.completeness.provided} /{' '}
                          {check.completeness.requiredTotal} 项
                        </b>
                        <ul>
                          {check.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="studio-privacy">
                      <ShieldCheck size={17} />
                      待审核草稿不进入学生训练。
                    </p>
                  </div>
                </aside>
              </div>
              <div className="studio-savebar">
                <span>
                  {saved ? '已保存' : dirty ? '有未保存的修改' : '原记录已保存'}
                  <small>修订另存，保留历史版本</small>
                </span>
                <div>
                  <button
                    className="studio-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void submit(false)}
                  >
                    检查资料
                  </button>
                  <button
                    className="studio-primary"
                    disabled={Boolean(busy) || saved || !dirty}
                    onClick={() => void submit(true)}
                  >
                    <Check size={17} />
                    {busy === 'save' ? '保存中…' : '保存待审核草稿'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <section className="studio-library">
          <div className="studio-library-heading">
            <div>
              <h2>已保存的病例资料</h2>
              <p>最近 50 份草稿 · 仅教师可见 · 点击查看或补充</p>
            </div>
            <button
              className="studio-primary"
              disabled={Boolean(busy)}
              onClick={newCase}
            >
              <Plus size={17} />
              新增病例
            </button>
          </div>
          <label className="studio-search">
            <Search size={18} />
            <input
              aria-label="搜索病例草稿"
              placeholder="搜索病例名称"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {loadingList ? (
            <p className="studio-empty" role="status">
              正在加载病例草稿…
            </p>
          ) : listError ? (
            <div className="studio-empty" role="alert">
              <p>{listError}</p>
              <button onClick={() => void loadDrafts()}>重新加载</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="studio-empty">
              <FolderOpen size={32} />
              <h3>{query ? '没有找到匹配的病例' : '还没有病例草稿'}</h3>
              <p>
                {query
                  ? '换个关键词试试。'
                  : '上传第一份 Word 病例，开始整理教学资料。'}
              </p>
            </div>
          ) : (
            <div className="studio-draft-list">
              {filtered.map((d) => (
                <article key={d.id}>
                  <span className="studio-document-icon">
                    <FileText size={24} />
                  </span>
                  <div className="studio-draft-info">
                    <span className="studio-status">待审核</span>
                    <h3>{d.sourceName || d.caseName}</h3>
                    <p>
                      {d.missingFields.length
                        ? `待补充 ${d.missingFields.length} 项`
                        : '基础资料齐备'}{' '}
                      · {d.desensitized ? '已确认正文脱敏' : '待核对隐私'} ·{' '}
                      {formatDateTime(d.createdAt)}
                    </p>
                  </div>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => void openDraft(d.id)}
                    aria-label={`查看${d.sourceName || d.caseName}`}
                  >
                    {busy === d.id ? '读取中…' : '查看与补充'}
                    <ArrowRight size={17} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
