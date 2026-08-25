import { NextRequest } from 'next/server';
import type { SyncEventV1 } from '@/domain/agent';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { runAgentTurn } from '@/lib/agent-engine';
import { AgentRepository } from '@/lib/repository';
import { requireUser } from '@/lib/request-auth';
import { buildReport } from '@/lib/scoring';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request, 'student');
    const { id } = await context.params;
    const repository = new AgentRepository(user);
    const session = await repository.getSession(id);
    if (session.reportId) return ok(await repository.getReport(session.reportId));
    if (session.status === 'active') await runAgentTurn(session, { type: 'FINISH_SESSION', data: {} }, `finish-${session.id}`);
    const report = buildReport(session, session.id);
    session.reportId = report.id;
    session.status = 'completed';
    session.stage = 'report';
    session.updatedAt = new Date().toISOString();
    const event: SyncEventV1 = {
      schemaVersion: 1,
      eventId: `report-${report.id}`,
      recordType: 'learning_report',
      student: { userId: user.id, studentNo: user.studentNo, displayName: user.displayName },
      case: { caseId: session.caseId, caseVersion: session.caseVersion, sessionId: session.id, mode: session.mode, stage: 'report' },
      studentInput: session.decision?.summary ?? null,
      agentFeedback: report.recommendation,
      score: report.totalScore,
      evidenceSummary: report.evidence.map((item) => `${item.label}:${item.score}/${item.maxScore}`).join('；'),
      finalReport: JSON.stringify(report),
      submittedAt: report.createdAt,
    };
    await repository.saveReport(report, event);
    await repository.saveSession(session);
    return ok(report, undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' ? 404 : 500;
    return fail(detail, undefined, status);
  }
}
