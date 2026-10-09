'use client';

/**
 * 学生学习活跃埋点（客户端）：
 * - 只上报"事件"，时长一律由服务端派生（隐藏页/多标签非当前页/挂机不计入有效时长）；
 * - visibilitychange：隐藏 → visibility_idle（不驱动区间）；恢复可见 → visibility_active；
 * - pagehide（比 unload 可靠，覆盖移动端切后台/关闭标签）：page_leave；
 * - 心跳：页面可见时每 30 秒一次 heartbeat（服务端同标签页 5 秒归并续期）；
 * - 幂等：clientEventId = tabId + 序号，重复上报服务端 on conflict 去重；
 * - 隐私：detail 仅含页面路径，不含患者原文、对话内容、token；
 * - 上报失败静默丢弃（统计埋点不阻塞业务）；预览身份服务端自动跳过入库。
 */

import { authedFetch } from '@/lib/authed-api';

const HEARTBEAT_INTERVAL_MS = 30_000;

type EngagementEventType =
  | 'session_start'
  | 'session_end'
  | 'page_enter'
  | 'page_leave'
  | 'visibility_active'
  | 'visibility_idle'
  | 'heartbeat';

/** 标签页唯一 ID：sessionStorage 内跨页面导航保持（多标签去重依据），8-128 字符约束 */
function getTabId(): string {
  if (typeof window === 'undefined') return 'server-ctx';
  let tabId = window.sessionStorage.getItem('luojia_tab_id');
  if (!tabId) {
    tabId = `tab-${crypto.randomUUID()}`;
    window.sessionStorage.setItem('luojia_tab_id', tabId);
  }
  return tabId;
}

let eventSeq = 0;

function report(eventType: EngagementEventType, sessionId: string | null, detail?: Record<string, string | number | boolean | null>): void {
  if (typeof window === 'undefined') return;
  eventSeq += 1;
  const tabId = getTabId();
  const clientEventId = `${tabId}-${eventType}-${eventSeq}-${Math.floor(performance.now())}`;
  void authedFetch('/api/engagement', {
    method: 'POST',
    body: JSON.stringify({ eventType, sessionId, clientEventId, tabId, detail: detail ?? {} }),
  }).catch(() => {
    // 埋点失败静默丢弃：统计不阻塞业务，不重试（下次心跳/事件自然补齐活跃状态）
  });
}

/** 页面级活跃追踪（学生端布局挂载）：进入/离开/前后台切换 + 可见心跳 */
export function startPageEngagement(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  report('page_enter', null, { path: window.location.pathname });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const startHeartbeat = () => {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') report('heartbeat', null, { path: window.location.pathname });
    }, HEARTBEAT_INTERVAL_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      report('visibility_active', null, { path: window.location.pathname });
      startHeartbeat();
    } else {
      report('visibility_idle', null, { path: window.location.pathname });
      stopHeartbeat();
    }
  };
  const onPageHide = () => {
    report('page_leave', null, { path: window.location.pathname });
    stopHeartbeat();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  startHeartbeat();

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    stopHeartbeat();
    report('page_leave', null, { path: window.location.pathname });
  };
}

/** 训练会话级事件（训练页挂载/结束时调用） */
export function reportSessionEvent(eventType: 'session_start' | 'session_end', sessionId: string): void {
  report(eventType, sessionId, { path: typeof window === 'undefined' ? '' : window.location.pathname });
}
