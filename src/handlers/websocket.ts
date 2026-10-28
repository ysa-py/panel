/**
 * Gozargah — WebSocket proxy pipeline.
 *
 *  1. accept upgrade on ANY path (the protocol itself authenticates the user)
 *  2. consume 0-RTT early data from Sec-WebSocket-Protocol
 *     (nahan advertised this header but never read it — we actually use it)
 *  3. buffered header read + dual-protocol sniff (VLESS byte0=0 / Trojan 56-hex)
 *  4. user lookup + enforcement (enabled / expiry / real-byte quota)
 *  5. edgetunnel-style dial: direct first, ProxyIP fallback chain, per-user stable start
 *  6. bidirectional pump with REAL byte accounting, coalesced flush to D1
 */

import { Env, GzError } from '../config';
import { b64UrlDecode, concatBytes, utf8Decode, withTimeout } from '../utils/crypto';
import { glog } from '../utils/log';
import { dialWithFallback } from './proxy';
import { parseVless, vlessOkResponse } from '../protocols/vless';
import { parseTrojan } from '../protocols/trojan';
import {
  findUserByTrojanHash, getUserByUuid, GzUser, isUserAllowed, lazyMaintenance, resetDue, resetQuotaIfDue, flushUsage, queueUsage,
} from '../db/users';
import { DEFAULTS } from '../config';

export function acceptWebSocket(request: Request, env: Env, ctx: ExecutionContext): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  // Modern workerd can deliver binary frames as Blob by default. The protocol
  // parser consumes bytes synchronously and must not silently see an empty Blob.
  server.binaryType = 'arraybuffer';
  server.accept();

  let early: Uint8Array | null = null;
  let selectedProtocol: string | null = null;
  const protoHeader = request.headers.get('sec-websocket-protocol');
  // Only a single, unpadded base64url token is accepted. Clients that offer a
  // subprotocol require the server to select it or the handshake is rejected.
  if (protoHeader && protoHeader.length <= 12_000 && /^[A-Za-z0-9_-]+$/.test(protoHeader)) {
    try {
      early = b64UrlDecode(protoHeader);
      if (early.length) selectedProtocol = protoHeader;
      else early = null;
    } catch { early = null; }
  }

  const host = new URL(request.url).host;

  ctx.waitUntil(pumpProxy(server, early, env, host, ctx).catch((e) => {
    void e;
    glog('proxy connection failed');
    try { server.close(1011); } catch { /* ignore */ }
  }));

  const headers = new Headers();
  if (selectedProtocol) headers.set('sec-websocket-protocol', selectedProtocol);
  return new Response(null, { status: 101, webSocket: pair[0], headers });
}

interface HeaderInfo {
  proto: 'vless' | 'trojan';
  headerLen: number;
  version: number;
  host: string;
  port: number;
  isUDP: boolean;
  user: GzUser | null;
}

function wsReadable(server: WebSocket): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      server.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          ctrl.enqueue(new TextEncoder().encode(ev.data));
        } else {
          ctrl.enqueue(new Uint8Array(ev.data as ArrayBuffer));
        }
      });
      server.addEventListener('close', () => { try { ctrl.close(); } catch { /* ignore */ } });
      server.addEventListener('error', () => { try { ctrl.error(new Error('ws error')); } catch { /* ignore */ } });
    },
  });
}

