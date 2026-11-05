import Link from 'next/link';
import { ClipboardList, Info, ListChecks, MonitorPlay, Stethoscope } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import {
  ENTRY_STATUS_LABELS,
  EXAM_STATIONS,
  KNOWN_GAPS,
  PEDIATRIC_EXTRAS,
  type EntryStatus,
} from '@/domain/exam-stations';
import styles from './exam-stations.module.css';

export const metadata = { title: '执医三站对照 · 珞珈儿科智训' };

const stationIcons = { 'station-1': ClipboardList, 'station-2': Stethoscope, 'station-3': MonitorPlay } as const;

const statusClass: Record<EntryStatus, string> = {
  ready: styles.statusReady,
  partial: styles.statusPartial,
  missing: styles.statusMissing,
};

/**
 * 三站对照页：把「执医考什么」和「本平台在哪里练」并排放，未实现的项如实标注。
 * 站点口径与入口状态全部来自 src/domain/exam-stations.ts，页面不另写一份。
 */
export default function ExamStationsPage() {
  return (
    <MedicalBackdrop>
      <p className="eyebrow">执业医师实践技能考试（临床类别）· 考站对照</p>
      <h1 className="page-title"><ListChecks size={22} aria-hidden="true" /> 三站对照与本平台入口</h1>
      <p className="page-lead">
        按国家临床类别实践技能三站式考试排列每一站考什么、用什么方式考，以及本平台对应入口能练到什么程度。
        未实现的考项明确标注，不用「已完成」掩盖缺口。
      </p>

      <div className={styles.stationList}>
        {EXAM_STATIONS.map((station) => {
          const Icon = stationIcons[station.id as keyof typeof stationIcons] ?? ListChecks;
          return (
            <section className={styles.stationCard} key={station.id} aria-labelledby={`${station.id}-title`}>
              <header className={styles.stationHead}>
                <h2 id={`${station.id}-title`}><Icon size={18} aria-hidden="true" /> {station.name}</h2>
              </header>
              <dl className={styles.officialInfo}>
                <div><dt>考什么</dt><dd>{station.officialScope}</dd></div>
                <div><dt>怎么考</dt><dd>{station.officialMethod}</dd></div>
              </dl>
              <ul className={styles.entryList}>
                {station.entries.map((entry) => (
                  <li key={`${entry.href}-${entry.label}`}>
                    <Link className={styles.entryLink} href={entry.href}>
                      <span className={styles.entryLabel}>{entry.label}</span>
                      <span className={`${styles.statusBadge} ${statusClass[entry.status]}`}>{ENTRY_STATUS_LABELS[entry.status]}</span>
                    </Link>
                    <p className={styles.entryDetail}>{entry.detail}</p>
                  </li>
                ))}
              </ul>
              <p className={styles.gapNote}><Info size={15} aria-hidden="true" /> <span>{station.gap}</span></p>
            </section>
          );
        })}
      </div>

      <section className={styles.extraSection} aria-labelledby="extras-title">
        <h2 id="extras-title">{PEDIATRIC_EXTRAS.name}</h2>
        <p className={styles.extraNote}>{PEDIATRIC_EXTRAS.note}</p>
        <ul className={styles.entryList}>
          {PEDIATRIC_EXTRAS.entries.map((entry) => (
            <li key={`${entry.href}-${entry.label}`}>
              <Link className={styles.entryLink} href={entry.href}>
                <span className={styles.entryLabel}>{entry.label}</span>
                <span className={`${styles.statusBadge} ${statusClass[entry.status]}`}>{ENTRY_STATUS_LABELS[entry.status]}</span>
              </Link>
              <p className={styles.entryDetail}>{entry.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.gapSection} aria-labelledby="gaps-title">
        <h2 id="gaps-title">平台尚未覆盖的考项</h2>
        <ul>
          {KNOWN_GAPS.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      </section>
    </MedicalBackdrop>
  );
}