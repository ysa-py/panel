/**
 * Gozargah — user model, CRUD, cache and REAL byte accounting.
 *
 * Traffic accounting: every proxied chunk length is counted (up/down) per user,
 * accumulated in-isolate and coalesced into D1 (ZEUS-style write coalescing) —
 * unlike nahan whose "GB" is actually connections/6000.
 */

import { DEFAULTS, ResetCycle, resetCycleMs } from '../config';
import { ensureSchema, invalidateCache } from './store';
import { sha224Hex } from '../utils/sha224';

export interface GzUser {
  id: number;
  name: string;
  uuid: string;
  trojanPass: string;
  quotaBytes: number; // 0 = unlimited
  usedUp: number;
  usedDown: number;
  expiryAt: number; // epoch ms, 0 = never (absolute mode)
  expiryDays: number; // > 0 = days from FIRST connection (first-use mode)
  firstUsedAt: number; // epoch ms of the first allowed proxy connection (0 = not started)
  resetAnchor: number; // rolling quota-reset window anchor (0 = starts with first use)
  enabled: boolean;
  isAdmin: boolean;
  createdAt: number;
  lastSeen: number;
}

interface UserRow {
  id: number; name: string; uuid: string; trojan_pass: string;
  quota_bytes: number; used_up: number; used_down: number;
  expiry_at: number; enabled: number; is_admin: number;
  created_at: number; last_seen: number;
  first_used_at: number; expiry_days: number; reset_anchor: number;
}

function toUser(r: UserRow): GzUser {
  return {
    id: r.id, name: r.name, uuid: r.uuid, trojanPass: r.trojan_pass,
    quotaBytes: r.quota_bytes, usedUp: r.used_up, usedDown: r.used_down,
    expiryAt: r.expiry_at, enabled: r.enabled === 1, isAdmin: r.is_admin === 1,
    createdAt: r.created_at, lastSeen: r.last_seen,
    firstUsedAt: r.first_used_at || 0, expiryDays: r.expiry_days || 0, resetAnchor: r.reset_anchor || 0,
  };
}

/* ------------------------------ cache ------------------------------ */

let listCache: { at: number; promise: Promise<GzUser[]> } | null = null;

export function invalidateUsers(): void {
  listCache = null;
}

export function listUsers(db: D1Database): Promise<GzUser[]> {
  if (listCache && Date.now() - listCache.at < DEFAULTS.cacheTtlMs) return listCache.promise;
  const p = (async () => {
    await ensureSchema(db);
    const res = await db.prepare('SELECT * FROM users ORDER BY is_admin DESC, id ASC').all<UserRow>();
    return (res.results ?? []).map(toUser);
  })();
  listCache = { at: Date.now(), promise: p };
  p.catch(() => { listCache = null; });
  return p;
}

export async function getUserByUuid(db: D1Database, uuid: string): Promise<GzUser | null> {
  const users = await listUsers(db);
  return users.find((u) => u.uuid === uuid) ?? null;
}

export async function getAdminUser(db: D1Database): Promise<GzUser | null> {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1').first<UserRow>();
  return row ? toUser(row) : null;
}

/** Trojan clients send sha224(password) on the wire — match against users. */
export async function findUserByTrojanHash(db: D1Database, hashHex: string): Promise<GzUser | null> {
  const users = await listUsers(db);
  for (const u of users) {
    if ((await sha224Hex(u.trojanPass)) === hashHex) return u;
  }
  return null;
}

/**
 * Effective expiry (epoch ms, 0 = none):
 *  - expiryDays > 0 (first-use mode): clock starts at the FIRST allowed connection
 *    — a user who never connected has no expiry yet ("not started")
 *  - otherwise: absolute expiryAt
 */
export function effectiveExpiry(u: Pick<GzUser, 'expiryAt' | 'expiryDays' | 'firstUsedAt'>, now = Date.now()): number {
  if (u.expiryDays > 0) {
    if (!u.firstUsedAt) return 0; // not started — nothing expired
    return u.firstUsedAt + u.expiryDays * 86_400_000;
  }
  return u.expiryAt || 0;
}

