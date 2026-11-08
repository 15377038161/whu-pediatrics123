import type { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { getCasePublicationOverview } from '@/lib/case-publication';
import { restoreControlledCaseSources, exportRestoredCaseSources, type SnapshotAnswersRow, type SnapshotFactsRow } from '@/lib/case-snapshot-archive';
import {TEACHER_CASE_CATALOG} from '@/domain/teacher-case-catalog';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

/**
 * Teacher-only recovery of the fixed source package from already persisted snapshots.
 *
 * The client sends only a fixed confirmation phrase. Case IDs, versions, paths and
 * source text are never accepted from the request. Both snapshot tables are read with
 * the teacher's RLS session; every version is fingerprinted before any file is written.
 * Database snapshots are never mutated. The normal response contains counters;
 * explicit restore-and-export returns a private archive of the same RLS-visible,
 * fingerprint-verified records, never arbitrary server files.
 */

type TeacherContext = Awaited<ReturnType<typeof requireAuth>> & { accessToken: string; id: string };

async function requireTeacher(request: NextRequest): Promise<TeacherContext | Response> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) return fail({ code: 'AUTH_REQUIRED', message: '缺少访问令牌', retryable: false }, undefined, 401);
  if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库未配置', retryable: false }, undefined, 503);
  if (!(await isTeacherByWhitelist(user.accessToken))) {
    return fail({ code: 'FORBIDDEN', message: '仅白名单教师可恢复受控病例源文件', retryable: false }, undefined, 403);
  }
  return { ...user, accessToken: user.accessToken, id: user.id };
}

async function readAllSnapshots(accessToken: string) {
  const db = getSupabaseUserClient(accessToken);
  const sourceIds=TEACHER_CASE_CATALOG.filter(item=>item.folder).map(item=>item.id);
  const facts: SnapshotFactsRow[] = [];
  const answers: SnapshotAnswersRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('case_snapshot_facts')
      .select('case_id,version,facts,created_at')
      .in('case_id',sourceIds)
      .order('case_id', { ascending: true })
      .order('version', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as SnapshotFactsRow[];
    facts.push(...rows);
    if (rows.length < pageSize) break;
  }
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('case_snapshot_answers')
      .select('case_id,version,diagnosis,plan,documents,binding_config,created_at')
      .in('case_id',sourceIds)
      .order('case_id', { ascending: true })
      .order('version', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as SnapshotAnswersRow[];
    answers.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { facts, answers };
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireTeacher(request);
    if (gate instanceof Response) return gate;
    let body: { confirmation?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return fail({ code: 'INVALID_REQUEST', message: '请求体无效。', retryable: false }, undefined, 422);
    }
    const download=body.confirmation==='RESTORE_AND_EXPORT_CASE_SOURCES';
    if (body.confirmation !== 'RESTORE_CASE_SOURCES'&&!download) {
      return fail({ code: 'INVALID_REQUEST', message: '缺少受控恢复确认短语。', retryable: false }, undefined, 422);
    }

    const [{ facts, answers }, publication] = await Promise.all([
      readAllSnapshots(gate.accessToken),
      getCasePublicationOverview(gate.accessToken),
    ]);
    const activeVersions = Object.fromEntries(
      publication
        .filter((row) => Boolean(row.activeVersion))
        .map((row) => [row.caseId, row.activeVersion as string]),
    );
    const result = await restoreControlledCaseSources(facts, answers, { activeVersions });
    if (!result.complete) {
      return fail(
        {
          code: 'CASE_SNAPSHOT_RESTORE_INCOMPLETE',
          message: `部分病例缺少可核验快照或存在当前文件冲突（缺失 ${result.missing.length}、冲突 ${result.conflicts.length}、核验版本 ${result.snapshots.verified}）；已写入的版本档案保留，当前文件与清单未替换。${result.conflicts.length ? `冲突：${result.conflicts.slice(0, 3).join('；')}` : ''}`,
          retryable: false,
        },
        undefined,
        409,
      );
    }
    if(download){
      const archive=exportRestoredCaseSources(facts,answers,result);
      return new Response(new Uint8Array(archive.bytes).buffer,{headers:{
        'Content-Type':'application/zip',
        'Content-Disposition':'attachment; filename="peds-verified-case-sources.zip"',
        'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff',
        'X-Content-SHA256':archive.sha256,
        'X-Case-Source-Count':String(archive.sourceCount),
        'X-Case-Version-Count':String(archive.versionCount),
      }});
    }
    return ok(result);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
        : detail.code === 'CASE_SOURCE_INVALID' ? 409 : 500;
    return fail(detail, undefined, status);
  }
}
