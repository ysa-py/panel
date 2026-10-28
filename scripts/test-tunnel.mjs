/** Real local WebSocket → TCP echo test with Miniflare/workerd and D1.
 * Loopback is deliberately owned by the test; it does not test Cloudflare's live egress policy. */
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const origin = 'https://nyx.example';
const password = 'local-test-only-tunnel-password-5738';
const output = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:sockets'], write: false });
const workerScript = process.env.NYX_TEST_PAGES === '1' ? await readFile('dist/pages/index.js', 'utf8') : output.outputFiles[0].text;
const config = convertV4MiniflareOptions({ modules: true, script: workerScript, compatibilityDate: '2026-06-01', logRequests: false,
  d1Databases: ['GZ_DB'], bindings: { NYX_BOOTSTRAP_PASSWORD: password } });
const mf = new Miniflare(config);
let connections = 0;
const server = createServer((socket) => { connections++; socket.on('error', () => {}); socket.pipe(socket); });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
try {
  const health = await mf.dispatchFetch(origin + '/healthz'); assert.equal(health.status, 200);
  const login = await mf.dispatchFetch(origin + '/panel/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  async function change(path, method, body) {
    return mf.dispatchFetch(origin + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  const create = await change('/panel/api/users', 'POST', { name: 'Local tunnel test', quotaGB: 1, expiryDays: 7 });
  assert.equal(create.status, 201); const id = (await create.json()).user.id;
  const db = await mf.getD1Database('GZ_DB');
  const user = await db.prepare('SELECT uuid, trojan_pass FROM users WHERE id = ?1').bind(id).first();
  const uuid = Buffer.from(user.uuid.replaceAll('-', ''), 'hex');
  const host = [127, 0, 0, 1]; const portBytes = [port >> 8, port & 255];
  const payload = Buffer.from('nyx-echo-test');
  const vless = Buffer.concat([Buffer.from([0]), uuid, Buffer.from([0, 1, ...portBytes, 1, ...host]), payload]);
  const hash = createHash('sha224').update(user.trojan_pass).digest('hex');
  const trojan = Buffer.concat([Buffer.from(hash + '\r\n'), Buffer.from([1, 1, ...host, ...portBytes, 13, 10]), payload]);
  async function open(proto) {
    const headers = { upgrade: 'websocket' }; if(proto) headers['sec-websocket-protocol'] = proto;
    const response = await mf.dispatchFetch(origin + '/tunnel', { headers });
    assert.equal(response.status, 101);
    const socket = response.webSocket; socket.accept(); return socket;
  }
  async function roundTrip(name, header, expectedPrefix, split = false, early = false) {
    const offered = early === 'partial' ? header.subarray(0, 9) : header;
    const socket = await open(early ? offered.toString('base64url') : undefined);
    const received = await new Promise((resolve, reject) => {
      const chunks = []; const timer = setTimeout(() => reject(new Error(name + ' timed out')), 8000);
      socket.addEventListener('message', (event) => {
        chunks.push(Buffer.from(event.data)); const all = Buffer.concat(chunks);
        if (all.includes(payload)) { clearTimeout(timer); resolve(all); }
      });
      socket.addEventListener('close', (event) => { clearTimeout(timer); reject(new Error(name + ' closed: ' + event.code)); });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(name + ' websocket error')); });
      if (early === 'partial') socket.send(header.subarray(9));
      else if (!early) { if (split) { socket.send(header.subarray(0, 9)); socket.send(header.subarray(9)); }
      else socket.send(header); }
    });
    assert.ok(received.subarray(0, expectedPrefix.length).equals(Buffer.from(expectedPrefix)));
    assert.ok(received.includes(payload)); socket.close();
    console.log('PASS ' + name + ' WebSocket → owned local TCP echo → WebSocket');
  }
  async function rejectHeader(name, header, expectedCode) {
    const before = connections; const socket = await open();
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(name + ' timed out')), 8000);
      socket.addEventListener('close', (event) => { clearTimeout(timer); resolve(event.code); });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(name + ' websocket error')); });
      socket.send(header);
    });
    assert.equal(code, expectedCode); assert.equal(connections, before);
    console.log('PASS ' + name + ' rejected before dial');
  }
  await roundTrip('VLESS fragmented header', vless, [0, 0], true);
  await roundTrip('Trojan', trojan, []);
  await roundTrip('VLESS early data', vless, [0, 0], false, true);
  await roundTrip('VLESS early-data prefix plus frame', vless, [0, 0], false, 'partial');
  // Close propagation and waitUntil flushing are asynchronous. Observe bounded local completion.
  let usage;
  for (let attempt = 0; attempt < 30; attempt++) {
    usage = await db.prepare('SELECT used_up, used_down, first_used_at FROM users WHERE id = ?1').bind(id).first();
    if (usage.used_up >= payload.length * 4 && usage.used_down >= payload.length * 4) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(usage.first_used_at > 0);
  assert.equal(usage.used_up, payload.length * 4); assert.equal(usage.used_down, payload.length * 4);
  console.log('PASS first-use timestamp and locally observed up/down bytes persisted to D1');
  const bad = Buffer.from(vless); bad[1] ^= 0xff;
  await rejectHeader('unknown VLESS credential', bad, 1011);
  const udp = Buffer.from(vless); udp[18] = 2;
  await rejectHeader('UDP (unsupported)', udp, 1008);
  // Remaining quota can carry the upload but not the echoed download.
  const quotaBytes = usage.used_up + usage.used_down + payload.length + 1;
  assert.equal((await change('/panel/api/users/' + id, 'PATCH', { quotaGB: quotaBytes / (1024 ** 3) })).status, 200);
  const limited = await open();
  const limitedMessages = await new Promise((resolve, reject) => {
    const messages = []; const timer = setTimeout(() => reject(new Error('quota close timed out')), 8000);
    limited.addEventListener('message', (event) => messages.push(Buffer.from(event.data)));
    limited.addEventListener('close', () => { clearTimeout(timer); resolve(Buffer.concat(messages)); });
    limited.addEventListener('error', () => { clearTimeout(timer); reject(new Error('quota websocket error')); });
    limited.send(vless);
  });
  assert.ok(!limitedMessages.includes(payload));
  console.log('PASS one connection stops before sending a chunk over its quota snapshot');
  assert.equal((await change('/panel/api/users/' + id, 'PATCH', { enabled: false })).status, 200);
  await rejectHeader('disabled user', vless, 1008);
} finally {
  await mf.dispose();
  await new Promise((resolve) => server.close(resolve));
}