async function pumpProxy(server: WebSocket, early: Uint8Array | null, env: Env, host: string, ctx: ExecutionContext): Promise<void> {
  const reader = wsReadable(server).getReader();

  // --- buffered header read (early data may carry only a partial header) ---
  let buf = early ?? new Uint8Array(0);
  let info: HeaderInfo | null = null;
  for (let guard = 0; guard < 64 && !info; guard++) {
    info = await tryParseAndResolve(buf, env, host);
    if (info) break;
    const { done, value } = await withTimeout(reader.read(), 10_000, 'header');
    if (done) throw new GzError('ws closed before full header', 'bad_request');
    if (value && value.length) {
      if (buf.length + value.length > 16_384) throw new GzError('header too large', 'bad_request');
      buf = concatBytes(buf, value);
    }
  }
  if (!info) throw new GzError('could not parse protocol header', 'bad_request');

  if (info.isUDP) {
    glog('udp requested — closing (tcp-only in v1)');
    try { server.close(1008); } catch { /* ignore */ }
    return;
  }

  if (info.user && info.user.enabled && info.user.id > 0 && env.GZ_DB) {
    const cycle = ((await getResetCycle(env)) ?? 'none') as 'none' | 'daily' | 'weekly' | 'monthly';
    // Process a due reset before testing the old counter, otherwise exhausted
    // users could never enter the next quota period.
    if (resetDue(info.user, cycle)) {
      await resetQuotaIfDue(env.GZ_DB, info.user, cycle);
      info.user = await getUserByUuid(env.GZ_DB, info.user.uuid);
    }
    if (info.user && isUserAllowed(info.user).ok && !info.user.firstUsedAt) {
      await lazyMaintenance(env.GZ_DB, info.user, cycle);
      info.user = await getUserByUuid(env.GZ_DB, info.user.uuid);
    }
  }
  if (!info.user) throw new GzError('auth failed', 'auth_failed');
  const verdict = isUserAllowed(info.user);
  if (!verdict.ok) {
    glog('user blocked (' + verdict.reason + ')');
    try { server.close(1008); } catch { /* ignore */ }
    return;
  }

  // --- dial (direct first, ProxyIP fallback chain, per-user stable start) ---
  const proxyIPs = await getProxyIPs(env);
  const startIdx = info.user.isAdmin && info.user.id === 0 ? 0 : stableIndex(info.user.uuid, proxyIPs.length);
  const dial = await dialWithFallback(info.host, info.port, proxyIPs, startIdx);

  if (info.proto === 'vless') server.send(vlessOkResponse(info.version));

  // --- client -> remote (leftover bytes after the header go first) ---
  let up = 0;
  let down = 0;
  // This limits a single connection against its snapshot; parallel isolates can
  // still overshoot, so this is not an authoritative distributed billing meter.
  const remaining = info.user.quotaBytes > 0
    ? Math.max(0, info.user.quotaBytes - info.user.usedUp - info.user.usedDown)
    : Infinity;
  function accountChunk(size: number, direction: 'up' | 'down'): void {
    if (up + down + size > remaining) throw new GzError('quota exceeded', 'quota');
    if (direction === 'up') up += size;
    else down += size;
  }
  let leftover: Uint8Array | null = buf.slice(info.headerLen);

  const upPipe = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (leftover) {
        const c = leftover;
        leftover = null;
        accountChunk(c.length, 'up');
        ctrl.enqueue(c);
        return;
      }
      const { done, value } = await reader.read();
      if (done) { try { ctrl.close(); } catch { /* ignore */ } return; }
      if (value && value.length) {
        accountChunk(value.length, 'up');
        ctrl.enqueue(value);
      }
    },
    cancel() { try { server.close(); } catch { /* ignore */ } },
  })
    .pipeTo(dial.socket.writable)
    .catch(() => { try { dial.socket.close(); } catch { /* ignore */ } });

  // --- remote -> client ---
  const downPipe = dial.socket.readable
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          accountChunk(chunk.byteLength, 'down');
          server.send(chunk);
        },
        close() { try { server.close(); } catch { /* ignore */ } },
        abort() { try { server.close(1011); } catch { /* ignore */ } },
      }),
    )
    .catch(() => { try { server.close(); } catch { /* ignore */ } });

  await Promise.allSettled([upPipe, downPipe]);
  try { dial.socket.close(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }

  if (info.user && env.GZ_DB && info.user.id > 0) {
    queueUsage(info.user.id, up, down);
    await flushUsage(env.GZ_DB);
    glog('connection closed');
  }
}

/* ------------------------------------------------------------------ */

function isHexByte(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66);
}

function isShortError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('short');
}

/** Parse header if enough bytes are buffered; resolve user in the same step. */
async function tryParseAndResolve(buf: Uint8Array, env: Env, host: string): Promise<HeaderInfo | null> {
  if (buf.length < 24) return null;

  const b0 = buf[0];
  if (b0 === 0) {
    if (buf.length < 26) return null;
    let req;
    try {
      req = parseVless(buf);
    } catch (e) {
      if (isShortError(e)) return null;
      throw e;
    }
    const user = await resolveVlessUser(env, host, req.uuid);
    return { proto: 'vless', headerLen: req.headerLen, version: req.version, host: req.host, port: req.port, isUDP: req.isUDP, user };
  }

  if (isHexByte(b0)) {
    if (buf.length < 60) return null;
    let req;
    try {
      req = parseTrojan(buf);
    } catch (e) {
      if (isShortError(e)) return null;
      throw e;
    }
    const user = await resolveTrojanUser(env, host, utf8Decode(buf.slice(0, 56)));
    return { proto: 'trojan', headerLen: req.headerLen, version: 0, host: req.host, port: req.port, isUDP: req.isUDP, user };
  }

  throw new GzError('unknown protocol first byte ' + b0, 'bad_request');
}

async function resolveVlessUser(env: Env, _host: string, uuid: string): Promise<GzUser | null> {
  return env.GZ_DB ? getUserByUuid(env.GZ_DB, uuid) : null;
}

async function resolveTrojanUser(env: Env, _host: string, wireHash: string): Promise<GzUser | null> {
  return env.GZ_DB ? findUserByTrojanHash(env.GZ_DB, wireHash) : null;
}

async function getProxyIPs(env: Env): Promise<string[]> {
  if (env.GZ_DB) {
    try {
      const { loadSettings } = await import('../db/store');
      const s = await loadSettings(env.GZ_DB);
      if (s && s.proxyIPs.length) return s.proxyIPs;
    } catch { /* fall through */ }
  }
  return [...DEFAULTS.proxyIPs];
}

async function getResetCycle(env: Env): Promise<string | null> {
  if (env.GZ_DB) {
    try {
      const { loadSettings } = await import('../db/store');
      const s = await loadSettings(env.GZ_DB);
      if (s) return s.resetCycle || 'none';
    } catch { /* fall through */ }
  }
  return null;
}

function stableIndex(seed: string, mod: number): number {
  if (mod <= 1) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}
