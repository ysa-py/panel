/** Real D1 reservations with an explicitly simulated Workers AI binding; no provider call. */
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
const origin='https://nyx.example', password='local-test-only-ai-password-8472';
const entry=process.env.NYX_TEST_PAGES === '1' ? './dist/pages/index.js' : './src/index.ts';
const bundle=await build({stdin:{contents:`import worker from ${JSON.stringify(entry)};
export default { fetch(request, env, ctx) {
  const AI = { async run(model, input) {
    if (model.endsWith('/fail')) throw new Error('simulated provider failure');
    return { response: 'simulated advice', usage: { total_tokens: 12 }, unrelated: 'not exposed' };
  }};
  return worker.fetch(request, { ...env, AI }, ctx);
}};`,resolveDir:process.cwd(),sourcefile:'simulated-ai-adapter.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:sockets'],write:false});
const options=convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-06-01',logRequests:false,d1Databases:['GZ_DB'],
  bindings:{NYX_BOOTSTRAP_PASSWORD:password,NYX_AI_ENABLED:'true',NYX_AI_DAILY_LIMIT:'2',NYX_AI_MODEL_ALLOWLIST:'@cf/example/ok,@cf/example/fail'}});
const mf=new Miniflare(options);
try {
  const login=await mf.dispatchFetch(origin+'/panel/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  async function ask(mode,model) {const r=await mf.dispatchFetch(origin+'/api/ops/ai/ask',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({mode,model,prompt:'Explain a connection timeout'})});return {status:r.status,body:await r.json()};}
  const rules=await ask('rules','');assert.equal(rules.body.provider,'rules');
  assert.equal((await ask('workers-ai','@cf/example/not-allowed')).status,400);
  const [ok,failed]=await Promise.all([ask('workers-ai','@cf/example/ok'),ask('workers-ai','@cf/example/fail')]);
  assert.equal(ok.body.provider,'workers-ai');assert.equal(ok.body.text,'simulated advice');assert.deepEqual(ok.body.usage,{total_tokens:12});
  assert.equal(failed.body.provider,'rules');assert.equal(failed.body.fallback,true);assert.equal(failed.body.reason,'ai_request_failed');
  const capped=await ask('workers-ai','@cf/example/ok');assert.equal(capped.body.provider,'rules');assert.equal(capped.body.reason,'daily_ai_limit_reached');
  const usage=await (await mf.dispatchFetch(origin+'/api/ops/ai',{headers:{cookie}})).json();assert.equal(usage.usage.requests,2);
  console.log('PASS simulated Workers AI allowlist, provider-failure fallback, and atomic two-request D1 cap');
} finally {await mf.dispose();}
