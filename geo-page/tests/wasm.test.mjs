import assert from 'node:assert/strict';
import { defineTestSuite, runAndExit } from '@gcoredev/fastedge-test/test';

const request = (runner, path = '/', method = 'GET', headers = {}) => runner.execute({ path, method, headers });
const suite = defineTestSuite({
  wasmPath: './wasm/geo-page.wasm',
  tests: [
    { name: 'health endpoint returns JSON in the FastEdge Wasm runtime', run: async (runner) => {
      const r = await request(runner, '/healthz');
      assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { ok: true });
    } },
    { name: 'visitor IP, country and city come from FastEdge metadata', run: async (runner) => {
      const r = await request(runner, '/api/me', 'GET', { 'x-real-ip': '203.0.113.7', 'geoip-country-name': 'Portugal', 'geoip-country-code': 'PT', 'geoip-city': 'Lisbon' });
      assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { ip: '203.0.113.7', country: 'Portugal', city: 'Lisbon' });
    } },
    { name: 'unknown geo data is represented as null', run: async (runner) => {
      const r = await request(runner, '/api/me'); const data = JSON.parse(r.body);
      assert.equal(data.country, null); assert.equal(data.city, null);
    } },
    { name: 'HTML escapes untrusted location text and only displays the request origin', run: async (runner) => {
      const r = await request(runner, '/?private-example=do-not-render', 'GET', { 'geoip-city': '<script>alert(1)</script>' });
      assert.equal(r.status, 200); assert.ok(r.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.ok(!r.body.includes('<script>alert(1)</script>'));
      assert.match(r.body, /Request origin: https?:\/\//); assert.ok(!r.body.includes('do-not-render'));
      assert.ok(r.body.includes('Verify the public URL in the Gcore portal'));
    } },
    { name: 'responses disable caching and disallow active script', run: async (runner) => {
      const r = await request(runner); assert.match(String(r.headers['cache-control']), /no-store/); assert.match(String(r.headers['content-security-policy']), /default-src 'none'/);
    } },
    { name: 'unknown routes return 404', run: async (runner) => { assert.equal((await request(runner, '/not-found')).status, 404); } },
    { name: 'unsupported methods return 405', run: async (runner) => { assert.equal((await request(runner, '/', 'POST')).status, 405); } },
    { name: 'HEAD does not return a body', run: async (runner) => { const r=await request(runner, '/', 'HEAD'); assert.equal(r.status, 200); assert.equal(r.body, ''); } },
  ],
});
await runAndExit(suite);
