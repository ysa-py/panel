import { Env, GzError, VERSION } from '../config';
import { EffectiveSettings } from '../settings';
import { requireAuth } from '../auth';
import { listUsers, isUserAllowed } from '../db/users';
import { jsonResponse, isSameOriginMutation, readJsonObject } from '../core/http';
import { providerCapabilities } from '../core/providers';
import { aiUsage, allowedModels, dailyAiLimit, discoverWorkersModels, ruleBasedAdvice, runWorkersAi } from '../core/ai';
import { authorizedProbeUrls, probeAuthorizedUrl, rankObservations } from '../core/resilience';
import { sendTelegram, telegramStatus } from '../core/telegram';

async function ensureProbes(db: D1Database): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS nyx_probe_history (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL, checked_at INTEGER NOT NULL, ' +
    'latency_ms INTEGER NOT NULL, http_status INTEGER, success INTEGER NOT NULL)').run();
}

export async function handleConsoleApi(request: Request, env: Env, eff: EffectiveSettings, action: string): Promise<Response> {
  try {
    if (!isSameOriginMutation(request)) return jsonResponse({ error: 'same_origin_json_required' }, 403);
    await requireAuth(request, eff);
    const db = env.GZ_DB;
    if (!db) throw new GzError('database_not_bound', 'no_db');
    if (action === 'overview' && request.method === 'GET') {
      const users = await listUsers(db);
      return jsonResponse({
        version: VERSION,
        users: { total: users.length, allowed: users.filter((u) => isUserAllowed(u).ok).length,
          recordedBytes: users.reduce((sum, u) => sum + u.usedUp + u.usedDown, 0) },
        storage: 'D1', dataLabel: 'stored counters; not a real-time or billing-grade meter',
        costUsage: 'unavailable',
      });
    }
    if (action === 'providers' && request.method === 'GET') return jsonResponse({ providers: providerCapabilities() });
    if (action === 'notifications' && request.method === 'GET') return jsonResponse({ telegram: telegramStatus(env),
      note: 'Outbound notifications only. No Telegram commands or automated sales are supported.' });
    if (action === 'notifications/test' && request.method === 'POST') {
      // No caller-provided recipient or message, so this cannot become a message relay.
      await sendTelegram(env, 'NYX test notification: your configured outbound channel is reachable. No credentials are included.');
      return jsonResponse({ ok: true });
    }
    if (action === 'ai' && request.method === 'GET') {
      return jsonResponse({
        enabled: env.NYX_AI_ENABLED === 'true' && !!env.AI,
        catalogConfigured: !!env.NYX_CF_ACCOUNT_ID && !!env.NYX_CF_AI_READ_TOKEN,
        allowlist: allowedModels(env.NYX_AI_MODEL_ALLOWLIST),
        usage: await aiUsage(db, dailyAiLimit(env.NYX_AI_DAILY_LIMIT)),
        cost: 'Provider billing and token prices unavailable; inspect your provider dashboard.',
      });
    }
    if (action === 'ai/models' && request.method === 'GET') return jsonResponse(await discoverWorkersModels(env));
    if (action === 'ai/ask' && request.method === 'POST') {
      const body = await readJsonObject(request, 8192);
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2048) {
        throw new GzError('invalid_prompt', 'validation');
      }
      if (body.mode === 'rules') return jsonResponse({ provider: 'rules', fallback: false, text: ruleBasedAdvice(body.prompt) });
      if (body.mode !== 'workers-ai' || typeof body.model !== 'string') throw new GzError('invalid_mode_or_model', 'validation');
      try { return jsonResponse({ ...(await runWorkersAi(env, body.model, body.prompt.trim())), fallback: false }); }
      catch (error) {
        if (error instanceof GzError && (error.code === 'unavailable' || error.code === 'rate_limit')) {
          return jsonResponse({ provider: 'rules', fallback: true, reason: error.message, text: ruleBasedAdvice(body.prompt) });
        }
        throw error;
      }
    }
    if (action === 'diagnostics' && request.method === 'GET') {
      await ensureProbes(db);
      const targets = authorizedProbeUrls(env.NYX_PROBE_URLS);
      const result = await db.prepare(
        'SELECT endpoint, SUM(success) AS successes, COUNT(*) AS samples, ' +
        'AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) AS averageMs ' +
        'FROM nyx_probe_history WHERE checked_at >= ?1 GROUP BY endpoint',
      ).bind(Date.now() - 24 * 3600 * 1000).all<{ endpoint: string; successes: number; samples: number; averageMs: number | null }>();
      const observations = (result.results ?? []).filter((r) => targets.includes(r.endpoint));
      return jsonResponse({ targets, ranked: rankObservations(observations),
        note: 'Observed from this edge runtime only. This is not an ISP or anti-DPI measurement.' });
    }
    if (action === 'diagnostics' && request.method === 'POST') {
      const body = await readJsonObject(request, 4096);
      const targets = authorizedProbeUrls(env.NYX_PROBE_URLS);
      if (typeof body.target !== 'string' || !targets.includes(body.target)) throw new GzError('target_not_authorized', 'validation');
      await ensureProbes(db);
      const result = await probeAuthorizedUrl(body.target, targets);
      await db.prepare('INSERT INTO nyx_probe_history (endpoint, checked_at, latency_ms, http_status, success) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(body.target, result.checkedAt, result.latencyMs, result.status, result.success ? 1 : 0).run();
      return jsonResponse({ target: body.target, ...result });
    }
    return jsonResponse({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof GzError) {
      const status = error.code === 'unauthorized' ? 401 : error.code === 'validation' ? 400 :
        error.code === 'rate_limit' ? 429 : 503;
      return jsonResponse({ error: error.message }, status);
    }
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}
