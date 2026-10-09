'use client';

/**
 * 学生端页面活跃埋点（学生布局挂载一次）：
 * 进入/离开/前后台切换/心跳 → /api/engagement（服务端真实身份+时间+幂等）。
 * 仅学生端挂载：教师端访问学生视图时不重复计学生的有效时长。
 */

import { useEffect } from 'react';
import { startPageEngagement } from '@/lib/engagement-tracker';

export function StudentEngagement() {
  useEffect(() => startPageEngagement(), []);
  return null;
}
