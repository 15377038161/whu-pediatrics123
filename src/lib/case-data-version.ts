import { createHash } from 'node:crypto';

/** Persisted case content only: no timestamps, review notes or environment values.
 * Keep this independent of the reader/snapshot modules to avoid circular imports.
 */
interface VersionedCaseData {
  caseId: string;
  sourceName: string;
  sourceDocument: string;
  age: string;
  sex: string;
  complaint: string;
  teachingSimulation?: true;
  sections: { history: string; exam: string; tests: string; diagnosis: string; plan: string };
  vitals: { temperature: number | null; heartRate: number | null; respiratoryRate: number | null; spo2: number | null };
  documents: Array<{ source: string; text: string; sha256: string }>;
  testRelease?: Array<{ testId: string; availableFromStage?: string; resultDelayNote?: string }>;
  testMedia?: Array<{ testId: string; media: Array<{ fileId: string; kind: 'image'; caption: string }> }>;
  examMedia?: Array<{ examId: string; media: Array<{ fileId: string; kind: 'image'; caption: string }> }>;
}

/** Algorithm v2: field edits change versions even when original files are intact.
 * Explicit field order makes object key order irrelevant; array order is retained
 * because the first document can be the primary source. Media bindings participate
 * when present (recall snapshots). Persisted test/exam media and release rules are
 * also fixed facts: changing a resource, trigger or release time must change versions.
 * Absent optional fields remain omitted, preserving existing media-free v2 keys.
 */
export function computeCaseContentHash(record: VersionedCaseData, media: ReadonlyArray<{ url: string; caption: string }> = []): string {
  const { sections, vitals } = record;
  const payload = {
    algorithm: 'case-content-v2',
    caseId: record.caseId,
    sourceName: record.sourceName,
    sourceDocument: record.sourceDocument,
    age: record.age,
    sex: record.sex,
    complaint: record.complaint,
    teachingSimulation: record.teachingSimulation,
    sections: { history: sections.history, exam: sections.exam, tests: sections.tests, diagnosis: sections.diagnosis, plan: sections.plan },
    vitals: { temperature: vitals.temperature, heartRate: vitals.heartRate, respiratoryRate: vitals.respiratoryRate, spo2: vitals.spo2 },
    documents: record.documents.map(({ source, text, sha256 }) => ({ source, text, sha256 })),
    media: media.map(({ url, caption }) => ({ url, caption })),
    testRelease: record.testRelease?.map(({ testId, availableFromStage, resultDelayNote }) => ({ testId, availableFromStage, resultDelayNote })),
    testMedia: record.testMedia?.map(({ testId, media }) => ({ testId, media: media.map(({ fileId, kind, caption }) => ({ fileId, kind, caption })) })),
    examMedia: record.examMedia?.map(({ examId, media }) => ({ examId, media: media.map(({ fileId, kind, caption }) => ({ fileId, kind, caption })) })),
  };
  const canonical = JSON.stringify(payload, (_key, value: unknown) => typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Preserve the existing opaque 16-hex DB/RPC/cache contract; v2 is in the hash input.
 * Historical keys remain readable from their exact persisted snapshots, never by
 * treating a legacy original-document hash as a match for current local facts.
 */
export function computeCaseDataVersion(record: VersionedCaseData, media: ReadonlyArray<{ url: string; caption: string }> = []): string {
  return computeCaseContentHash(record, media).slice(0, 16);
}
