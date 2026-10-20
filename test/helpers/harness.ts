import type { Database } from '../../src/types';
// Тестовая обвязка: настоящая SQLite-база (файл) с настоящими миграциями + вызовы настоящего приложения.
// Подменяется только Telegram (fetch), всё остальное — боевой код.
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { parseStatements } from '../../scripts/migrate.js';
import { createD1FromClient } from '../../src/lib/turso';
import worker from '../../src/index';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BOT_TOKEN = '123456:TEST-TOKEN';
export const OWNER = 111;
export const OTHER = 222;
/** «Сейчас» в тестах: среда 2026-10-14, 12:00 по Кишинёву (UTC+3). */
export const NOW = '2026-10-14T09:00:00Z';

/** Применяет миграции по порядку (каждая — одной транзакцией, как в scripts/migrate.js). upTo — до этой включительно. */
export async function migrate(client: Client, upTo?: string) {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set((await client.execute('SELECT version FROM schema_migrations')).rows.map((r) => String(r.version)));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const version = file.replace(/\.sql$/, '');
    if (upTo && version > upTo) break;
    if (applied.has(version)) continue;
    const stmts: string[] = parseStatements(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    await client.batch(
      [...stmts.map((sql) => ({ sql })), { sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', args: [version] }],
      'write',
    );
  }
}

export async function createTestDb(opts: { upTo?: string } = {}) {
  const dir = mkdtempSync(path.join(process.env.NAIL_PLANNER_TEST_TMP || tmpdir(), 'np-test-'));
  const url = 'file:' + path.join(dir, 'db.sqlite');
  const client = createClient({ url });
  await migrate(client, opts.upTo);
  return {
    client,
    url,
    dir,
    db: createD1FromClient(client),
    close() {
      client.close();
      // npm test удаляет общую временную папку после выхода Vitest:
      // нативный libSQL на Windows может удерживать файлы до завершения процесса.
      if (!process.env.NAIL_PLANNER_TEST_TMP) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}

export function makeEnv(db: Database, extra: Record<string, unknown> = {}): any {
  return {
    DB: db,
    BOT_TOKEN,
    ALLOWED_IDS: `${OWNER},${OTHER}`,
    TZ: 'Europe/Chisinau',
    APP_URL: 'https://app.test',
    ASSETS: { fetch: async () => new Response('asset') },
    ...extra,
  };
}

const enc = new TextEncoder();
const hmac = async (key: ArrayBuffer | Uint8Array, data: string) =>
  crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(data));

/** Подписанные данные Mini App ровно в том виде, как их проверяет сервер. */
export async function signInitData(userId: number, botToken = BOT_TOKEN): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  });
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const sig = [...new Uint8Array(await hmac(secret, check))].map((b) => b.toString(16).padStart(2, '0')).join('');
  params.set('hash', sig);
  return params.toString();
}

export interface ApiResult { status: number; json: any }

/** Вызов API от имени пользователя userId (userId = null → без подписи). */
export async function api(env: any, userId: number | null, method: string, url: string, body?: unknown): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (userId !== null) headers['X-Init-Data'] = await signInitData(userId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(
    new Request('https://app.test' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    undefined as any,
  );
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, json };
}

export interface TgCall { method: string; text?: string; filename?: string; file?: string; caption?: string }

/** Подменяет fetch: запросы к Telegram записываются, файлы читаются. */
export function stubTelegram(): TgCall[] {
  const sent: TgCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init?: any) => {
      const rec: TgCall = { method: String(url).split('/').pop()! };
      const body = init?.body;
      if (body instanceof FormData) {
        const doc = body.get('document');
        if (doc && typeof doc !== 'string') { rec.filename = (doc as File).name; rec.file = await (doc as File).text(); }
        rec.caption = String(body.get('caption') ?? '');
      } else if (typeof body === 'string') {
        try { Object.assign(rec, JSON.parse(body)); } catch { /* не JSON */ }
      }
      sent.push(rec);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }),
  );
  return sent;
}

/** Данные для статистики: неделя 12–18 окт, «сейчас» среда 12:00. Итоги см. в test/api.test.ts. */
export async function seedWeek(env: any, user = OWNER) {
  const add = async (o: Record<string, unknown>) => {
    const r = await api(env, user, 'POST', '/api/appointments', { service: 'fingers', client_name: 'Инна', ...o });
    if (r.status !== 201) throw new Error('seed appointment failed: ' + JSON.stringify(r.json));
  };
  await add({ date: '2026-10-12', start_time: '10:00', price: 800 });                        // состоялась
  await add({ date: '2026-10-13', start_time: '10:00', price: 1200, client_name: 'Мария' }); // состоялась
  await add({ date: '2026-10-14', start_time: '11:00', price: 500 });                        // сегодня, уже началась
  await add({ date: '2026-10-14', start_time: '15:00', price: 700 });                        // сегодня позже → ожидается
  await add({ date: '2026-10-15', start_time: '10:00', price: 900 });                        // будущее → ожидается
  await add({ date: '2026-10-13', start_time: '14:00', price: 600, status: 'cancelled' });   // не считается
  await add({ date: '2026-10-12', start_time: '15:00', price: 400, status: 'no_show' });     // не считается
  await add({ date: '2026-10-12', start_time: '17:00' });                                    // состоялась, без цены
  await add({ date: '2026-10-06', start_time: '10:00', price: 1000 });                       // прошлая неделя
  const exp = (date: string, name: string, amount: number) => api(env, user, 'POST', '/api/expenses', { date, name, amount });
  await exp('2026-10-12', 'гель-лак', 450);
  await exp('2026-10-13', 'Гель-лак', 300);
  await exp('2026-10-14', 'Пилки', 150);
  await exp('2026-10-07', 'Пилки', 200); // прошлая неделя
}
