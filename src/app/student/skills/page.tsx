'use client';


/**
 * 学生技能学习页（批次7）：
 * - 儿科 OSCE 八项核心技能目录：技能卡片含分类、简介、可见资源数与本人完成度（x/y + 进度条）；
 * - 点开技能查看其下资源清单（视频/图文），点击资源跳转学习资源中心详情（断点续播、完成标记）；
 * - 完成度仅展示（观看位置达时长 90% 由服务端 RPC 标记），不当掌握程度、不入临床评分。
 */


import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronDown, Film, FileText, RefreshCw } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import type { LearningResourceSummary, SkillCatalogItem } from '@/lib/learning-resource';
import styles from './skills.module.css';


const KIND_LABEL = { video: '教学视频', document: '图文资料' } as const;


function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}


function SkillResources({ skillId, resources, onOpen }: { skillId: string; resources: LearningResourceSummary[]; onOpen: (id: string) => void }) {
  const items = resources
    .filter((item) => item.skillId === skillId)
    .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : b.updatedAt.localeCompare(a.updatedAt)));


  if (items.length === 0) {
    return <p className={styles.skillEmpty}>该技能下暂无可学习的资源；老师发布并绑定后会出现在这里。</p>;
  }


  return (
    <ul className={styles.resourceList}>
      {items.map((item) => {
        const completed = item.completedAt !== null;
        return (
          <li key={item.resourceId}>
            <button type="button" className={styles.resourceRow} onClick={() => onOpen(item.resourceId)}>
              <span className={styles.kindBadge} data-kind={item.kind}>
                {item.kind === 'video' ? <Film size={12} /> : <FileText size={12} />} {KIND_LABEL[item.kind]}
              </span>
              <span className={styles.resourceTitle}>{item.title}</span>
              {item.durationSeconds ? <span className={styles.resourceMeta}>{formatDuration(item.durationSeconds)}</span> : null}
              {item.positionSeconds !== null && item.positionSeconds > 0 && !completed ? (
                <span className={styles.resumeChip}>续播 {formatDuration(item.positionSeconds)}</span>
              ) : null}
              {completed ? (
                <span className={styles.doneChip}><CheckCircle2 size={13} /> 已看完</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}


export default function StudentSkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [resources, setResources] = useState<LearningResourceSummary[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [openSkillId, setOpenSkillId] = useState<string | null>(null);


  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const [catalog, list] = await Promise.all([
        authedFetch<{ skills: SkillCatalogItem[] }>('/api/skills'),
        authedFetch<{ resources: LearningResourceSummary[] }>('/api/resources'),
      ]);
      setSkills(catalog.skills ?? []);
      setResources(list.resources ?? []);
      setPhase('ready');
    } catch (e) {
      setErrorMessage((e as Error).message || '技能目录加载失败，请稍后重试。');
      setPhase('error');
    }
  }, []);


  // 初始列表加载：setState 均在异步 fetch 返回后执行（.then 回调，不违反 set-state-in-effect）
  useEffect(() => {
    let active = true;
    Promise.all([
      authedFetch<{ skills: SkillCatalogItem[] }>('/api/skills'),
      authedFetch<{ resources: LearningResourceSummary[] }>('/api/resources'),
    ])
      .then(([catalog, list]) => {
        if (!active) return;
        setSkills(catalog.skills ?? []);
        setResources(list.resources ?? []);
        setPhase('ready');
      })
      .catch((e) => {
        if (!active) return;
        setErrorMessage((e as Error).message || '技能目录加载失败，请稍后重试。');
        setPhase('error');
      });
    return () => { active = false; };
  }, []);


  if (phase === 'loading') return <div className="empty-state"><p>正在加载…</p></div>;
  if (phase === 'error') {
    return <div className="empty-state"><p>{errorMessage}</p><button className="btn btn-primary" type="button" onClick={() => void load()}>重试</button></div>;
  }


  return (
    <>
      <p className="eyebrow">技能学习</p>
      <h1 className="page-title">核心技能学习</h1>
      <p className="page-lead">
        儿科 OSCE 八项核心技能：每项技能下有教学视频与图文资料；看完视频（达时长 90%）会标记「已看完」。
        观看进度只用于断点续播与完成标记，不作为掌握程度评价。
      </p>


      <div className={styles.actions}>
        <h2 className={styles.listTitle}>技能目录（{skills.length}）</h2>
        <button className="btn btn-quiet" type="button" onClick={() => void load()} aria-label="刷新技能目录"><RefreshCw size={14} /></button>
      </div>


      {skills.length === 0 ? (
        <div className="empty-state"><p>技能目录尚未配置；老师设置后会出现在这里。</p></div>
      ) : (
        <div className={styles.skillGrid}>
          {skills.map((skill) => {
            const open = openSkillId === skill.skillId;
            const total = skill.resourceCount;
            const done = skill.completedCount;
            const percent = total > 0 ? Math.round((done / total) * 100) : 0;
            const allDone = total > 0 && done >= total;
            return (
              <section key={skill.skillId} className={styles.skillCard} data-open={open}>
                <button
                  type="button"
                  className={styles.skillHead}
                  aria-expanded={open}
                  onClick={() => setOpenSkillId(open ? null : skill.skillId)}
                >
                  <div className={styles.skillHeadTop}>
                    <h3 className={styles.skillTitle}>{skill.title}</h3>
                    {allDone ? <span className={styles.doneChip}><CheckCircle2 size={13} /> 全部看完</span> : null}
                  </div>
                  {skill.category ? <span className={styles.categoryChip}>{skill.category}</span> : null}
                  {skill.description ? <p className={styles.skillDesc}>{skill.description}</p> : null}
                  <div className={styles.skillMeta}>
                    <span>{total} 项资源 · 已看完 {done}</span>
                    <ChevronDown size={15} className={styles.chevron} data-open={open} />
                  </div>
                  <div className={styles.progressTrack} role="img" aria-label={`完成度 ${done}/${total}`}>
                    <div className={styles.progressFill} style={{ width: `${percent}%` }} />
                  </div>
                </button>
                {open ? (
                  <div className={styles.skillBody}>
                    <SkillResources
                      skillId={skill.skillId}
                      resources={resources}
                      onOpen={(id) => router.push(`/student/resources?resourceId=${id}`)}
                    />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
