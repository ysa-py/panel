import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { consoleHtml } from '../src/console/ui';

function makeDom(authed = true) {
  const responses: Record<string, unknown> = {
    overview: { users: { total: 3, allowed: 2, recordedBytes: 1024 } },
    ai: { enabled: false, allowlist: [], usage: { requests: 0, limit: 5 } },
    diagnostics: { targets: [], ranked: [] },
    providers: { providers: [] },
    notifications: { telegram: { configured: false, dailyReport: false } },
    'ai/ask': { provider: 'rules', fallback: false, text: 'Use the local health check.' },
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (!authed) return new Response('{"error":"unauthorized"}', { status: 401 });
    const key = String(url).split('/api/ops/')[1];
    return new Response(JSON.stringify(responses[key] ?? {}), { status: 200 });
  });
  const dom = new JSDOM(consoleHtml('panel'), { url: 'https://nyx.example/console', runScripts: 'dangerously',
    beforeParse(window) { (window as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch; window.scrollTo = () => {}; } });
  return { dom, fetchMock };
}

describe('console interactions (DOM simulation, not a real browser)', () => {
  it('shows actual API data, switches language/direction and theme', async () => {
    const { dom } = makeDom(); const d = dom.window.document;
    await vi.waitFor(() => expect(d.getElementById('metric-users')?.textContent).toBe('3'));
    expect(d.documentElement.dir).toBe('rtl'); d.getElementById('language')?.click();
    expect(d.documentElement.dir).toBe('ltr'); expect(d.querySelector('h1')?.textContent).toContain('Network overview');
    d.getElementById('theme')?.click(); expect(d.documentElement.dataset.theme).toBe('light');
    expect(d.querySelector('nav[aria-label]')).not.toBeNull(); expect(consoleHtml('panel')).toContain('@media(max-width:760px)');
    dom.window.close();
  });
  it('does not show invented metrics when unauthenticated', async () => {
    const { dom } = makeDom(false); const d = dom.window.document;
    await vi.waitFor(() => expect(d.getElementById('auth-banner')?.classList.contains('hidden')).toBe(false));
    expect(d.getElementById('metric-users')?.textContent).toBe('—');
    expect(d.querySelector('a[href="/panel"]')).not.toBeNull(); dom.window.close();
  });
  it('navigates to the assistant and submits the local rule mode', async () => {
    const { dom, fetchMock } = makeDom(); const d = dom.window.document;
    await vi.waitFor(() => expect(d.getElementById('metric-users')?.textContent).toBe('3'));
    (d.querySelector('[data-view="ai"]') as HTMLButtonElement).click();
    expect(d.getElementById('view-ai')?.classList.contains('hidden')).toBe(false);
    (d.getElementById('prompt') as HTMLTextAreaElement).value = 'connection timeout';
    d.getElementById('ai-form')?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(d.getElementById('ai-result')?.textContent).toContain('Use the local health check.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/ops/ai/ask', expect.objectContaining({ method: 'POST' })); dom.window.close();
  });
});
