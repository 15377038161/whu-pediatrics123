import { PRACTICE_FOCUS_VALUES, type PracticeFocus, type SessionMode } from '@/domain/agent';
import { TrainingWorkspace } from '@/components/training-workspace';

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ mode?: string; session?: string; case?: string; focus?: string; panel?: string }> }) {
  const query = await searchParams;
  const mode: SessionMode = query.mode === 'osce' ? 'osce' : query.mode === 'practice' ? 'practice' : query.mode === 'immersive' ? 'immersive' : 'guided';
  const focus: PracticeFocus | undefined = PRACTICE_FOCUS_VALUES.find((value) => value === query.focus);
  return <TrainingWorkspace mode={mode} initialSessionId={query.session} initialCaseId={query.case} practiceFocus={focus} initialPanel={query.panel==='note'?'note':undefined} />;
}
