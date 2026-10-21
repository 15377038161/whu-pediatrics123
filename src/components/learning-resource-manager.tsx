'use client';

/**
 * 教师学习资源管理面板（D10 / 方案第 13 节）：
 * - 工作流：登记元数据（对象存储文件绑定）→ 授权班级 → 发布 → 下架/重新编辑 → 修订再发布；
 * - 权限：普通教师仅管理本人资源（RLS）；全平台发布仅项目管理员（数据库触发器强制）；
 * - 文件绑定：从平台对象存储清单选择（不重新上传，fileId 入库，播放动态取短期链接）；
 * - 发布前置校验由服务端触发器强制（FILE_REQUIRED / VISIBILITY_REQUIRED），本层仅呈现错误。
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileText, Film, MonitorPlay, Paperclip, RefreshCw, Trash2 } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import { formatDateTime } from '@/lib/format-date';
import type { StorageFileBrief, TeacherClassBrief, TeacherResourceRecord } from '@/lib/learning-resource-teacher';
import styles from './learning-resource-manager.module.css';

const STATUS_LABEL: Record<TeacherResourceRecord['status'], string> = {
  draft: '草稿',
  published: '已发布',
  retired: '已下架',
};

const KIND_LABEL: Record<TeacherResourceRecord['kind'], string> = {
  video: '教学视频',
  document: '图文资料',
};

interface ListResponse {
  resources: TeacherResourceRecord[];
  classes: TeacherClassBrief[];
  isAdmin: boolean;
}

interface DetailResponse {
  resource: TeacherResourceRecord;
  visibility: string[];
}

interface PlaybackResponse {
  kind: TeacherResourceRecord['kind'];
  title: string;
  fileName: string | null;
  url: string;
  expiresAt: string;
}

interface EditState {
  title: string;
  kind: TeacherResourceRecord['kind'];
  topic: string;
  description: string;
  source: string;
  fileId: string;
  coverFileId: string;
  durationSeconds: string;
  sortOrder: string;
}

function toEditState(resource: TeacherResourceRecord): EditState {
  return {
    title: resource.title,
    kind: resource.kind,
    topic: resource.topic ?? '',
    description: resource.description ?? '',
    source: resource.source ?? '',
    fileId: resource.fileId ?? '',
    coverFileId: resource.coverFileId ?? '',
    durationSeconds: resource.durationSeconds === null ? '' : String(resource.durationSeconds),
    sortOrder: String(resource.sortOrder ?? 0),
  };
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function LearningResourceManager() {
  const [list, setList] = useState<TeacherResourceRecord[] | null>(null);
  const [classes, setClasses] = useState<TeacherClassBrief[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [detail, setDetail] = useState<TeacherResourceRecord | null>(null);
  const [visibility, setVisibility] = useState<string[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [files, setFiles] = useState<StorageFileBrief[] | null>(null);
  const [pickerTarget, setPickerTarget] = useState<'file' | 'cover' | null>(null);
  const [platformScope, setPlatformScope] = useState(false);
  const [creating, setCreating] = useState({ title: '', kind: 'video' as TeacherResourceRecord['kind'], topic: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadList = useCallback(async (): Promise<ListResponse | null> => {
    try {
      const next = await authedFetch<ListResponse>('/api/teacher/resources');
      setList(next.resources ?? []);
      setClasses(next.classes ?? []);
      setIsAdmin(Boolean(next.isAdmin));
      setError('');
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资源列表读取失败');
      return null;
    }
  }, []);

  const loadDetail = useCallback(async (resourceId: string): Promise<void> => {
    try {
      const next = await authedFetch<DetailResponse>(`/api/teacher/resources/${resourceId}`);
      setDetail(next.resource);
      setVisibility(next.visibility ?? []);
      setEdit(toEditState(next.resource));
      setPlatformScope(next.resource.scope === 'platform');
      setConfirmDelete(false);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资源详情读取失败');
    }
  }, []);

  // 初始列表加载：setState 均在异步 fetch 返回后执行（.then 回调，不违反 set-state-in-effect）
  useEffect(() => {
    let active = true;
    authedFetch<ListResponse>('/api/teacher/resources')
      .then((next) => {
        if (!active) return;
        setList(next.resources ?? []);
        setClasses(next.classes ?? []);
        setIsAdmin(Boolean(next.isAdmin));
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : '资源列表读取失败');
      });
    return () => { active = false; };
  }, []);

  const loadFiles = useCallback(async (): Promise<StorageFileBrief[]> => {
    if (files) return files;
    try {
      const next = await authedFetch<{ files: StorageFileBrief[] }>('/api/teacher/resource-files');
      setFiles(next.files ?? []);
      return next.files ?? [];
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '对象存储文件清单读取失败');
      return [];
    }
  }, [files]);

  const runAction = useCallback(async (action: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, []);

  const createResource = useCallback(() => {
    const payload = {
      title: creating.title.trim(),
      kind: creating.kind,
      topic: creating.topic.trim() || null,
    };
    if (payload.title.length < 2) {
      setError('标题至少 2 个字符。');
      return;
    }
    void runAction(async () => {
      const result = await authedFetch<{ resource: TeacherResourceRecord }>('/api/teacher/resources', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCreating({ title: '', kind: 'video', topic: '' });
      await loadList();
      await loadDetail(result.resource.resourceId);
      return '草稿已创建，请继续补全元数据并绑定文件。';
    });
  }, [creating, loadList, loadDetail, runAction]);

  const saveMetadata = useCallback(() => {
    if (!detail || !edit) return;
    const payload = {
      title: edit.title.trim(),
      kind: edit.kind,
      topic: edit.topic.trim() || null,
      description: edit.description.trim() || null,
      source: edit.source.trim() || null,
      fileId: edit.fileId.trim() || null,
      coverFileId: edit.coverFileId.trim() || null,
      durationSeconds: edit.durationSeconds.trim() === '' ? null : Math.max(0, Math.floor(Number(edit.durationSeconds))),
      sortOrder: Math.max(0, Math.min(9999, Math.floor(Number(edit.sortOrder) || 0))),
    };
    if (payload.title.length < 2) {
      setError('标题至少 2 个字符。');
      return;
    }
    if (payload.durationSeconds !== null && !Number.isFinite(payload.durationSeconds)) {
      setError('时长需为非负秒数。');
      return;
    }
    void runAction(async () => {
      const result = await authedFetch<{ resource: TeacherResourceRecord }>(`/api/teacher/resources/${detail.resourceId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setDetail(result.resource);
      await loadList();
      return '元数据已保存。';
    });
  }, [detail, edit, loadList, runAction]);

  const saveVisibility = useCallback((cohortIds: string[]) => {
    if (!detail) return;
    void runAction(async () => {
      const result = await authedFetch<{ visibility: string[] }>(`/api/teacher/resources/${detail.resourceId}/visibility`, {
        method: 'PUT',
        body: JSON.stringify({ cohortIds }),
      });
      setVisibility(result.visibility ?? []);
      return '可见班级已更新。';
    });
  }, [detail, runAction]);

  const publishResource = useCallback(() => {
    if (!detail) return;
    void runAction(async () => {
      const result = await authedFetch<{ resource: TeacherResourceRecord }>(`/api/teacher/resources/${detail.resourceId}/publish`, {
        method: 'POST',
        body: JSON.stringify(platformScope ? { scope: 'platform' } : {}),
      });
      setDetail(result.resource);
      await loadList();
      return '资源已发布，学生在学习资源中心立即可见。';
    });
  }, [detail, platformScope, loadList, runAction]);

  const changeStatus = useCallback((action: 'retire' | 'restore') => {
    if (!detail) return;
    void runAction(async () => {
      const result = await authedFetch<{ resource: TeacherResourceRecord }>(`/api/teacher/resources/${detail.resourceId}/status`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setDetail(result.resource);
      await loadList();
      return action === 'retire' ? '资源已下架，学生列表已移除（历史进度保留）。' : '资源已转回草稿，修订后可再次发布。';
    });
  }, [detail, loadList, runAction]);

  const deleteResource = useCallback(() => {
    if (!detail) return;
    void runAction(async () => {
      await authedFetch(`/api/teacher/resources/${detail.resourceId}`, { method: 'DELETE' });
      setDetail(null);
      setEdit(null);
      await loadList();
      return '草稿已删除。';
    });
  }, [detail, loadList, runAction]);

  const previewResource = useCallback(() => {
    if (!detail) return;
    void runAction(async () => {
      const link = await authedFetch<PlaybackResponse>(`/api/teacher/resources/${detail.resourceId}/playback`);
      window.open(link.url, '_blank', 'noopener,noreferrer');
      return '已在新窗口打开预览（链接 1 小时内有效）。';
    });
  }, [detail, runAction]);

  const pickFile = useCallback((fileId: string) => {
    if (!pickerTarget || !edit) return;
    setEdit(pickerTarget === 'file' ? { ...edit, fileId } : { ...edit, coverFileId: fileId });
    setPickerTarget(null);
  }, [pickerTarget, edit]);

  const ownedClasses = classes;

  if (!list) {
    return (
      <div className={styles.workspace}>
        <div className="empty-state"><p>正在加载…</p></div>
        {error ? <p className={styles.feedback} role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.heading}>
        <p className="eyebrow">学习资源</p>
        <h1 className="page-title">资源中心管理</h1>
        <p className="page-lead">
          登记教学视频与图文资料：绑定平台对象存储文件、授权班级后发布；学生即可在学习资源中心观看（断点续播）。
        </p>
      </div>

      {error ? <p className={styles.feedback} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      {detail && edit ? (
        <section className={styles.card} aria-label="资源编辑">
          <div className={styles.actions}>
            <button className="btn btn-quiet" type="button" onClick={() => { setDetail(null); setEdit(null); }}>
              <ArrowLeft size={14} /> 返回列表
            </button>
            <span className={styles.badge} data-status={detail.status}>{STATUS_LABEL[detail.status]}</span>
            <span className={styles.badge}>{detail.scope === 'platform' ? '全平台可见' : '班级范围'}</span>
            <span className={styles.hint}>更新于 {formatDateTime(detail.updatedAt)}</span>
          </div>

          <h2>{detail.title}</h2>

          <div className={styles.metaGrid}>
            <label>
              标题
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={120} />
            </label>
            <label>
              类型
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as TeacherResourceRecord['kind'] })}>
                <option value="video">教学视频</option>
                <option value="document">图文资料</option>
              </select>
            </label>
            <label>
              主题
              <input value={edit.topic} onChange={(e) => setEdit({ ...edit, topic: e.target.value })} maxLength={120} placeholder="如：心肺复苏" />
            </label>
            <label>
              来源
              <input value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} maxLength={120} placeholder="如：儿科教研室" />
            </label>
            <label>
              时长（秒）
              <input value={edit.durationSeconds} onChange={(e) => setEdit({ ...edit, durationSeconds: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="视频时长，可选" />
            </label>
            <label>
              排序（小在前）
              <input value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" />
            </label>
          </div>

          <label>
            简介
            <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={2000} placeholder="资源说明（学生端展示）" />
          </label>

          <div className={styles.fileRows}>
            <div className={styles.fileRow}>
              <strong>{edit.kind === 'video' ? '视频文件' : '资料文件'}</strong>
              <code className={styles.fileId}>{edit.fileId || '未绑定'}</code>
              <button className="btn btn-quiet" type="button" onClick={() => void loadFiles().then(() => setPickerTarget('file'))}>
                <Paperclip size={14} /> {edit.fileId ? '更换文件' : '从对象存储选择'}
              </button>
            </div>
            <div className={styles.fileRow}>
              <strong>封面图（可选）</strong>
              <code className={styles.fileId}>{edit.coverFileId || '未设置'}</code>
              <button className="btn btn-quiet" type="button" onClick={() => void loadFiles().then(() => setPickerTarget('cover'))}>
                <Paperclip size={14} /> {edit.coverFileId ? '更换封面' : '从对象存储选择'}
              </button>
            </div>
          </div>

          <div className={styles.actions}>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={saveMetadata}>保存元数据</button>
            {detail.fileId ? (
              <button className="btn btn-quiet" type="button" disabled={busy} onClick={previewResource}>
                <MonitorPlay size={14} /> 预览
              </button>
            ) : null}
          </div>

          <fieldset className={styles.visibilityBlock}>
            <legend>可见班级（发布前至少授权一个本人管理的班级）</legend>
            {ownedClasses.length === 0 ? (
              <p className={styles.hint}>你还没有管理的班级；全平台发布仅项目管理员可选。</p>
            ) : (
              <div className={styles.classGrid}>
                {ownedClasses.map((klass) => {
                  const checked = visibility.includes(klass.id);
                  return (
                    <label key={klass.id} className={styles.classCheck}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => saveVisibility(checked ? visibility.filter((id) => id !== klass.id) : [...visibility, klass.id])}
                      />
                      <span>{klass.name}（{klass.memberCount} 人）</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className={styles.actions}>
            {isAdmin ? (
              <label className={styles.platformCheck}>
                <input type="checkbox" checked={platformScope} disabled={detail.scope === 'platform' && detail.status !== 'draft'} onChange={(e) => setPlatformScope(e.target.checked)} />
                全平台可见（仅项目管理员）
              </label>
            ) : null}
            {detail.status === 'draft' ? (
              <button className="btn btn-primary" type="button" disabled={busy} onClick={publishResource}>发布</button>
            ) : null}
            {detail.status === 'published' ? (
              <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => changeStatus('retire')}>下架</button>
            ) : null}
            {detail.status === 'retired' ? (
              <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => changeStatus('restore')}>重新编辑</button>
            ) : null}
            {detail.status === 'draft' ? (
              confirmDelete ? (
                <>
                  <button className="btn btn-danger" type="button" disabled={busy} onClick={deleteResource}><Trash2 size={14} /> 确认删除草稿</button>
                  <button className="btn btn-quiet" type="button" onClick={() => setConfirmDelete(false)}>取消</button>
                </>
              ) : (
                <button className="btn btn-quiet" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 删除草稿</button>
              )
            ) : null}
          </div>
          <p className={styles.hint}>已发布/下架过的资源保留学生进度历史，只能下架不能删除；发布校验（文件绑定、班级授权）由服务端强制。</p>
        </section>
      ) : (
        <>
          <section className={styles.card} aria-label="新建资源">
            <h2>登记新资源</h2>
            <p className={styles.hint}>八个操作视频已在平台对象存储：创建草稿后经「从对象存储选择」绑定，无需重新上传。</p>
            <div className={styles.metaGrid}>
              <label>
                标题
                <input value={creating.title} onChange={(e) => setCreating({ ...creating, title: e.target.value })} maxLength={120} placeholder="如：心肺复苏（新生儿）" />
              </label>
              <label>
                类型
                <select value={creating.kind} onChange={(e) => setCreating({ ...creating, kind: e.target.value as TeacherResourceRecord['kind'] })}>
                  <option value="video">教学视频</option>
                  <option value="document">图文资料</option>
                </select>
              </label>
              <label>
                主题（可选）
                <input value={creating.topic} onChange={(e) => setCreating({ ...creating, topic: e.target.value })} maxLength={120} placeholder="如：急救操作" />
              </label>
            </div>
            <div className={styles.actions}>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={createResource}>创建草稿</button>
            </div>
          </section>

          <div className={styles.actions}>
            <h2 className={styles.listTitle}>资源列表（{list.length}）</h2>
            <button className="btn btn-quiet" type="button" onClick={() => void loadList()} aria-label="刷新列表"><RefreshCw size={14} /></button>
          </div>

          {list.length === 0 ? (
            <div className="empty-state"><p>还没有学习资源；从上方登记第一个资源开始。</p></div>
          ) : (
            <div className={styles.grid}>
              {list.map((resource) => (
                <button key={resource.resourceId} type="button" className={styles.resourceCard} onClick={() => void loadDetail(resource.resourceId)}>
                  <div className={styles.cardHead}>
                    <span className={styles.badge} data-status={resource.status}>{STATUS_LABEL[resource.status]}</span>
                    <span className={styles.kindBadge}>
                      {resource.kind === 'video' ? <Film size={12} /> : <FileText size={12} />} {KIND_LABEL[resource.kind]}
                    </span>
                    {resource.scope === 'platform' ? <span className={styles.badge}>全平台</span> : null}
                  </div>
                  <h3>{resource.title}</h3>
                  {resource.topic ? <p>{resource.topic}</p> : null}
                  <div className={styles.cardMeta}>
                    <span>{resource.fileId ? '已绑定文件' : '未绑定文件'}</span>
                    <span>更新于 {formatDateTime(resource.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {pickerTarget ? (
        <div className={styles.pickerOverlay} role="dialog" aria-modal="true" aria-label="选择对象存储文件">
          <div className={styles.pickerPanel}>
            <div className={styles.actions}>
              <h2>{pickerTarget === 'file' ? '选择资源文件' : '选择封面图'}</h2>
              <button className="btn btn-quiet" type="button" onClick={() => setPickerTarget(null)}>关闭</button>
            </div>
            {!files ? (
              <p className={styles.hint}>正在读取对象存储清单…</p>
            ) : files.length === 0 ? (
              <p className={styles.hint}>对象存储暂无文件。请先在平台项目详情页「对象存储」中上传。</p>
            ) : (
              <div className={styles.fileList}>
                {files.map((file) => (
                  <button key={file.fileId} type="button" className={styles.fileOption} onClick={() => pickFile(file.fileId)}>
                    <span className={styles.fileOptionName}>{file.fileName}</span>
                    <span className={styles.fileOptionMeta}>{formatSize(file.fileSize)} · {file.updateTime}</span>
                    <code className={styles.fileId}>{file.fileId}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
