import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';

const bundle = await build({
  entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', external: ['cloudflare:sockets'], write: false,
});
const script = process.env.NYX_TEST_PAGES === '1' ? await readFile('dist/pages/index.js', 'utf8') : bundle.outputFiles[0].text;
const origin = 'https://nyx.example';
const bootstrap = 'local-test-only-password-7294';
const changedPassword = 'local-test-only-password-8371';
function localWorker(options = {}) {
  const converted = convertV4MiniflareOptions({ modules: true, script, compatibilityDate: '2026-06-01', logRequests: false, ...options });
  // Only in this isolated test: simulate distinct trusted Cloudflare client IPs.
  converted.workers[0].dev.stripCfConnectingIp = false;
  return new Miniflare(converted);
}
const mf = localWorker({ d1Databases: ['GZ_DB'], bindings: { NYX_BOOTSTRAP_PASSWORD: bootstrap, NYX_AI_ENABLED: 'false' } });
after(async () => { await mf.dispose(); });
const db = await mf.getD1Database('GZ_DB');
let cookie = '', userId = 0, oldToken = '', newToken = '';

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.method && options.method !== 'GET') {
    if (!headers.has('origin')) headers.set('origin', origin);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  if (options.ip) headers.set('cf-connecting-ip', options.ip);
  return mf.dispatchFetch(origin + path, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}

test('missing D1 fails closed instead of using predictable credentials', async () => {
  const isolated = localWorker();
  try { const r = await isolated.dispatchFetch(origin + '/healthz'); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'database_not_bound'); }
  finally { await isolated.dispose(); }
});
test('D1 without a bootstrap secret fails closed', async () => {
  const isolated = localWorker({ d1Databases: ['GZ_DB'] });
  try { const r = await isolated.dispatchFetch(origin + '/healthz'); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'bootstrap_secret_required'); }
  finally { await isolated.dispose(); }
});
test('adds legacy quota columns without deleting existing users', async () => {
  const isolated = localWorker({ d1Databases: ['GZ_DB'], bindings: { NYX_BOOTSTRAP_PASSWORD: bootstrap } });
  try {
    const legacyDb = await isolated.getD1Database('GZ_DB');
    await legacyDb.prepare(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, uuid TEXT NOT NULL UNIQUE,
      trojan_pass TEXT NOT NULL, quota_bytes INTEGER NOT NULL DEFAULT 0,
      used_up INTEGER NOT NULL DEFAULT 0, used_down INTEGER NOT NULL DEFAULT 0,
      expiry_at INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0
    )`).run();
    await legacyDb.prepare('INSERT INTO users (name, uuid, trojan_pass, used_up, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind('Legacy', '00000000-0000-4000-8000-000000000001', 'test-only-legacy-trojan', 17, 1).run();
    assert.equal((await isolated.dispatchFetch(origin + '/healthz')).status, 200);
    const columns = (await legacyDb.prepare('PRAGMA table_info(users)').all()).results.map((column) => column.name);
    for (const column of ['first_used_at', 'expiry_days', 'reset_anchor']) assert.ok(columns.includes(column));
    const row = await legacyDb.prepare('SELECT name, used_up, first_used_at, expiry_days, reset_anchor FROM users WHERE name = ?1').bind('Legacy').first();
    assert.deepEqual(row, { name: 'Legacy', used_up: 17, first_used_at: 0, expiry_days: 0, reset_anchor: 0 });
  } finally { await isolated.dispose(); }
});
test('bootstraps database with random credentials and no plaintext password', async () => {
  const r = await call('/healthz'); assert.equal(r.status, 200); assert.equal((await r.json()).storage, 'D1');
  const settings = await db.prepare("SELECT value FROM kv_store WHERE key = 'settings'").first();
  assert.ok(settings); assert.ok(!settings.value.includes(bootstrap));
  const admin = await db.prepare('SELECT uuid, trojan_pass FROM users WHERE is_admin = 1').first();
  assert.match(admin.uuid, /^[a-f0-9-]{36}$/); assert.match(admin.trojan_pass, /^[a-f0-9]{48}$/);
});
test('protects APIs and rejects cross-origin login', async () => {
  assert.equal((await call('/api/ops/overview')).status, 401);
  const r = await call('/panel/api/login', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: { password: bootstrap } });
  assert.equal(r.status, 403);
});
test('atomically throttles concurrent incorrect login attempts', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => call('/panel/api/login', { method: 'POST', ip: '203.0.113.4', body: { password: 'wrong' } })));
  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses.filter((x) => x === 401).length, 5);
  assert.equal(statuses.filter((x) => x === 429).length, 3);
});
test('login establishes a secure session and authenticated operations work', async () => {
  const r = await call('/panel/api/login', { method: 'POST', ip: '203.0.113.5', body: { password: bootstrap } });
  assert.equal(r.status, 200); const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(';')[0];
  const overview = await call('/api/ops/overview', { cookie }); assert.equal(overview.status, 200); assert.equal((await overview.json()).users.total, 1);
  assert.equal((await call('/api/ops/providers', { cookie })).status, 200);
});
test('logout invalidates an otherwise copied session and a new login works', async () => {
  const copied = cookie;
  const out = await call('/panel/api/logout', { cookie, method: 'POST', body: {} });
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/api/ops/overview', { cookie: copied })).status, 401);
  const login = await call('/panel/api/login', { method: 'POST', ip: '203.0.113.5', body: { password: bootstrap } });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
});
test('CSRF, malformed JSON and oversized input are rejected server-side', async () => {
  const cross = await call('/panel/api/users', { cookie, method: 'POST', headers: { origin: 'https://attacker.example' }, body: { name: 'test' } });
  assert.equal(cross.status, 403);
  const bad = await mf.dispatchFetch(origin + '/panel/api/users', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: '[]' });
  assert.equal(bad.status, 400);
  const large = await call('/panel/api/users', { cookie, method: 'POST', body: { name: 'x'.repeat(40_000) } }); assert.equal(large.status, 400);
});
test('QR generation accepts a same-origin POST body rather than secret-bearing URLs', async () => {
  const r = await call('/panel/api/qr', { cookie, method: 'POST', body: { text: 'local-qr-test' } });
  assert.equal(r.status, 200); assert.match((await r.json()).svg, /<svg/);
  assert.equal((await call('/panel/api/qr?text=local-qr-test', { cookie })).status, 404);
  assert.equal((await call('/panel/api/qr', { method: 'POST', body: { text: 'local-qr-test' } })).status, 401);
  assert.equal((await call('/panel/api/qr', { cookie, method: 'POST', headers: { origin: 'https://attacker.example' }, body: { text: 'local-qr-test' } })).status, 403);
});
test('creates a user and serves a real generated subscription without starting expiry', async () => {
  const r = await call('/panel/api/users', { cookie, method: 'POST', body: { name: 'Integration', quotaGB: 1, expiryDays: 7 } });
  assert.equal(r.status, 201); userId = (await r.json()).user.id;
  const users = await (await call('/panel/api/users', { cookie })).json();
  const user = users.users.find((x) => x.id === userId); assert.ok(user); oldToken = user.subToken; assert.match(oldToken, /^[a-f0-9]{32}$/);
  const sub = await call('/sub/' + oldToken + '/singbox'); assert.equal(sub.status, 200);
  const config = await sub.json(); assert.equal(config.outbounds[0].uuid, user.uuid);
  const dbRow = await db.prepare('SELECT first_used_at FROM users WHERE id=?1').bind(userId).first(); assert.equal(dbRow.first_used_at, 0);
});
test('a due quota window restores subscription access without starting first-use expiry', async () => {
  assert.equal((await call('/panel/api/settings', { cookie, method: 'POST', body: { resetCycle: 'daily' } })).status, 200);
  await db.prepare('UPDATE users SET used_up = ?1, reset_anchor = ?2 WHERE id = ?3')
    .bind(1024 ** 3, Date.now(), userId).run();
  assert.equal((await call('/panel/api/users/' + userId, { cookie, method: 'PATCH', body: { name: 'Integration' } })).status, 200);
  assert.equal((await call('/sub/' + oldToken + '/singbox')).status, 404);
  await db.prepare('UPDATE users SET reset_anchor = ?1 WHERE id = ?2').bind(Date.now() - 2 * 86_400_000, userId).run();
  assert.equal((await call('/panel/api/users/' + userId, { cookie, method: 'PATCH', body: { name: 'Integration' } })).status, 200);
  assert.equal((await call('/sub/' + oldToken + '/singbox')).status, 200);
  const row = await db.prepare('SELECT used_up, reset_anchor, first_used_at FROM users WHERE id = ?1').bind(userId).first();
  assert.equal(row.used_up, 0); assert.equal(row.first_used_at, 0); assert.ok(row.reset_anchor > Date.now() - 10_000);
  assert.equal((await call('/panel/api/settings', { cookie, method: 'POST', body: { resetCycle: 'none' } })).status, 200);
});
test('reset, credential rotation and revocation change the database and subscription', async () => {
  assert.equal((await call('/panel/api/users/' + userId, { cookie, method: 'PATCH', body: { enabled: 'false' } })).status, 400);
  assert.equal((await call('/panel/api/users/' + userId, { cookie, method: 'PATCH', body: { quotaGB: 102401 } })).status, 400);
  await db.prepare('UPDATE users SET used_up = 10, used_down = 20 WHERE id = ?1').bind(userId).run();
  let r = await call('/panel/api/users/' + userId, { cookie, method: 'PATCH', body: { resetUsage: true, rotateCredentials: true } });
  assert.equal(r.status, 200);
  const row = await db.prepare('SELECT used_up, used_down, reset_anchor FROM users WHERE id = ?1').bind(userId).first();
  assert.equal(row.used_up, 0); assert.equal(row.used_down, 0); assert.ok(row.reset_anchor > 0);
  assert.equal((await call('/sub/' + oldToken + '/singbox')).status, 404);
  const users = await (await call('/panel/api/users', { cookie })).json(); newToken = users.users.find((x) => x.id === userId).subToken;
  assert.notEqual(newToken, oldToken); assert.equal((await call('/sub/' + newToken + '/singbox')).status, 200);
  r = await call('/panel/api/users/' + userId, { cookie, method: 'PATCH', body: { enabled: false } });
  assert.equal(r.status, 200); assert.equal((await call('/sub/' + newToken + '/singbox')).status, 404);
});
test('AI is opt-in; local fallback is explicit and catalog is not fabricated', async () => {
  const catalog = await (await call('/api/ops/ai/models', { cookie })).json(); assert.equal(catalog.status, 'unconfigured'); assert.deepEqual(catalog.models, []);
  const rules = await call('/api/ops/ai/ask', { cookie, method: 'POST', body: { mode: 'rules', prompt: 'quota reached' } });
  assert.equal((await rules.json()).provider, 'rules');
  const fallback = await (await call('/api/ops/ai/ask', { cookie, method: 'POST', body: { mode: 'workers-ai', model: '@cf/example/model', prompt: 'connection' } })).json();
  assert.equal(fallback.provider, 'rules'); assert.equal(fallback.fallback, true);
});
test('diagnostics reject targets absent from the configured allowlist', async () => {
  const r = await call('/api/ops/diagnostics', { cookie, method: 'POST', body: { target: 'https://unapproved.example/' } });
  assert.equal(r.status, 400);
});
test('changing the password never writes it to D1 and invalidates the old session', async () => {
  const r = await call('/panel/api/settings', { cookie, method: 'POST', body: { newPassword: changedPassword } }); assert.equal(r.status, 200);
  const row = await db.prepare("SELECT value FROM kv_store WHERE key = 'settings'").first(); assert.ok(!row.value.includes(changedPassword));
  assert.equal((await call('/api/ops/overview', { cookie })).status, 401);
  const login = await call('/panel/api/login', { method: 'POST', ip: '203.0.113.6', body: { password: changedPassword } }); assert.equal(login.status, 200);
});
