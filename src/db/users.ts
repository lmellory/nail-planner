import type { Database } from '../types';
// Запросы users. Данные мастера всегда ограничиваются user_id.
import type { UserRow } from '../types';
import { settingsStatement, type UserSettings } from '../lib/settings';

/** Время вечернего уведомления по умолчанию для новых пользователей. */
export const DEFAULT_NOTIFY_TIME = '22:00';

export async function getUser(db: Database, userId: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first<UserRow>();
}

/** Запоминает имя и @username пользователя (только если он уже есть в базе; нового пользователя не создаёт). */
export async function saveUserName(db: Database, userId: number, name: string, username: string | null): Promise<void> {
  await db
    .prepare('UPDATE users SET display_name = ?, username = ? WHERE user_id = ? AND (display_name IS NOT ? OR username IS NOT ?)')
    .bind(name || null, username, userId, name || null, username)
    .run();
}

/** Имена пользователей для админ-панели: ID → {name, username}. Бросает исключение, если миграция 0014 не применена. */
export async function getUserNames(db: Database): Promise<Map<number, { name: string | null; username: string | null }>> {
  const r = await db
    .prepare('SELECT user_id, display_name, username FROM users')
    .all<{ user_id: number; display_name: string | null; username: string | null }>();
  return new Map(r.results.map((x) => [Number(x.user_id), { name: x.display_name ?? null, username: x.username ?? null }]));
}

export async function ensureUser(db: Database, userId: number, tz: string): Promise<UserRow> {
  // notify_time задаём явно (а не через DEFAULT в схеме), чтобы значение по умолчанию жило в коде
  await db
    .prepare('INSERT OR IGNORE INTO users (user_id, tz, notify_time) VALUES (?, ?, ?)')
    .bind(userId, tz, DEFAULT_NOTIFY_TIME)
    .run();
  return (await getUser(db, userId))!;
}

export async function updateUserSettings(db: Database, userId: number, settings: UserSettings): Promise<UserRow> {
  const statement = settingsStatement(db, userId, settings);
  if (statement) await statement.run();
  return (await getUser(db, userId))!;
}
