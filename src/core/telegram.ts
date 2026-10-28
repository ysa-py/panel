/** Optional, one-way Telegram notifications. No Telegram command can mutate NYX. */
import { Env, GzError } from '../config';
import { ensureSchema } from '../db/store';
import { isUserAllowed, listUsers } from '../db/users';

function configured(env: Env): boolean {
  return /^\d{5,16}:[A-Za-z0-9_-]{30,100}$/.test(env.NYX_TELEGRAM_BOT_TOKEN || '') &&
    /^-?\d{1,20}$/.test(env.NYX_TELEGRAM_CHAT_ID || '');
}

export function telegramStatus(env: Env): { configured: boolean; dailyReport: boolean } {
  return { configured: configured(env), dailyReport: env.NYX_TELEGRAM_DAILY_REPORT === 'true' };
}

export async function sendTelegram(
  env: Env,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!configured(env)) throw new GzError('telegram_not_configured', 'unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // The token occurs in Telegram's required URL. Never log the URL, response,
    // exception, request or environment; reject redirects to avoid leaking it.
    const response = await fetcher('https://api.telegram.org/bot' + env.NYX_TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.NYX_TELEGRAM_CHAT_ID, text: text.slice(0, 2000), disable_notification: true }),
    });
    if (!response.ok) throw new Error('provider request failed');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) throw new Error('invalid response');
  } catch {
    throw new GzError('telegram_delivery_failed', 'unavailable');
  } finally { clearTimeout(timer); }
}

/** One attempt per UTC day, reserved atomically in D1. Disabled by default. */
export async function sendDailyTelegramReport(env: Env, scheduledAt = Date.now()): Promise<'disabled' | 'duplicate' | 'sent' | 'failed'> {
  if (env.NYX_TELEGRAM_DAILY_REPORT !== 'true' || !env.GZ_DB || !configured(env)) return 'disabled';
  const db = env.GZ_DB;
  await ensureSchema(db);
  await db.prepare('CREATE TABLE IF NOT EXISTS nyx_telegram_daily (day TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  const day = new Date(scheduledAt).toISOString().slice(0, 10);
  const reserved = await db.prepare(
    "INSERT OR IGNORE INTO nyx_telegram_daily (day, status, updated_at) VALUES (?1, 'reserved', ?2) RETURNING day",
  ).bind(day, Date.now()).first<{ day: string }>();
  if (!reserved) return 'duplicate';
  let status: 'sent' | 'failed' = 'failed';
  try {
    const users = await listUsers(db);
    const allowed = users.filter((u) => isUserAllowed(u).ok).length;
    const bytes = users.reduce((sum, u) => sum + u.usedUp + u.usedDown, 0);
    await sendTelegram(env, `NYX daily report (UTC ${day})\nStored users: ${users.length}\nAllowed at snapshot: ${allowed}\nRecorded bytes: ${bytes}\nCounters are best-effort, not provider billing.`);
    status = 'sent';
  } catch { /* No token, user details or provider errors are logged. */ }
  await db.prepare('UPDATE nyx_telegram_daily SET status = ?1, updated_at = ?2 WHERE day = ?3')
    .bind(status, Date.now(), day).run();
  return status;
}
