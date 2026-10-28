/**
 * NYX bootstrap based on Gozargah's storage interfaces (MIT; see notices).
 * Fail closed without D1 or a long, operator-provided bootstrap secret.
 */
import { DEFAULTS, Env, GzError } from './config';
import { loadSettings, SettingsBlob, ensureSchema } from './db/store';
import { getAdminUser } from './db/users';
import { pbkdf2Hex, randomHex } from './utils/crypto';

export interface EffectiveSettings extends SettingsBlob {
  dbOk: boolean;
  uuid: string;
  trojanPass: string;
}

export async function getEffectiveSettings(env: Env, _host: string): Promise<EffectiveSettings> {
  if (!env.GZ_DB) throw new GzError('database_not_bound', 'no_db');
  const db = env.GZ_DB;
  await ensureSchema(db);
  let settings = await loadSettings(db);
  if (!settings) {
    const password = env.NYX_BOOTSTRAP_PASSWORD;
    if (typeof password !== 'string' || password.length < 16 || password.length > 256) {
      throw new GzError('bootstrap_secret_required', 'not_configured');
    }
    await bootstrapSettings(db, password);
    settings = await loadSettings(db);
  }
  const admin = await getAdminUser(db);
  if (!settings || !admin) throw new GzError('bootstrap_incomplete', 'not_configured');
  return { ...settings, dbOk: true, uuid: admin.uuid, trojanPass: admin.trojanPass };
}

/**
 * INSERT OR IGNORE preserves previously initialized settings. The admin insert
 * is one SQLite statement guarded by NOT EXISTS; no existing user is replaced.
 */
export async function bootstrapSettings(db: D1Database, password: string): Promise<void> {
  await ensureSchema(db);
  const salt = randomHex(16);
  const blob: SettingsBlob = {
    schemaVersion: 1,
    panelPath: DEFAULTS.panelPath,
    subPath: DEFAULTS.subPath,
    proxyIPs: [...DEFAULTS.proxyIPs],
    resetCycle: 'none',
    passwordSalt: salt,
    passwordHash: await pbkdf2Hex(password, salt, DEFAULTS.pwIterations),
    sessionEpoch: randomHex(16),
    pwIterations: DEFAULTS.pwIterations,
    isDefaultPassword: false,
    createdAt: Date.now(),
  };
  await db.prepare('INSERT OR IGNORE INTO kv_store (key, value, rev, updated_at) VALUES (?1, ?2, 1, ?3)')
    .bind('settings', JSON.stringify(blob), Date.now()).run();
  await db.prepare(
    'INSERT INTO users (name, uuid, trojan_pass, quota_bytes, expiry_at, enabled, is_admin, created_at) ' +
    "SELECT 'admin', ?1, ?2, 0, 0, 1, 1, ?3 WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)",
  ).bind(crypto.randomUUID(), randomHex(24), Date.now()).run();
}
