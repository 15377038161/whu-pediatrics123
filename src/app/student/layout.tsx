import { GatedAppShell } from '@/components/auth-gate';
import { StudentEngagement } from '@/components/student-engagement';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <GatedAppShell role="student">
      {/* 使用统计埋点：学生端页面活跃事件（服务端真实身份+时间+幂等落库） */}
      <StudentEngagement />
      {children}
    </GatedAppShell>
  );
}
