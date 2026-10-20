import type { Database } from '../types';
// Доступ пользователей: секрет ALLOWED_IDS + команды администратора /adduser, /ban, /unban (таблица access).
//   итоговый доступ = (ALLOWED_IDS ∪ добавленные) минус заблокированные.
// При сбое чтения access обычный доступ закрыт: блокировки нельзя обходить через ALLOWED_IDS.
import type { Env } from '../types';

/** Разбор списка Telegram ID через запятую; нечисла и неположительные значения отбрасываются. */
export function parseIdList(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Администраторы: ADMIN_ID — один Telegram ID или несколько через запятую. Пустое или кривое значение = админов нет. */
export function isAdmin(env: Pick<Env, 'ADMIN_ID'>, userId: number): boolean {
  return Number.isInteger(userId) && userId > 0 && parseIdList(env.ADMIN_ID).includes(userId);
}

export interface AccessRow {
  user_id: number;
  added: number;  // 1 — доступ выдан командой /adduser
  banned: number; // 1 — заблокирован командой /ban
}

/** allowed — доступ есть; banned — заблокирован; none — доступа нет (и не блокировали). */
export type AccessState = 'allowed' | 'banned' | 'none';

type AccessEnv = Pick<Env, 'DB' | 'ALLOWED_IDS'>;

/** Чистая функция: состояние доступа по секрету и строке из таблицы access. */
export function accessState(inSecret: boolean, row: Pick<AccessRow, 'added' | 'banned'> | null): AccessState {
  if (row?.banned) return 'banned';
  return inSecret || row?.added ? 'allowed' : 'none';
}

const toRow = (x: AccessRow): AccessRow => ({ user_id: Number(x.user_id), added: Number(x.added), banned: Number(x.banned) });

/** Строка access пользователя. Бросает исключение, если запрос не удался (для команд администратора). */
export async function getAccessRow(db: Database, userId: number): Promise<AccessRow | null> {
  const r = await db.prepare('SELECT user_id, added, banned FROM access WHERE user_id = ?').bind(userId).first<AccessRow>();
  return r ? toRow(r) : null;
}

/** Все строки access. Бросает исключение, если запрос не удался. */
export async function listAccess(db: Database): Promise<AccessRow[]> {
  const r = await db.prepare('SELECT user_id, added, banned FROM access').all<AccessRow>();
  return r.results.map(toRow);
}

/** Как listAccess, но при сбое возвращает null (доступ закрыт). */
async function listAccessSafe(db: Database): Promise<AccessRow[] | null> {
  try {
    return await listAccess(db);
  } catch (e) {
    console.error('access: таблица недоступна, доступ закрыт', e);
    return null;
  }
}

export interface AccessSnapshot {
  allowed: number[]; // у кого сейчас есть доступ
  banned: number[];  // кто заблокирован (в том числе тот, кого нет в ALLOWED_IDS)
}

export async function getAccessSnapshot(env: AccessEnv): Promise<AccessSnapshot> {
  const rows = await listAccessSafe(env.DB);
  if (!rows) return { allowed: [], banned: [] };
  const banned = rows.filter((r) => r.banned).map((r) => r.user_id);
  const blocked = new Set(banned);
  const ids = new Set([...parseIdList(env.ALLOWED_IDS), ...rows.filter((r) => r.added).map((r) => r.user_id)]);
  return { allowed: [...ids].filter((id) => !blocked.has(id)), banned };
}

/** ID всех, у кого сейчас есть доступ (для cron-рассылок, /broadcast). */
export async function getAllowedIds(env: AccessEnv): Promise<number[]> {
  return (await getAccessSnapshot(env)).allowed;
}

/** Состояние доступа одного пользователя (при сбое чтения таблицы — доступ закрыт). */
export async function getAccessState(env: AccessEnv, userId: number): Promise<AccessState> {
  let row: AccessRow | null = null;
  try {
    row = await getAccessRow(env.DB, userId);
  } catch (e) {
    console.error('access: таблица недоступна, доступ закрыт', e);
    return 'none';
  }
  return accessState(parseIdList(env.ALLOWED_IDS).includes(userId), row);
}

/** Есть ли у пользователя доступ (приложение и бот). */
export async function isAllowedUser(env: AccessEnv, userId: number): Promise<boolean> {
  return (await getAccessState(env, userId)) === 'allowed';
}

/** /adduser: выдать доступ. Блокировку не снимает (её снимает /unban). */
export async function grantAccess(db: Database, userId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO access (user_id, added) VALUES (?, 1)
       ON CONFLICT(user_id) DO UPDATE SET added = 1, updated_at = datetime('now')`,
    )
    .bind(userId)
    .run();
}

/** /ban и /unban. Строка без выданного доступа и без блокировки удаляется. */
export async function setBanned(db: Database, userId: number, banned: boolean): Promise<void> {
  if (banned) {
    await db
      .prepare(
        `INSERT INTO access (user_id, banned) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET banned = 1, updated_at = datetime('now')`,
      )
      .bind(userId)
      .run();
    return;
  }
  await db.prepare("UPDATE access SET banned = 0, updated_at = datetime('now') WHERE user_id = ?").bind(userId).run();
  await db.prepare('DELETE FROM access WHERE user_id = ? AND added = 0 AND banned = 0').bind(userId).run();
}
