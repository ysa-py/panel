/** Mocked outbound Telegram + real Miniflare D1 and (Worker only) scheduled events. */
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = 'https://nyx.example', password = 'local-test-only-telegram-password-4926';
const token = '123456:' + 'x'.repeat(36), chatId = '-100123456';
const bundle = await build({ entryPoints:['src/index.ts'], bundle:true, format:'esm', platform:'browser', target:'es2022', external:['cloudflare:sockets'], write:false });
const pages = process.env.NYX_TEST_PAGES === '1';
const script = pages ? await readFile('dist/pages/index.js', 'utf8') : bundle.outputFiles[0].text;
let calls = 0, shouldFail = false;
const options = convertV4MiniflareOptions({ modules:true, script, compatibilityDate:'2026-06-01', logRequests:false,
  d1Databases:['GZ_DB'], bindings:{ NYX_BOOTSTRAP_PASSWORD:password, NYX_TELEGRAM_BOT_TOKEN:token, NYX_TELEGRAM_CHAT_ID:chatId, NYX_TELEGRAM_DAILY_REPORT:'true' },
  outboundService: async (request) => {
    assert.equal(new URL(request.url).hostname, 'api.telegram.org'); assert.equal(request.method, 'POST');
    const body = await request.json(); assert.equal(body.chat_id,chatId); assert.ok(!body.text.includes(token));
    calls++; return new Response(JSON.stringify({ ok:!shouldFail }), { status:shouldFail?502:200 });
  },
});
const mf = new Miniflare(options);
try {
  assert.equal((await mf.dispatchFetch(origin+'/api/ops/notifications')).status,401);
  const login = await mf.dispatchFetch(origin+'/panel/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password})});
  assert.equal(login.status,200); const cookie=login.headers.get('set-cookie').split(';')[0];
  const status = await mf.dispatchFetch(origin+'/api/ops/notifications',{headers:{cookie}});
  const statusText=await status.text(); assert.ok(!statusText.includes(token));
  assert.deepEqual(JSON.parse(statusText).telegram,{configured:true,dailyReport:true});
  const test = await mf.dispatchFetch(origin+'/api/ops/notifications/test',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});
  assert.equal(test.status,200); assert.equal(calls,1);
  console.log('PASS authenticated Telegram test through a mocked provider; secrets are not returned');
  if (!pages) {
    const worker = await mf.getWorker(); const when = new Date('2026-10-27T09:00:00Z');
    const jobs = await Promise.all([worker.scheduled({scheduledTime:when,cron:'0 9 * * *'}),worker.scheduled({scheduledTime:when,cron:'0 9 * * *'})]);
    assert.ok(jobs.every((job) => job.outcome === 'ok')); assert.equal(calls,2);
    const db=await mf.getD1Database('GZ_DB');
    const sent=await db.prepare('SELECT status FROM nyx_telegram_daily WHERE day=?1').bind('2026-10-27').first(); assert.equal(sent.status,'sent');
    console.log('PASS Worker cron reserves one aggregate report across concurrent triggers');
    shouldFail=true; const tomorrow=new Date('2026-10-28T09:00:00Z');
    await worker.scheduled({scheduledTime:tomorrow,cron:'0 9 * * *'});
    await worker.scheduled({scheduledTime:tomorrow,cron:'0 9 * * *'});
    assert.equal(calls,3);
    const failed=await db.prepare('SELECT status FROM nyx_telegram_daily WHERE day=?1').bind('2026-10-28').first(); assert.equal(failed.status,'failed');
    console.log('PASS failed Telegram delivery is recorded and not retried automatically that day');
  }
} finally { await mf.dispose(); }
