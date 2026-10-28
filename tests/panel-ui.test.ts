import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { panelHtml } from '../src/panel/ui';

describe('administration UI (DOM simulation, not a browser)', () => {
  it('signs in against the API, renders returned users, and clears sensitive UI state on logout', async () => {
    let signedIn = false;
    const user = { id: 1, name: 'Local Tester', uuid: '00000000-0000-4000-8000-000000000001', trojanPass: 'test-only',
      subToken: 'local-only-token', quotaBytes: 0, usedUp: 0, usedDown: 0, expiryAt: 0, expiryDays: 0,
      firstUsedAt: 0, enabled: true, isAdmin: true, lastSeen: 0 };
    const fetcher = vi.fn(async (raw: string, init?: RequestInit) => {
      const path = String(raw).split('/panel/api')[1];
      if (path === '/status') return Response.json({ version: 'test', dbOk: true, host: 'nyx.example', isDefaultPassword: false });
      if (path === '/login') { signedIn = true; return Response.json({ ok: true }); }
      if (path === '/logout') { signedIn = false; return Response.json({ ok: true }); }
      if (!signedIn) return Response.json({ error: 'unauthorized' }, { status: 401 });
      if (path === '/me') return Response.json({ ok: true });
      if (path === '/users') return Response.json({ users: [user] });
      if (path === '/settings') return Response.json({ panelPath: 'panel', subPath: 'sub', proxyIPs: [], resetCycle: 'none' });
      if (path === '/events') return Response.json({ events: [] });
      return Response.json({ error: 'not_found' }, { status: 404 });
    });
    const html = panelHtml({ panelPath: 'panel', dbOk: true, isDefaultPassword: false });
    expect(html).not.toContain('proxyip.cmliussss.net');
    const dom = new JSDOM(html, { url: 'https://nyx.example/panel', runScripts: 'dangerously',
      beforeParse(window) { (window as unknown as { fetch: typeof fetch }).fetch = fetcher as unknown as typeof fetch; } });
    const d = dom.window.document;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith('/panel/api/me', expect.anything()));
    expect(d.body.dataset.view).toBe('login');
    const input = d.getElementById('login-pw') as HTMLInputElement;
    input.value = 'temporary-test-only'; d.getElementById('login-btn')?.click();
    await vi.waitFor(() => expect(d.getElementById('user-grid')?.textContent).toContain('Local Tester'));
    expect(input.value).toBe(''); expect(d.getElementById('admin-sub')?.textContent).toContain('local-only-token');
    d.getElementById('logout-btn')?.click();
    await vi.waitFor(() => expect(d.body.dataset.view).toBe('login'));
    expect(d.getElementById('user-grid')?.textContent).not.toContain('Local Tester');
    expect(d.getElementById('admin-sub')?.textContent).toBe('');
    expect(d.getElementById('admin-sub')?.hasAttribute('data-copy')).toBe(false);
    dom.window.close();
  });
});
