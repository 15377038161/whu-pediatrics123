import { APIError, Config, LLMClient, NetworkError, VERSION } from 'coze-coding-dev-sdk';
import type { LLMConfig, Message } from 'coze-coding-dev-sdk';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 600;
const TIMEOUT_SENTINEL = 'COZE_AI_GATEWAY_TIMEOUT';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AIGatewaySettings {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
}

export function getAIGatewaySettings(): AIGatewaySettings {
  return {
    timeoutMs: envInt('COZE_AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxAttempts: envInt('COZE_AI_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS),
    retryBaseMs: envInt('COZE_AI_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS),
  };
}

/**
 * API key 与基础域名默认取平台注入的 COZE_WORKLOAD_IDENTITY_API_KEY /
 * COZE_INTEGRATION_BASE_URL；仅当显式配置 COZE_AI_API_KEY / COZE_AI_BASE_URL 时覆盖。
 */
export function getAIConfig(): Config {
  const apiKey = process.env.COZE_AI_API_KEY?.trim() || undefined;
  const baseUrl = process.env.COZE_AI_BASE_URL?.trim() || undefined;
  return new Config({
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    timeout: getAIGatewaySettings().timeoutMs,
  });
}

export interface AIConfigSummary {
  provider: 'coze_native';
  sdkVersion: string;
  apiKeySource: 'env_override' | 'platform_injected' | 'missing';
  baseUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
}

export function describeAIConfig(): AIConfigSummary {
  const config = getAIConfig();
  const apiKeySource = process.env.COZE_AI_API_KEY?.trim()
    ? 'env_override'
    : process.env.COZE_WORKLOAD_IDENTITY_API_KEY
      ? 'platform_injected'
      : 'missing';
  const { timeoutMs, maxAttempts, retryBaseMs } = getAIGatewaySettings();
  return { provider: 'coze_native', sdkVersion: VERSION, apiKeySource, baseUrl: config.baseUrl || config.modelBaseUrl, timeoutMs, maxAttempts, retryBaseMs };
}

export type AIErrorKind =
  | 'rate_limited'
  | 'timeout'
  | 'auth'
  | 'invalid_request'
  | 'server'
  | 'network'
  | 'config'
  | 'unparsable_response'
  | 'unknown';

export interface AIErrorInfo {
  kind: AIErrorKind;
  retryable: boolean;
  statusCode?: number;
  detail: string;
}

export class AIGatewayError extends Error {
  readonly info: AIErrorInfo;
  readonly attempts: number;

  constructor(info: AIErrorInfo, attempts: number) {
    super(`${info.kind}: ${info.detail}`);
    this.name = 'AIGatewayError';
    this.info = info;
    this.attempts = attempts;
  }
}

function detailOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function retryAfterMsOf(error: unknown): number | null {
  if (!(error instanceof APIError)) return null;
  const headers = (error.response as { headers?: Record<string, unknown> } | undefined)?.headers;
  const raw = headers?.['retry-after'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds * 1000)) : null;
}

export function classifyAIError(error: unknown): AIErrorInfo {
  if (error instanceof AIGatewayError) return error.info;
  if (error instanceof APIError) {
    const status = error.statusCode;
    if (status === 429) return { kind: 'rate_limited', retryable: true, statusCode: status, detail: detailOf(error) };
    if (status === 401 || status === 403) return { kind: 'auth', retryable: false, statusCode: status, detail: detailOf(error) };
    if (status === 408) return { kind: 'timeout', retryable: true, statusCode: status, detail: detailOf(error) };
    if (status !== undefined && status >= 500) return { kind: 'server', retryable: true, statusCode: status, detail: detailOf(error) };
    if (status !== undefined) return { kind: 'invalid_request', retryable: false, statusCode: status, detail: detailOf(error) };
    return { kind: 'server', retryable: true, detail: detailOf(error) };
  }
  if (error instanceof NetworkError) return { kind: 'network', retryable: true, detail: detailOf(error) };
  const detail = detailOf(error);
  if (detail.includes(TIMEOUT_SENTINEL) || /timeout|超时|ECONNABORTED|ETIMEDOUT|ECONNRESET/i.test(detail)) {
    return { kind: 'timeout', retryable: true, detail };
  }
  if (/api key|apikey|configuration/i.test(detail)) return { kind: 'config', retryable: false, detail };
  return { kind: 'unknown', retryable: false, detail };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_SENTINEL)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type AIInvokeFn = (messages: Message[], llmConfig?: LLMConfig) => Promise<{ content: string }>;

export interface InvokeCozeAIOptions {
  messages: Message[];
  llmConfig?: LLMConfig;
  forwardHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
}

export interface InvokeCozeAIResult {
  content: string;
  attempts: number;
}

export interface InvokeCozeAIDeps {
  invoke?: AIInvokeFn;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultInvoke(forwardHeaders?: Record<string, string>): AIInvokeFn {
  const headers = forwardHeaders && Object.keys(forwardHeaders).length > 0 ? forwardHeaders : undefined;
  const client = new LLMClient(getAIConfig(), headers);
  return (messages, llmConfig) => client.invoke(messages, llmConfig);
}

/**
 * 带超时控制与重试的 Coze 原生 AI 调用。
 * 限流(429)/超时/5xx/网络异常按指数退避重试；认证(401/403)与非法请求(4xx)不重试。
 */
export async function invokeCozeAI(options: InvokeCozeAIOptions, deps?: InvokeCozeAIDeps): Promise<InvokeCozeAIResult> {
  const settings = getAIGatewaySettings();
  const timeoutMs = options.timeoutMs ?? settings.timeoutMs;
  const maxAttempts = Math.max(1, options.maxAttempts ?? settings.maxAttempts);
  const retryBaseMs = options.retryBaseMs ?? settings.retryBaseMs;
  const sleep = deps?.sleep ?? defaultSleep;
  const invoke = deps?.invoke ?? defaultInvoke(options.forwardHeaders);

  let lastInfo: AIErrorInfo = { kind: 'unknown', retryable: false, detail: 'no attempt executed' };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(invoke(options.messages, options.llmConfig), timeoutMs);
      return { content: response.content, attempts: attempt };
    } catch (error) {
      lastInfo = classifyAIError(error);
      if (!lastInfo.retryable || attempt === maxAttempts) {
        throw new AIGatewayError(lastInfo, attempt);
      }
      const backoff = retryBaseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * retryBaseMs);
      const retryAfter = retryAfterMsOf(error);
      await sleep(retryAfter !== null ? Math.max(retryAfter, backoff) : backoff);
    }
  }
  throw new AIGatewayError(lastInfo, maxAttempts);
}
