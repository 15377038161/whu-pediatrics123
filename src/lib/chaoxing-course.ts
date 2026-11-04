/**
 * 学习通课程直达入口仅接受管理员配置的 HTTPS URL。
 * 未配置、格式错误或带用户名/密码时返回 null，页面不渲染伪入口。
 */
export function parseChaoxingCourseUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
