import { describe, expect, it, vi } from 'vitest';
import { authorizedProbeUrls, probeAuthorizedUrl, rankObservations } from '../src/core/resilience';
import { allowedModels, dailyAiLimit, discoverWorkersModels, ruleBasedAdvice } from '../src/core/ai';
import { applySecurityHeaders, isSameOriginMutation, readJsonObject } from '../src/core/http';

describe('authorized diagnostics', () => {
  it('accepts only operator-configured public HTTPS names without credentials or query strings', () => {
    const list = authorizedProbeUrls('https://edge.example/healthz, http://edge.example,https://127.0.0.1/,https://localhost/,https://edge.example/?token=x,https://user:pass@edge.example/,https://[::1]/,https://edge.example:8443/');
    expect(list).toEqual(['https://edge.example/healthz']);
  });
  it('never fetches an unapproved target and never follows redirects', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://another.example/' } })) as unknown as typeof fetch;
    await expect(probeAuthorizedUrl('https://other.example/', ['https://edge.example/'], fetcher)).rejects.toThrow('target_not_authorized');
    expect(fetcher).not.toHaveBeenCalled();
    const result = await probeAuthorizedUrl('https://edge.example/', ['https://edge.example/'], fetcher);
    expect(result).toMatchObject({ success: false, status: 302 });
    expect(fetcher).toHaveBeenCalledWith('https://edge.example/', expect.objectContaining({ redirect: 'manual' }));
  });
  it('scores only measured observations and breaks ties deterministically', () => {
    const rows = rankObservations([
      { endpoint: 'b', samples: 4, successes: 2, averageMs: 5 },
      { endpoint: 'c', samples: 0, successes: 0, averageMs: null },
      { endpoint: 'a', samples: 4, successes: 4, averageMs: 100 },
    ]);
    expect(rows.map((x) => x.endpoint)).toEqual(['a', 'b']);
    expect(rows[0].score).toBe(990);
  });
});

describe('AI privacy and fallback', () => {
  it('requires explicit model allowlisting and bounds the daily limit', () => {
    expect(allowedModels('@cf/a/model,https://invalid,@cf/a/model,@hf/b/model')).toEqual(['@cf/a/model', '@hf/b/model']);
    expect(dailyAiLimit('3')).toBe(3); expect(dailyAiLimit('0')).toBe(5); expect(dailyAiLimit('999')).toBe(5);
    expect(ruleBasedAdvice('quota reached')).toMatch(/billing/);
  });
  it('reports discovery unconfigured instead of inventing models', async () => {
    const result = await discoverWorkersModels({});
    expect(result.status).toBe('unconfigured'); expect(result.models).toEqual([]);
  });
  it('fetches, deduplicates and caches a live-shaped catalog without returning a token', async () => {
    const token = 'test-only-dummy-read-token';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, result: [
      { name: '@cf/example/model', description: 'text model' }, { name: '@cf/example/model' }, { name: 'invalid' },
    ], result_info: { total_pages: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const env = { NYX_CF_ACCOUNT_ID: 'a'.repeat(32), NYX_CF_AI_READ_TOKEN: token, NYX_AI_MODEL_ALLOWLIST: '@cf/example/model' };
    const first = await discoverWorkersModels(env, fetcher); const cached = await discoverWorkersModels(env, fetcher);
    expect(first.status).toBe('available'); expect(first.models).toHaveLength(1); expect(first.models[0].allowed).toBe(true);
    expect(cached.cached).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.stringify(first)).not.toContain(token);
  });
  it('returns an unavailable state for provider errors', async () => {
    const result = await discoverWorkersModels({ NYX_CF_ACCOUNT_ID: 'b'.repeat(32), NYX_CF_AI_READ_TOKEN: 'dummy' }, (async () => new Response('', { status: 401 })) as typeof fetch);
    expect(result.status).toBe('unavailable'); expect(result.models).toEqual([]);
  });
});

describe('HTTP defenses', () => {
  it('enforces same-origin JSON on mutations including login', () => {
    const good = new Request('https://example.test/api', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' } });
    const bad = new Request('https://example.test/api', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' } });
    expect(isSameOriginMutation(good)).toBe(true); expect(isSameOriginMutation(bad)).toBe(false);
  });
  it('rejects oversized and malformed JSON bodies', async () => {
    await expect(readJsonObject(new Request('https://example.test/', { method:'POST', body:'{"x":"' + 'a'.repeat(100) + '"}' }), 32)).rejects.toThrow('body_too_large');
    await expect(readJsonObject(new Request('https://example.test/', { method:'POST', body:'[]' }))).rejects.toThrow('invalid_json');
  });
  it('sets security headers', () => {
    const r = applySecurityHeaders(new Response('ok')); expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('one-way Telegram notifications', () => {
  it('requires a configured token and a numeric fixed chat; it never accepts a caller-provided recipient', async () => {
    const { telegramStatus, sendTelegram } = await import('../src/core/telegram');
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(telegramStatus({}).configured).toBe(false);
    await expect(sendTelegram({}, 'test', fetcher)).rejects.toThrow('telegram_not_configured');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends only to the configured Telegram API, rejects redirects, and never returns a secret in errors', async () => {
    const { telegramStatus, sendTelegram } = await import('../src/core/telegram');
    const token = '123456:' + 'x'.repeat(36);
    const env = { NYX_TELEGRAM_BOT_TOKEN: token, NYX_TELEGRAM_CHAT_ID: '-100123456', NYX_TELEGRAM_DAILY_REPORT: 'true' };
    const fetcher = vi.fn(async () => new Response('{"ok":true}')) as unknown as typeof fetch;
    await sendTelegram(env, 'test message', fetcher);
    expect(telegramStatus(env)).toEqual({ configured: true, dailyReport: true });
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(String(call[0])).toMatch(/^https:\/\/api\.telegram\.org\/bot/);
    expect(call[1]).toMatchObject({ method: 'POST', redirect: 'manual' });
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.chat_id).toBe('-100123456'); expect(body.text).toBe('test message');
    const failure = (async () => { throw new Error(token); }) as unknown as typeof fetch;
    await expect(sendTelegram(env, 'test', failure)).rejects.toThrow('telegram_delivery_failed');
    try { await sendTelegram(env, 'test', failure); } catch (error) { expect(String(error)).not.toContain(token); }
  });
});