/** True when the rolling quota-reset window has elapsed since the anchor. */
export function resetDue(u: Pick<GzUser, 'resetAnchor' | 'firstUsedAt' | 'createdAt'>, cycle: ResetCycle, now = Date.now()): boolean {
  const win = resetCycleMs(cycle);
  if (!win) return false;
  const anchor = u.resetAnchor || u.firstUsedAt || u.createdAt || 0;
  if (!anchor) return false;
  return now >= anchor + win;
}

export function isUserAllowed(u: GzUser, now = Date.now()): { ok: boolean; reason: string } {
  if (!u.enabled) return { ok: false, reason: 'disabled' };
  const exp = effectiveExpiry(u, now);
  if (exp && now >= exp) return { ok: false, reason: 'expired' };
  if (u.quotaBytes && u.usedUp + u.usedDown >= u.quotaBytes) return { ok: false, reason: 'quota' };
  return { ok: true, reason: '' };
}

/** Roll an elapsed quota window without starting the first-use expiry clock. */
export async function resetQuotaIfDue(db: D1Database, u: GzUser, cycle: ResetCycle): Promise<void> {
  const now = Date.now();
  if (u.id <= 0 || u.isAdmin || !resetDue(u, cycle, now)) return;
  // Compare the old anchor so concurrent stale readers cannot erase a reset.
  await db.prepare(
    'UPDATE users SET used_up = 0, used_down = 0, reset_anchor = ?1 ' +
    'WHERE id = ?2 AND is_admin = 0 AND reset_anchor = ?3',
  ).bind(now, u.id, u.resetAnchor || 0).run();
  // Refresh even when another isolate performed the conditional reset first.
  invalidateUsers();
}

/** First allowed connection: roll any due window and start the expiry clock. */
export async function lazyMaintenance(db: D1Database, u: GzUser, cycle: ResetCycle): Promise<void> {
  if (!db || u.id <= 0) return;
  await resetQuotaIfDue(db, u, cycle);
  const now = Date.now();
  await db.prepare(
    'UPDATE users SET last_seen = ?1, ' +
    'first_used_at = CASE WHEN first_used_at = 0 THEN ?1 ELSE first_used_at END, ' +
    'reset_anchor = CASE WHEN reset_anchor = 0 AND ?2 != ?3 THEN ?1 ELSE reset_anchor END ' +
    'WHERE id = ?4 AND is_admin = 0',
  ).bind(now, cycle, 'none', u.id).run();
  invalidateUsers();
}

/* ------------------------------ CRUD ------------------------------ */

export interface NewUser { name: string; quotaBytes: number; expiryAt: number; expiryDays?: number; isAdmin?: boolean; uuid?: string; trojanPass?: string; }

export async function createUser(db: D1Database, data: NewUser): Promise<GzUser> {
  await ensureSchema(db);
  const now = Date.now();
  const uuid = data.uuid ?? crypto.randomUUID();
  const trojanPass = data.trojanPass ?? randomPass();
  const res = await db
    .prepare(
      'INSERT INTO users (name, uuid, trojan_pass, quota_bytes, expiry_at, expiry_days, enabled, is_admin, created_at) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)',
    )
    .bind(
      data.name,
      uuid,
      trojanPass,
      Math.max(0, Math.floor(data.quotaBytes)),
      Math.max(0, Math.floor(data.expiryAt)),
      Math.max(0, Math.floor(data.expiryDays ?? 0)),
      data.isAdmin ? 1 : 0,
      now,
    )
    .run();
  invalidateUsers();
  const id = res.meta.last_row_id as number;
  return {
    id, name: data.name, uuid, trojanPass,
    quotaBytes: data.quotaBytes, usedUp: 0, usedDown: 0, expiryAt: data.expiryAt,
    expiryDays: Math.max(0, Math.floor(data.expiryDays ?? 0)),
    firstUsedAt: 0, resetAnchor: 0,
    enabled: true, isAdmin: !!data.isAdmin, createdAt: now, lastSeen: 0,
  };
}

export interface UserPatch {
  name?: string; quotaBytes?: number; expiryAt?: number; expiryDays?: number; enabled?: boolean;
  usedUp?: number; usedDown?: number; uuid?: string; trojanPass?: string; resetUsage?: boolean;
}

