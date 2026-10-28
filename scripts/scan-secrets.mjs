/** Best-effort credential scan of the working tree, staged blobs and reachable
 * Git history. Matching contents are never printed. This is NOT exhaustive. */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const maxBytes = 4_000_000;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64_000_000 });
const checks = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{80,255}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Telegram bot token', /\b\d{8,12}:[A-Za-z0-9_-]{35,60}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];
// Additional high-entropy assignments catch some unprefixed provider tokens.
// Known synthetic example values are explicitly excluded; this remains heuristic.
const assignment = /\b[A-Za-z0-9_]*(?:password|passwd|secret|token|api_?key)\s*[:=]\s*(['"])([^\s'"`]{24,200})\1/gi;
const synthetic = /^(?:local-test-only-|local-pages-test-|replace-locally-|example-|synthetic-|test-only-)/i;
let findings = 0, scannedWorking = 0, scannedBlobs = 0, skipped = 0;

function inspect(bytes, scope) {
  if (bytes.length > maxBytes || bytes.includes(0)) { skipped++; return; }
  const text = bytes.toString('utf8');
  for (const [kind, pattern] of checks) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) { console.error('Potential ' + kind + ' in ' + scope + ' (content and path withheld)'); findings++; }
  }
  assignment.lastIndex = 0;
  for (const match of text.matchAll(assignment)) {
    const value = match[2];
    if (!synthetic.test(value) && new Set(value).size >= 14) {
      console.error('Potential high-entropy credential assignment in ' + scope + ' (content and path withheld)');
      findings++;
      break;
    }
  }
}

const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
for (const file of new Set(files)) {
  try {
    if (statSync(file).size > maxBytes) { skipped++; continue; }
    inspect(readFileSync(file), 'working tree'); scannedWorking++;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// Include exactly what is staged, even when it differs from the working file.
// Deduplicate all index and reachable-history Git objects before reading them.
const blobs = new Map();
for (const entry of git('ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
  const match = /^\d+ ([0-9a-f]{40,64}) [0-3]\t/.exec(entry);
  if (match) blobs.set(match[1], 'index or reachable Git history');
}
for (const commit of git('rev-list', '--all').split('\n').filter(Boolean)) {
  for (const entry of git('ls-tree', '-r', '-z', commit).split('\0').filter(Boolean)) {
    const match = /^\d+ blob ([0-9a-f]{40,64})\t/.exec(entry);
    if (match) blobs.set(match[1], 'index or reachable Git history');
  }
}
for (const [oid, scope] of blobs) {
  const size = Number(git('cat-file', '-s', oid).trim());
  if (!Number.isSafeInteger(size) || size > maxBytes) { skipped++; continue; }
  const bytes = execFileSync('git', ['cat-file', 'blob', oid], { maxBuffer: maxBytes + 1024 });
  inspect(bytes, scope); scannedBlobs++;
}
if (findings) {
  console.error('Potential credentials found; review privately and rotate before pushing.');
  process.exitCode = 1;
} else {
  console.log(`Scanned ${scannedWorking} working files and ${scannedBlobs} distinct staged/history blobs; ${skipped} large or binary items skipped.`);
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    console.warn('Repository is shallow; unreachable or omitted history was not scanned.');
  }
  console.log('Selected patterns only; absence of credentials is not guaranteed.');
}
