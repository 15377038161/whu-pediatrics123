// 统一的确定性日期格式化工具。
// 目标：消除 SSR 与客户端水合差异（React #418 / #423）。
// 原因：new Date(...).toLocaleString('zh-CN') 在服务端（通常 UTC）与浏览器（本地时区）
// 会产出不同字符串，导致服务端渲染的 HTML 与客户端首次渲染不一致。
// 解决：显式指定 timeZone 与完整选项，保证两端输出完全一致。
// 注意：禁止在组件内直接调用 toLocaleString / toLocaleDateString / toLocaleTimeString。

const TZ = 'Asia/Shanghai';

function format(value: string | number | Date, options: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return '—';
  return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: TZ }).format(time);
}

/** 完整时间：2026/10/9 09:30:05（固定 Asia/Shanghai，SSR/CSR 一致） */
export function formatDateTime(value: string | number | Date): string {
  return format(value, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '/').replace(',', '');
}

/** 仅日期：2026/10/9（固定 Asia/Shanghai，SSR/CSR 一致） */
export function formatDate(value: string | number | Date): string {
  return format(value, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** 仅时间：09:30:05（固定 Asia/Shanghai，SSR/CSR 一致） */
export function formatTime(value: string | number | Date): string {
  return format(value, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '');
}
