/** Deterministic health ranking; no DPI claims or packet-path AI. */
export interface Observation {
  endpoint: string;
  successes: number;
  samples: number;
  averageMs: number | null;
}
export interface RankedObservation extends Observation { score: number; }

export function rankObservations(items: Observation[]): RankedObservation[] {
  return items.filter((x) => x.samples > 0 && x.successes >= 0 && x.successes <= x.samples)
    .map((x) => ({
      ...x,
      // Success rate dominates; missing latency is treated conservatively.
      score: Math.round((x.successes / x.samples) * 1000 - Math.min((x.averageMs ?? 5000) / 10, 500)),
    }))
    .sort((a, b) => b.score - a.score || a.endpoint.localeCompare(b.endpoint, 'en'));
}

/** Exact operator-configured public HTTPS URLs; no query strings or IP literals. */
export function authorizedProbeUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const result = new Set<string>();
  for (const entry of raw.split(/[\n,]/).map((x) => x.trim()).filter(Boolean).slice(0, 10)) {
    try {
      const u = new URL(entry);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
          u.port && u.port !== '443' || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) ||
          !host.includes('.') || /(?:^|\.)(localhost|local|internal|invalid|test)$/.test(host) ||
          !/^[a-z0-9.-]+$/.test(host) || host.length > 253) continue;
      result.add(u.toString());
    } catch { /* ignore invalid operator configuration */ }
  }
  return [...result];
}

export async function probeAuthorizedUrl(
  target: string,
  allowlist: string[],
  fetcher: typeof fetch = fetch,
): Promise<{ success: boolean; status: number | null; latencyMs: number; checkedAt: number }> {
  if (!allowlist.includes(target)) throw new Error('target_not_authorized');
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(target, { method: 'GET', redirect: 'manual', signal: controller.signal });
    // Redirects are not followed, preventing an approved endpoint from redirecting to another host.
    if (response.body) await response.body.cancel().catch(() => {});
    return { success: response.status >= 200 && response.status < 300, status: response.status,
      latencyMs: Math.max(0, Date.now() - start), checkedAt: Date.now() };
  } catch {
    return { success: false, status: null, latencyMs: Math.max(0, Date.now() - start), checkedAt: Date.now() };
  } finally { clearTimeout(timer); }
}
