'use client';

import { useCallback, useEffect, useState } from 'react';

interface PrecheckResult {
  caseId: string;
  caseName: string;
  aliasSourceId: string | null;
  aliasRelation: string | null;
  sourceMatch: 'catalog' | 'alias' | 'unknown';
  missingFields: string[];
  completeness: { requiredTotal: number; provided: number };
  desensitized: boolean;
  mediaReviewed: boolean;
  mediaCount: number;
  documentCount: number;
  issues: string[];
  duplicate: boolean;
}

interface DraftRecord {
  id: string;
  caseId: string;
  caseName: string;
  draftVersion: string;
  status: string;
  desensitized: boolean;
  mediaReviewed: boolean;
  missingFields: string[];
  createdAt: string;
}

const EXAMPLE_TEMPLATE = `{
  "caseId": "teacher-新生儿呼吸窘迫综合征",
  "age": "胎龄34+1周",
  "sex": "男",
  "complaint": "生后呻吟、吐沫30分钟",
  "sections": {
    "history": "（病史：现病史/既往史/出生史，须为脱敏后的教学文本）",
    "exam": "（查体：体温、呼吸、心率、血氧、肺部体征等）",
    "tests": "（辅助检查：血气、胸片、实验室结果等）",
    "diagnosis": "（诊断：该病例的最终诊断）",
    "plan": "（诊疗计划：处置与随访）"
  },
  "vitals": { "temperature": 36.5, "heartRate": 140, "respiratoryRate": 65, "spo2": 88 },
  "media": [ { "url": "（教师审核后的影像引用）", "caption": "（影像说明）" } ],
  "documents": [ { "source": "（来源文档名）", "text": "（脱敏正文）" } ]
}`;

const PLACEHOLDER = `{
  "caseId": "teacher-病例ID",
  "age": "",
  "sex": "",
  "complaint": "",
  "sections": { "history": "", "exam": "", "tests": "", "diagnosis": "", "plan": "" }
}`;

export function CaseDraftImporter() {
  const [draftVersion, setDraftVersion] = useState('v1');
  const [text, setText] = useState('');
  const [desensitized, setDesensitized] = useState(false);
  const [mediaReviewed, setMediaReviewed] = useState(false);
  const [busy, setBusy] = useState<'precheck' | 'save' | 'list' | null>(null);
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [saveResult, setSaveResult] = useState<string>('');
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [error, setError] = useState('');

  const loadDrafts = useCallback(async () => {
    setBusy('list');
    setError('');
    try {
      const resp = await fetch('/api/teacher/case-drafts');
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error?.message ?? `HTTP ${resp.status}`);
      setDrafts((body.data ?? []) as DraftRecord[]);
    } catch (e) {
      setError(`草稿列表读取失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // 初始加载草稿列表：同步外部系统（服务端草稿表）到 React 状态，与 quiz 页同场景处理方式一致。
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loadDrafts 的 setState 均在异步 fetch 返回后执行
  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  async function submit(action: 'precheck' | 'save') {
    setBusy(action);
    setError('');
    setPrecheck(null);
    setSaveResult('');
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      setError('JSON 解析失败：请检查粘贴的结构化资料格式');
      setBusy(null);
      return;
    }
    try {
      const resp = await fetch('/api/teacher/case-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, draftVersion, desensitized, mediaReviewed, payload }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error?.message ?? `HTTP ${resp.status}`);
      if (action === 'precheck') {
        setPrecheck(body.data.precheck as PrecheckResult);
      } else if (body.data.result === 'duplicate') {
        setSaveResult(`重复导入被拒：草稿 ${body.data.draftVersion} 已存在（不会覆盖旧版本）。如需修订请更换 draft_version（如 v2）。`);
      } else {
        setSaveResult(`草稿已保存（仅教师可见，未发布给学生）：${body.data.record.caseName} @ ${body.data.record.draftVersion}`);
        await loadDrafts();
      }
    } catch (e) {
      setError(`操作失败：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="case-draft-importer">
      <section>
        <h2>1. 填写草稿版本与结构化资料</h2>
        <label>草稿版本（修订时递增，如 v1 → v2；旧版本不会被覆盖）
          <input value={draftVersion} onChange={(e) => setDraftVersion(e.target.value)} placeholder="v1" />
        </label>
        <label className="checkbox-row"><input type="checkbox" checked={desensitized} onChange={(e) => setDesensitized(e.target.checked)} />正文已确认脱敏（无姓名/证件号/联系方式等身份信息）</label>
        <label className="checkbox-row"><input type="checkbox" checked={mediaReviewed} onChange={(e) => setMediaReviewed(e.target.checked)} />媒体引用已审核（未经审核的媒体学生不可见）</label>
        <label>结构化资料 JSON（示例模板见下方）
          <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} spellCheck={false} />
        </label>
        <div className="action-row">
          <button type="button" disabled={busy !== null || !text.trim()} onClick={() => void submit('precheck')}>{busy === 'precheck' ? '校验中…' : '预校验'}</button>
          <button type="button" disabled={busy !== null || !text.trim()} onClick={() => void submit('save')}>{busy === 'save' ? '保存中…' : '保存草稿'}</button>
          <button type="button" onClick={() => setText(EXAMPLE_TEMPLATE)}>填入示例模板</button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {saveResult ? <p className="form-ok">{saveResult}</p> : null}
      </section>

      {precheck ? (
        <section>
          <h2>2. 预校验结果</h2>
          <p>病例：<strong>{precheck.caseName}</strong>（{precheck.caseId}）· 来源匹配：{precheck.sourceMatch === 'catalog' ? '教师目录独立来源' : precheck.sourceMatch === 'alias' ? `别名/亚型 → ${precheck.aliasSourceId}` : '目录外（不可追溯）'}</p>
          <p>必填字段完整性：{precheck.completeness.provided}/{precheck.completeness.requiredTotal}{precheck.missingFields.length > 0 ? `，缺失：${precheck.missingFields.join('、')}` : '，全部齐备'}</p>
          <p>脱敏状态：{precheck.desensitized ? '已确认' : '未确认'} · 媒体审核：{precheck.mediaReviewed ? '已审核' : '未审核'}（媒体 {precheck.mediaCount} 项，文档 {precheck.documentCount} 份）</p>
          {precheck.issues.length > 0 ? (
            <ul className="issue-list">{precheck.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          ) : <p>未发现问题，可保存。</p>}
        </section>
      ) : null}

      <section>
        <h2>3. 已保存草稿（仅教师可见）</h2>
        {drafts.length === 0 ? <p className="empty-state">暂无草稿。</p> : (
          <table className="draft-table">
            <thead><tr><th>病例</th><th>版本</th><th>状态</th><th>脱敏</th><th>媒体审核</th><th>缺失字段</th><th>保存时间</th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td>{d.caseName}</td>
                  <td>{d.draftVersion}</td>
                  <td>{d.status}</td>
                  <td>{d.desensitized ? '已确认' : '未确认'}</td>
                  <td>{d.mediaReviewed ? '已审核' : '未审核'}</td>
                  <td>{d.missingFields.length > 0 ? `缺 ${d.missingFields.length} 项` : '齐备'}</td>
                  <td>{new Date(d.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">草稿保存后与运行中病例事实完全隔离：不进入学生训练、不被病例加载器读取。发布给学生需要后续教师确认流程（本阶段未实现）。</p>
      </section>
    </div>
  );
}
