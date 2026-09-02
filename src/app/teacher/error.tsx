'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function TeacherError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="workspace-error" role="alert">
      <span className="workspace-error-icon" aria-hidden="true"><TriangleAlert /></span>
      <p className="eyebrow">教师工作台暂未加载完成</p>
      <h1>学情数据连接出现异常</h1>
      <p>你的教师身份和双端切换仍然有效。可以重新加载学情数据，或先返回学生端继续演示。</p>
      <div className="form-actions">
        <button className="btn btn-primary" type="button" onClick={reset}><RefreshCw size={16} /> 重新加载</button>
        <a className="btn btn-secondary" href="/student">返回学生端</a>
      </div>
    </section>
  );
}
