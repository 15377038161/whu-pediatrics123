'use client';

/**
 * 登录入口意图（客户端辅助）：
 * - 仅记录用户在起始页选择的入口（教师端/学生端），作为登录后的落点意图；
 * - 绝不作为授权依据：角色一律由服务端 /api/auth/me 按真实身份
 *   （超星白名单 isTeacherIdentityAllowed / app_metadata）判定，与入口选择无关；
 * - 意图存 sessionStorage 并带 10 分钟 TTL，跨 OAuth 跳转（同标签页）存活，
 *   过期或缺失时回退为按实际角色路由（原 LoginSelfHeal 行为）。
 */

export type EntryRole = 'teacher' | 'student';

export interface LoginEntry {
  role: EntryRole;
  ts: number;
}

const ENTRY_KEY = 'luojia_login_entry';
const ENTRY_TTL_MS = 10 * 60 * 1000;

export function setLoginEntry(role: EntryRole): void {
  try {
    sessionStorage.setItem(ENTRY_KEY, JSON.stringify({ role, ts: Date.now() }));
  } catch {
    // sessionStorage 不可用不阻断登录流程
  }
}

/** 读取未过期的入口意图（不清除，denied 提示需幂等重现）。 */
export function readLoginEntry(): LoginEntry | null {
  try {
    const raw = sessionStorage.getItem(ENTRY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LoginEntry>;
    if (parsed.role !== 'teacher' && parsed.role !== 'student') return null;
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > ENTRY_TTL_MS) return null;
    return { role: parsed.role, ts: parsed.ts };
  } catch {
    return null;
  }
}

export function clearLoginEntry(): void {
  try {
    sessionStorage.removeItem(ENTRY_KEY);
  } catch {
    // 忽略
  }
}

export interface LoginRouting {
  /** 登录成功后的落点路径。denied 时无 path。 */
  path?: string;
  /** 入口意图与真实身份冲突（学生身份从教师端入口进入）：拒绝进入教师端，由 UI 引导。 */
  denied?: boolean;
}

/**
 * 登录成功后的落点决策：入口只影响落点与拒绝提示，不改变角色本身。
 * - 教师身份 + 教师端入口 → /teacher
 * - 教师身份 + 学生端入口 → /student（教师可访问学生视图，与 canAccessRole 一致）
 * - 学生身份 + 教师端入口 → denied（UI 提示改走学生端入口；教师页面另有服务端守卫兜底）
 * - 学生身份 + 学生端入口 → /student
 * - 无入口意图（直接访问/OAuth 回跳过期）→ 按实际角色路由
 */
export function routeAfterLogin(role: string, entry: LoginEntry | null): LoginRouting {
  const isTeacher = role === 'teacher';
  if (entry?.role === 'teacher') return isTeacher ? { path: '/teacher' } : { denied: true };
  if (entry?.role === 'student') return { path: '/student' };
  return { path: isTeacher ? '/teacher' : '/student' };
}

/** Supabase Auth 错误信息中文化（不透传原始英文与内部细节给用户）。 */
export function translateAuthError(message: string | undefined): string {
  const text = (message || '').toLowerCase();
  if (text.includes('invalid login credentials')) return '邮箱或密码错误';
  if (text.includes('email not confirmed')) return '邮箱尚未验证，请先完成邮箱验证';
  if (text.includes('too many requests')) return '尝试过于频繁，请稍后再试';
  if (text.includes('fetch') || text.includes('network')) return '网络异常，请检查网络后重试';
  return '登录失败，请稍后重试';
}
