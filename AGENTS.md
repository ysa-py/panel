# Working in this repository (Base44 sandbox notes)

Non-obvious findings from setting the sandbox environment up. Repo-level documentation is in
`README.md` and `docs/`.

## How the app runs here

- The app is a Cloudflare Worker. In this sandbox it is served **from the cloned source** by
  `wrangler dev` (Miniflare + a *local* D1), defined in `docker-compose.base44.yml`
  (`web` service, host port 3000) so source edits are picked up live.
- No database container exists: local D1 is a SQLite file under `.wrangler/state`, inside the
  bind-mounted repository. It survives container restarts and is only lost if that directory
  is deleted.
- Start: `docker compose -f docker-compose.base44.yml up -d`. The first start runs `npm ci`
  (cached in the `nyx-aethercore-edge_nyx-node-modules` volume), then starts wrangler.
- The service uses `node:22`, **not** `node:22-slim`: the Workers runtime refuses to start
  without system CA certificates
  (`service internet: TLS configuration: unexpected error: No CA certificates were loaded from the system`).
- Wrangler watches the bind mount and reloads on edits (`⎔ Reloading local server...` in
  `docker compose -f docker-compose.base44.yml logs web`).
- Healthcheck (in compose) probes the console shell `/` **and** `/healthz`; `/healthz` is
  expected to answer 503 until the bootstrap password exists, so the check accepts 200 or 503.

## Secrets

- `NYX_BOOTSTRAP_PASSWORD` is provided by the platform and reaches the container through
  `env_file: /run/base44/app.env`. `wrangler dev` reads bindings only from `.dev.vars`, so the
  compose start-up command materialises `.dev.vars` from the container environment on every
  start. Nothing is hardcoded: with no value set the app stays fail-closed (503
  `bootstrap_secret_required` on operational routes, console shell still served).
- Nothing here is required at boot, which is why there is no `.env.base44-defaults` placeholder
  file: AI and Telegram are opt-in and default to off (`NYX_AI_ENABLED === 'true'`).
- **The password is hashed into D1 on the first operational request** (settings row plus admin
  user). After that, changing `NYX_BOOTSTRAP_PASSWORD` no longer changes the panel password —
  the stored hash wins. To re-bootstrap with a new value, stop the service, delete
  `.wrangler/state` (local dev data only) and start it again. The panel's own settings view can
  also change the password, which rewrites the hash in D1.
- `/panel` answers 503 until a bootstrap password exists; `/` (console shell) renders meanwhile.

## Sandbox-only code path: the preview origin

- The preview proxy terminates TLS and forwards requests under the sandbox host, so the
  browser's `Origin` (the public preview host) never equals the origin the Worker itself sees.
  Mutations are same-origin checked in `src/core/http.ts` (`isSameOriginMutation`), so that
  function additionally accepts the exact public preview origin
  `https://3000-$BASE44_PUBLIC_HOST_SUFFIX` **only** when `BASE44_PREVIEW_MODE === '1'`
  (`previewOrigin()`). Unset or any other value keeps the original exact same-origin rule.
- Evidence: with the flag off, `POST /panel/api/login` from the preview origin is refused with
  `403 same_origin_json_required` — i.e. without this override sign-in and every other mutation
  are broken in the preview. With the flag on the same request returns 200 and the session
  cookie round-trips inside the preview iframe (sign-in form driven in the preview browser).
- Do not copy this into non-preview deployments: `BASE44_PREVIEW_MODE` is set by the sandbox
  only, and `docker-compose.base44.yml` passes `BASE44_PREVIEW_MODE`/`BASE44_PUBLIC_HOST_SUFFIX`
  through as bare variables (never hardcode the resolved host).
- Cloudflare credentials, Workers AI and Telegram remain unconfigured here; those features stay
  disabled exactly as in the repo's documented local mode.

## Checks (run inside the container — the sandbox host has no Node.js)

```sh
docker compose -f docker-compose.base44.yml exec -T web sh -c '
  npm run typecheck; npx vitest run; node scripts/test-integration.mjs'
```

- `scripts/test-integration.mjs` (and the other `scripts/test-*.mjs`) start their own isolated
  in-memory Miniflare worker with throwaway passwords, so they never touch the preview database.
- The full project suite is `npm run check` (Worker, Pages, Wasm, secret scan); it is heavier
  than the sandbox needs, run it in CI rather than in the preview sandbox.

## Other targets in the repo (not served by this compose stack)

- `pages/` + `functions/[[path]].ts` — Cloudflare Pages Functions adapter (`npm run dev:pages`).
- `geo-page/` — standalone Gcore FastEdge Wasm app (`npm run build:geo`, `npm run test:geo`).
