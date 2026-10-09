import type { PracticeFocus, SessionMode } from '@/domain/agent';
import { TrainingWorkspace } from '@/components/training-workspace';

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ mode?: string; session?: string; case?: string; focus?: string }> }) {
  const query = await searchParams;
  const mode: SessionMode = query.mode === 'osce' ? 'osce' : query.mode === 'practice' ? 'practice' : query.mode === 'immersive' ? 'immersive' : 'guided';
  const focus: PracticeFocus | undefined = ['history', 'exam', 'safety', 'communication'].includes(query.focus ?? '')
    ? query.focus as PracticeFocus
    : undefined;
  return <TrainingWorkspace mode={mode} initialSessionId={query.session} initialCaseId={query.case} practiceFocus={focus} />;
}
