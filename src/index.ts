/** NYX Cloudflare entry point, adapted from Gozargah (MIT; see third_party). */
import { DEFAULTS, Env, GzError, VERSION } from './config';
import { getEffectiveSettings } from './settings';
import { acceptWebSocket } from './handlers/websocket';
import { findUserByToken, renderSub, resolveApp, subHeaders } from './subscription';
import { resolveOpts } from './sub/operators';
import { isUserAllowed, resetDue, resetQuotaIfDue } from './db/users';
import { handlePanelApi } from './panel/api';
import { panelHtml } from './panel/ui';
import { landingHtml } from './panel/landing';
import { userPageHtml } from './panel/userpage';
import { LOGO_FAV_B64, LOGO_MIME } from './assets/logo';
import { consoleHtml } from './console/ui';
import { handleConsoleApi } from './console/api';
import { applySecurityHeaders, jsonResponse } from './core/http';
import { sendDailyTelegramReport } from './core/telegram';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return applySecurityHeaders(await route(request, env, ctx));
    } catch (error) {
      // Do not leak SQL, provider errors, secrets, subscription links or request bodies.
      const code = error instanceof GzError && error.code === 'no_db' ? 'database_not_bound' :
        error instanceof GzError && error.code === 'not_configured' ? 'bootstrap_secret_required' : 'service_unavailable';
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/') || path.endsWith('/healthz') || path.includes('/api/')) {
        return applySecurityHeaders(jsonResponse({ error: code }, 503));
      }
      return applySecurityHeaders(new Response('NYX is not ready. Configure D1 and a bootstrap password; see the deployment guide.', {
        status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      }));
    }
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    // Optional Worker cron only. Pages Functions and FastEdge have no scheduler here.
    ctx.waitUntil(sendDailyTelegramReport(env, controller.scheduledTime).catch(() => {}));
  },
};

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const host = url.host;
  let rawPath: string;
  try { rawPath = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, ''); }
  catch { return jsonResponse({ error: 'invalid_path' }, 400); }

  // The shell is safe to serve without setup; every operational API requires auth.
  if ((rawPath === '' || rawPath === 'console') && request.method === 'GET') {
    let path = DEFAULTS.panelPath as string;
    try { path = (await getEffectiveSettings(env, host)).panelPath; } catch { /* show setup state in UI */ }
    return new Response(consoleHtml(path), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (rawPath === 'healthz' && request.method === 'GET') {
    await getEffectiveSettings(env, host);
    return jsonResponse({ ok: true, version: VERSION, storage: 'D1' });
  }
  if (rawPath === 'favicon.ico' || rawPath === 'favicon.png') {
    const bytes = atob(LOGO_FAV_B64.split(',')[1]);
    return new Response(Uint8Array.from(bytes, (v) => v.charCodeAt(0)), { headers: { 'content-type': LOGO_MIME, 'cache-control': 'public, max-age=86400' } });
  }
  if (rawPath === 'robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });

  const eff = await getEffectiveSettings(env, host);
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return acceptWebSocket(request, env, ctx);
  if (rawPath.startsWith('api/ops/')) return handleConsoleApi(request, env, eff, rawPath.slice('api/ops/'.length));
  if (rawPath === eff.panelPath && request.method === 'GET') {
    return new Response(panelHtml({ panelPath: eff.panelPath, dbOk: true, isDefaultPassword: false, version: VERSION, lang: 'fa' }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (rawPath.startsWith(eff.panelPath + '/api/')) {
    return handlePanelApi(request, env, eff, rawPath.slice(eff.panelPath.length + 5));
  }
  if (rawPath.startsWith(eff.subPath + '/') && env.GZ_DB && request.method === 'GET') {
    const segs = rawPath.slice(eff.subPath.length + 1).split('/').filter(Boolean);
    const token = segs[0] ?? '';
    let user = await findUserByToken(env.GZ_DB, url.hostname, token);
    // A new quota window must also restore subscription access. Rolling a
    // quota window here must not start first-use expiry (only a connection does).
    if (user && resetDue(user, eff.resetCycle)) {
      await resetQuotaIfDue(env.GZ_DB, user, eff.resetCycle);
      user = await findUserByToken(env.GZ_DB, url.hostname, token);
    }
    if (user && isUserAllowed(user).ok) {
      const opts = resolveOpts(url.searchParams.get('op'), url.searchParams.get('ech'),
        url.searchParams.get('fraglen'), url.searchParams.get('fragdelay'));
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fa';
      const app = resolveApp(segs[1] ?? url.searchParams.get('app') ?? '', request.headers.get('user-agent') ?? '');
      // Subscription reads must not start a user's first-connection expiry clock.
      if (app === 'page') {
        return new Response(await userPageHtml({ host: url.hostname, user, token, subPath: eff.subPath, panelPath: eff.panelPath, lang, opts, echOn: !!opts.ech }), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return new Response(renderSub(app, url.hostname, user, opts).body, { headers: subHeaders(eff, url.hostname, user, app, opts, token) });
    }
  }
  return new Response(landingHtml('fa'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
