import { notFound } from 'next/navigation';
import { ReportView } from '@/components/report-view';
import { AgentRepository } from '@/lib/repository';
import { requirePageUser } from '@/lib/page-auth';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser('student');
  let report;
  try {
    report = await new AgentRepository(user).getReport((await params).id);
  } catch { notFound(); }
  return <ReportView report={report} />;
}
