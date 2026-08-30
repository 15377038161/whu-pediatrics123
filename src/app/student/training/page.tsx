import type { PracticeFocus, SessionMode } from '@/domain/agent';
import { TrainingWorkspace } from '@/components/training-workspace';
import { requirePageUser } from '@/lib/page-auth';

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ mode?: string; session?: string; case?: string; focus?: string }> }) {
  await requirePageUser('student');
  const query = await searchParams;
  const mode: SessionMode = query.mode === 'osce' ? 'osce' : query.mode === 'practice' ? 'practice' : 'guided';
  const focus: PracticeFocus | undefined = ['history', 'exam', 'safety', 'communication'].includes(query.focus ?? '')
    ? query.focus as PracticeFocus
    : undefined;
  return <TrainingWorkspace mode={mode} initialSessionId={query.session} initialCaseId={query.case} practiceFocus={focus} />;
}
