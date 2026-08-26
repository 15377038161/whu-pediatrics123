const TOKEN_URL = 'https://auth.chaoxing.com/sns/oauth2/access_token/v1.0';
const USER_URL = 'https://v1.chaoxing.com/backSchool/user/getUserByTokenFormMooc';

export interface ChaoxingRole {
  roleId: string;
  roleName: string;
}

export interface ChaoxingIdentity {
  openid: string;
  uid: string;
  name: string;
  displayName: string;
  studentNo: string;
  fid: string;
  orgName: string;
  role: ChaoxingRole[];
  loginNames: string[];
  avatar: string;
}

export type ChaoxingLoginErrorReason = 'config_missing' | 'institution_mismatch' | 'oauth_failed';

export class ChaoxingLoginError extends Error {
  constructor(readonly reason: ChaoxingLoginErrorReason, message: string) {
    super(message);
    this.name = 'ChaoxingLoginError';
  }
}

interface Institution { fid: string; name: string }
interface Config { appid: string; secret: string; redirectUri: string; institutions: Institution[] }
interface Token { accessToken: string; openid: string; expiresTime: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function stringValue(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function parseInstitutions(raw: string): Institution[] {
  const values = new Map<string, Institution>();
  for (const item of raw.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = item.indexOf(':');
    const fid = (separator < 0 ? item : item.slice(0, separator)).trim();
    const name = separator < 0 ? fid : item.slice(separator + 1).trim() || fid;
    if (fid && !values.has(fid)) values.set(fid, { fid, name });
  }
  return [...values.values()];
}

function getRedirectUri(): string {
  // Priority 1: Explicit CHAOXING_REDIRECT_URI (for custom domains)
  const explicit = process.env.CHAOXING_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  // Priority 2: Build from COZE_PROJECT_DOMAIN_DEFAULT (production)
  const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (domain) {
    const base = domain.startsWith('http') ? domain : `https://${domain}`;
    return `${base}/api/auth/callback/chaoxing`;
  }

  // Priority 3: Fallback (should not happen in production)
  throw new Error('无法确定回调地址：CHAOXING_REDIRECT_URI 和 COZE_PROJECT_DOMAIN_DEFAULT 都未配置');
}

function config(): Config {
  const appid = process.env.CHAOXING_APPID?.trim() ?? '';
  const secret = process.env.CHAOXING_SECRET?.trim() ?? '';
  const redirectUri = getRedirectUri();
  const institutions = parseInstitutions(process.env.CHAOXING_FIDS ?? '');
  if (!appid || !secret || !redirectUri || institutions.length === 0) {
    throw new ChaoxingLoginError('config_missing', '超星OAuth配置不完整');
  }
  return { appid, secret, redirectUri, institutions };
}

export function isChaoxingConfigured(): boolean {
  try { config(); return process.env.ENABLE_CHAOXING_AUTH === 'true'; } catch { return false; }
}

export function getChaoxingLoginOptions(): { configured: boolean; institutions: Institution[] } {
  try {
    const { institutions } = config();
    return { configured: process.env.ENABLE_CHAOXING_AUTH === 'true', institutions: institutions.length > 1 ? institutions : [] };
  } catch {
    return { configured: false, institutions: [] };
  }
}

export function getChaoxingAuthorizationConfig(requestedFid: string | null): { appid: string; redirectUri: string; stateFid: string } {
  const { appid, redirectUri, institutions } = config();
  const requested = requestedFid?.trim();
  if (requested && !institutions.some((item) => item.fid === requested)) {
    throw new ChaoxingLoginError('institution_mismatch', '请求机构不在允许列表中');
  }
  if (!requested && institutions.length > 1) {
    throw new ChaoxingLoginError('institution_mismatch', '必须选择登录机构');
  }
  return { appid, redirectUri, stateFid: requested || institutions[0].fid };
}

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ChaoxingLoginError('oauth_failed', `超星返回非JSON响应（HTTP ${response.status}）`); }
  const record = asRecord(value);
  if (!response.ok || !record) throw new ChaoxingLoginError('oauth_failed', `超星接口请求失败（HTTP ${response.status}）`);
  return record;
}

async function exchangeCode(code: string): Promise<Token> {
  const { appid, secret } = config();
  const raw = await postForm(TOKEN_URL, new URLSearchParams({ appid, secret, code, grant_type: 'authorization_code' }));
  const accessToken = stringValue(raw, ['access_token']);
  const openid = stringValue(raw, ['openid']);
  const expiresTime = stringValue(raw, ['expires_time']);
  if (!accessToken || !openid || !expiresTime) {
    throw new ChaoxingLoginError('oauth_failed', stringValue(raw, ['describe', 'errmsg', 'msg']) || '超星未返回完整令牌');
  }
  return { accessToken, openid, expiresTime };
}

function roles(value: unknown): ChaoxingRole[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChaoxingRole[] => {
    const role = asRecord(entry);
    if (!role) return [];
    const roleId = stringValue(role, ['roleId']);
    const roleName = stringValue(role, ['roleName']);
    return roleId || roleName ? [{ roleId, roleName }] : [];
  });
}

async function identityFor(token: Token, institution: Institution): Promise<ChaoxingIdentity | null> {
  const raw = await postForm(USER_URL, new URLSearchParams({
    access_token: token.accessToken,
    openid: token.openid,
    expires_time: token.expiresTime,
    state: institution.fid,
  }));
  if (raw.status === false) return null;
  const user = asRecord(raw.userInfo);
  if (!user) return null;
  const uid = stringValue(user, ['uid', 'puid', 'id']);
  if (!uid) return null;
  const providerFid = stringValue(user, ['fid']);
  if (providerFid && providerFid !== institution.fid) return null;
  const loginNames = Array.isArray(user.loginNames) ? user.loginNames.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const name = stringValue(user, ['name', 'realname', 'displayName']) || uid;
  const studentNo = stringValue(user, ['studentcode', 'studentCode', 'workNumber', 'username']) || loginNames[0] || '';
  return {
    openid: token.openid,
    uid,
    name,
    displayName: stringValue(user, ['displayName', 'realname']) || name || uid,
    studentNo,
    fid: providerFid || institution.fid,
    orgName: stringValue(user, ['orgName', 'schoolname']) || institution.name,
    role: roles(user.role),
    loginNames,
    avatar: `https://photo.chaoxing.com/p/${encodeURIComponent(uid)}_80`,
  };
}

export async function resolveChaoxingIdentity(code: string, callbackFid: string): Promise<ChaoxingIdentity> {
  const { institutions } = config();
  const selected = institutions.find((item) => item.fid === callbackFid);
  if (!selected) throw new ChaoxingLoginError('institution_mismatch', '回调机构不在允许列表中');
  const candidates = [selected, ...institutions.filter((item) => item.fid !== selected.fid)];
  const token = await exchangeCode(code);
  for (const institution of candidates) {
    const identity = await identityFor(token, institution);
    if (identity) return identity;
  }
  throw new ChaoxingLoginError('institution_mismatch', '账号不属于允许登录的机构');
}
