/** Run the same D1/security and tunnel checks against Wrangler's built Pages Function. */
import { spawnSync } from 'node:child_process';
for (const script of ['test-integration.mjs', 'test-tunnel.mjs', 'test-telegram.mjs', 'test-ai.mjs']) {
  console.log('\nPages Functions: ' + script);
  const child = spawnSync(process.execPath, ['scripts/' + script], {
    stdio: 'inherit', env: { ...process.env, NYX_TEST_PAGES: '1' },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
