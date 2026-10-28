/** Shared HTTP safeguards; data crossing the network is always untrusted. */
import { Env, GzError } from '../config';

/**
 * Sandbox preview only: the preview reaches this Worker through a proxy that
 * terminates TLS and forwards the request under the sandbox host, so the
 * browser's Origin (the public preview host) never equals this Worker's own
 * request origin. Accept that one exact public origin only when the sandbox
 * sets BASE44_PREVIEW_MODE=1; unset or any other value keeps the original
 * exact same-origin requirement.
 */
export function previewOrigin(env?: Env): string | null {
  if (env?.BASE44_PREVIEW_MODE !== '1') return null;
  const suffix = env.BASE44_PUBLIC_HOST_SUFFIX;
  return suffix ? 'https://3000-' + suffix : null;
}

export function isSameOriginMutation(request: Request, env?: Env): boolean {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  const expected = previewOrigin(env);
  if (origin !== new URL(request.url).origin && (expected === null || origin !== expected)) return false;
  return /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '');
}

export async function readJsonObject(request: Request, maxBytes = 32 * 1024): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new GzError('invalid_json', 'validation');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new GzError('body_too_large', 'validation'); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GzError) throw error;
    throw new GzError('invalid_json', 'validation');
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function applySecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return response;
}