export async function updateUser(db: D1Database, id: number, patch: UserPatch): Promise<void> {
  await ensureSchema(db);
  const sets: string[] = [];
  const vals: Array<string | number> = [];
  if (patch.name !== undefined) { sets.push('name = ?' + (vals.length + 1)); vals.push(patch.name); }
  if (patch.quotaBytes !== undefined) { sets.push('quota_bytes = ?' + (vals.length + 1)); vals.push(Math.max(0, Math.floor(patch.quotaBytes))); }
  if (patch.expiryAt !== undefined) { sets.push('expiry_at = ?' + (vals.length + 1)); vals.push(Math.max(0, Math.floor(patch.expiryAt))); }
  if (patch.enabled !== undefined) { sets.push('enabled = ?' + (vals.length + 1)); vals.push(patch.enabled ? 1 : 0); }
  if (patch.usedUp !== undefined) { sets.push('used_up = ?' + (vals.length + 1)); vals.push(Math.max(0, Math.floor(patch.usedUp))); }
  if (patch.usedDown !== undefined) { sets.push('used_down = ?' + (vals.length + 1)); vals.push(Math.max(0, Math.floor(patch.usedDown))); }
  if (patch.expiryDays !== undefined) { sets.push('expiry_days = ?' + (vals.length + 1)); vals.push(Math.max(0, Math.floor(patch.expiryDays))); }
  if (patch.resetUsage) {
    // manual reset also re-anchors the rolling reset window
    sets.push('used_up = 0', 'used_down = 0');
    sets.push('reset_anchor = ?' + (vals.length + 1));
    vals.push(Date.now());
  }
  if (patch.uuid !== undefined) { sets.push('uuid = ?' + (vals.length + 1)); vals.push(patch.uuid); }
  if (patch.trojanPass !== undefined) { sets.push('trojan_pass = ?' + (vals.length + 1)); vals.push(patch.trojanPass); }
  if (!sets.length) return;
  vals.push(id);
  await db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?' + vals.length).bind(...vals).run();
  invalidateUsers();
}

export async function deleteUser(db: D1Database, id: number): Promise<void> {
  await ensureSchema(db);
  await db.prepare('DELETE FROM users WHERE id = ?1 AND is_admin = 0').bind(id).run();
  invalidateUsers();
}

function randomPass(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  let s = '';
  for (const v of b) s += v.toString(16).padStart(2, '0');
  return s;
}

/* ------------------------------ usage coalescing ------------------------------ */

const pendingUsage = new Map<number, { up: number; down: number; lastSeen: number }>();
let lastFlush = Date.now();

export function queueUsage(userId: number, up: number, down: number): void {
  const cur = pendingUsage.get(userId) ?? { up: 0, down: 0, lastSeen: 0 };
  cur.up += up;
  cur.down += down;
  cur.lastSeen = Date.now();
  pendingUsage.set(userId, cur);
}

function pendingTotals(): { bytes: number; users: number } {
  let bytes = 0;
  for (const v of pendingUsage.values()) bytes += v.up + v.down;
  return { bytes, users: pendingUsage.size };
}

/** Flush coalesced counters to D1 when thresholds are crossed (called at WS close). */
export async function maybeFlushUsage(db: D1Database): Promise<void> {
  const t = pendingTotals();
  const due = t.users > 0 && (
    t.bytes >= DEFAULTS.usageFlushBytes ||
    t.users >= DEFAULTS.usageFlushUsers ||
    Date.now() - lastFlush >= DEFAULTS.usageFlushIntervalMs
  );
  if (!due) return;
  await flushUsage(db);
}

export async function flushUsage(db: D1Database): Promise<void> {
  if (pendingUsage.size === 0) return;
  const snapshot = new Map(pendingUsage);
  pendingUsage.clear();
  const now = Date.now();
  const batch: D1PreparedStatement[] = [];
  for (const [id, v] of snapshot) {
    batch.push(db.prepare(
      'UPDATE users SET used_up = used_up + ?1, used_down = used_down + ?2, last_seen = ?3 WHERE id = ?4',
    ).bind(v.up, v.down, now, id));
  }
  try {
    await db.batch(batch);
    lastFlush = now;
    invalidateUsers();
  } catch (error) {
    // Keep failed updates available for retry; newer updates may already exist.
    for (const [id, v] of snapshot) queueUsage(id, v.up, v.down);
    throw error;
  }
}
