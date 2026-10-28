/**
 * Gozargah — global config, types and shared errors.
 */

export const VERSION = '0.1.0';
export const SCHEMA_VERSION = 2;

/** D1 binding name (see wrangler.toml) */
export const DB_BINDING = 'GZ_DB';

export interface Env {
  /** D1 is required for operational routes; missing bindings fail closed. */
  GZ_DB?: D1Database;
  /** Bootstrap only; set with the provider's secret manager. */
  NYX_BOOTSTRAP_PASSWORD?: string;
  NYX_AI_ENABLED?: string;
  NYX_AI_DAILY_LIMIT?: string;
  NYX_CF_ACCOUNT_ID?: string;
  NYX_CF_AI_READ_TOKEN?: string;
  NYX_AI_MODEL_ALLOWLIST?: string;
  NYX_PROBE_URLS?: string;
  /** Telegram is opt-in and uses a single configured outbound chat only. */
  NYX_TELEGRAM_BOT_TOKEN?: string;
  NYX_TELEGRAM_CHAT_ID?: string;
  NYX_TELEGRAM_DAILY_REPORT?: string;
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
}

/** Error type carrying a short machine code for the panel API. */
export class GzError extends Error {
  code: string;
  constructor(message: string, code = 'gz_error') {
    super(message);
    this.name = 'GzError';
    this.code = code;
  }
}

/** Shared default values (used before the admin saves settings). */
export const DEFAULTS = {
  panelPath: 'panel',
  subPath: 'sub',
  /** No third-party fallback endpoints without explicit operator configuration. */
  proxyIPs: [] as string[],
  pwIterations: 150_000,
  sessionTtlMs: 12 * 3600 * 1000,
  loginWindowMs: 15 * 60 * 1000,
  loginMaxAttempts: 5,
  /** settings/users cache TTL inside an isolate */
  cacheTtlMs: 10_000,
  /** flush accumulated per-user byte counters to D1 when above these */
  usageFlushBytes: 512 * 1024,
  usageFlushUsers: 8,
  usageFlushIntervalMs: 30_000,
  /** rolling quota-reset windows (ms) — user.resetAnchor + window */
  resetCycleMs: { daily: 86_400_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 },
} as const;

export type ResetCycle = 'none' | 'daily' | 'weekly' | 'monthly';

export function resetCycleMs(cycle: ResetCycle): number {
  if (cycle === 'daily') return DEFAULTS.resetCycleMs.daily;
  if (cycle === 'weekly') return DEFAULTS.resetCycleMs.weekly;
  if (cycle === 'monthly') return DEFAULTS.resetCycleMs.monthly;
  return 0;
}
