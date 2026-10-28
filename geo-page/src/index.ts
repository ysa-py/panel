/** Standalone Gcore FastEdge HTTP app; it stores and logs no visitor data. */
function safeText(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  return text ? text.slice(0, 120) : null;
}
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}
function commonHeaders(type: string): Record<string, string> {
  return {
    'content-type': type,
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  };
}
function page(ip: string | null, country: string | null, city: string | null, requestOrigin: string): string {
  const display = (value: string | null): string => htmlEscape(value || 'Unavailable');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your edge location — NYX</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;color:#eef1fa;background:radial-gradient(circle at 50% -20%,#39315e,#0b0f19 55%);font:15px/1.5 system-ui,sans-serif}.card{width:min(100%,620px);background:#121927;border:1px solid #283247;border-radius:22px;padding:clamp(24px,5vw,42px);box-shadow:0 30px 80px #0005}.brand{display:flex;gap:12px;align-items:center;font-size:12px;letter-spacing:.18em;font-weight:800}.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#9c8af8;color:#181333;font-size:24px}.tag{color:#82e5d5;text-transform:uppercase;font-size:10px;letter-spacing:.16em;font-weight:700;margin-top:38px}h1{font-size:clamp(29px,6vw,40px);letter-spacing:-.04em;margin:8px 0}p{color:#9eabc0;margin:0 0 26px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.item{background:#0d1421;border:1px solid #273247;border-radius:12px;padding:17px;min-width:0}.item:first-child{grid-column:1/-1}.label{color:#8c9ab2;font-size:11px;display:block;margin-bottom:7px}.value{font-size:17px;font-weight:700;overflow-wrap:anywhere}.foot{border-top:1px solid #273247;margin-top:27px;padding-top:20px;color:#8592a6;font-size:11px}.dot{display:inline-block;width:7px;height:7px;background:#70dfc4;border-radius:50%;margin-right:7px}@media(max-width:430px){.grid{grid-template-columns:1fr}.item:first-child{grid-column:auto}}
</style></head><body><main class="card"><div class="brand"><span class="logo">✳</span> NYX / AETHERCORE EDGE</div><div class="tag">FastEdge · visitor information</div><h1>Your edge connection.</h1><p>Location is estimated from information supplied by the edge platform. Values may be unavailable or imprecise.</p><div class="grid"><div class="item"><span class="label">YOUR IP ADDRESS</span><span class="value">${display(ip)}</span></div><div class="item"><span class="label">COUNTRY</span><span class="value">${display(country)}</span></div><div class="item"><span class="label">CITY</span><span class="value">${display(city)}</span></div></div><div class="foot"><span class="dot"></span>No visitor data is saved by this application.<br>Request origin: ${htmlEscape(requestOrigin)} · Verify the public URL in the Gcore portal.</div></main></body></html>`;
}

async function handle(event: FetchEvent): Promise<Response> {
  const request = event.request;
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...commonHeaders('text/plain; charset=utf-8'), allow: 'GET, HEAD' } });
  }
  if (path === '/healthz') return new Response(request.method === 'HEAD' ? null : '{"ok":true}', { headers: commonHeaders('application/json; charset=utf-8') });
  if (path !== '/' && path !== '/api/me') return new Response('Not found', { status: 404, headers: commonHeaders('text/plain; charset=utf-8') });
  // These values come from FastEdge ClientInfo's platform-injected metadata.
  const ip = safeText(event.client.address);
  const country = safeText(event.client.geo.countryName) || safeText(event.client.geo.countryCode);
  const city = safeText(event.client.geo.city);
  // Only show the current request's origin, never its path or query. The real
  // public deployment URL must still be verified in the provider portal.
  const body = path === '/api/me' ? JSON.stringify({ ip, country, city }) : page(ip, country, city, url.origin);
  const type = path === '/api/me' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8';
  return new Response(request.method === 'HEAD' ? null : body, { headers: commonHeaders(type) });
}

addEventListener('fetch', (event: FetchEvent) => { event.respondWith(handle(event)); });
