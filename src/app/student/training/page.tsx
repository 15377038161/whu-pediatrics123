import type { SessionMode } from '@/domain/agent';
import { TrainingWorkspace } from '@/components/training-workspace';
import { requirePageUser } from '@/lib/page-auth';

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ mode?: string; session?: string }> }) {
  await requirePageUser('student');
  const query = await searchParams;
  const mode: SessionMode = query.mode === 'osce' ? 'osce' : query.mode === 'practice' ? 'practice' : 'guided';
  return <TrainingWorkspace mode={mode} initialSessionId={query.session} />;
}
