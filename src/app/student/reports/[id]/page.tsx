'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { ReportView } from '@/components/report-view';
import type { TrainingReport } from '@/domain/agent';
import { authedFetch, AuthedApiError } from '@/lib/authed-api';

/**
 * 报告详情（客户端化）：数据经 authedFetch，未登录直接 401 回登录页。
 */
export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const [state, setState] = useState<{ report?: TrainingReport; error?: string }>({});

  useEffect(() => {
    let cancelled = false;
    params
      .then(({ id }) => authedFetch<TrainingReport>(`/api/reports/${encodeURIComponent(id)}`))
      .then((report) => {
        if (!cancelled) setState({ report });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof AuthedApiError && reason.code === 'REPORT_NOT_FOUND') notFound();
        setState({ error: reason instanceof Error ? reason.message : '报告读取失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (state.error) {
    return <div className="empty-state" role="alert"><p>{state.error}</p></div>;
  }
  if (!state.report) {
    return <div className="empty-state" role="status"><p>正在读取报告…</p></div>;
  }
  return <ReportView report={state.report} />;
}
