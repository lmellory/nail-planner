// Все запросы к D1. ВАЖНО: каждый запрос фильтруется по user_id.
import type { Appointment, Client, UserRow } from './types';

export type AppointmentInput = Omit<Appointment, 'id' | 'user_id'>;
export type ClientInput = { name: string; phone?: string | null; telegram?: string | null; notes?: string | null };

/** Время вечернего уведомления по умолчанию для новых пользователей. */
export const DEFAULT_NOTIFY_TIME = '22:00';

/**
 * Через сколько секунд бот удаляет из чата своё сообщение «Новая запись».
 * Должно быть меньше 48 часов: позже Telegram не даёт удалить сообщение.
 */
export const NEW_APPT_MSG_TTL_SEC = 24 * 60 * 60;

export async function getUser(db: D1Database, userId: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first<UserRow>();
}

export async function ensureUser(db: D1Database, userId: number, tz: string): Promise<UserRow> {
  // notify_time задаём явно (а не через DEFAULT в схеме), чтобы значение по умолчанию жило в коде
  await db
    .prepare('INSERT OR IGNORE INTO users (user_id, tz, notify_time) VALUES (?, ?, ?)')
    .bind(userId, tz, DEFAULT_NOTIFY_TIME)
    .run();
  return (await getUser(db, userId))!;
}

export async function listAppointments(db: D1Database, userId: number, from: string, to: string) {
  const r = await db
    .prepare('SELECT * FROM appointments WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time')
    .bind(userId, from, to).all<Appointment>();
  return r.results;
}

export async function getAppointment(db: D1Database, userId: number, id: number) {
  return db.prepare('SELECT * FROM appointments WHERE user_id = ? AND id = ?').bind(userId, id).first<Appointment>();
}

/**
 * Записи дня, пересекающиеся с интервалом [start, end).
 * Учитывает как записи с интервалом, так и точечные записи без end_time.
 */
export async function findConflicts(
  db: D1Database,
  userId: number,
  date: string,
  start: string,
  end: string,
  excludeId = 0,
) {
  const r = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE user_id = ? AND date = ? AND id != ?
         AND (
           (end_time IS NOT NULL AND start_time < ? AND end_time > ?)
           OR
           (end_time IS NULL AND start_time >= ? AND start_time < ?)
         )`,
    )
    .bind(userId, date, excludeId, end, start, start, end)
    .all<Appointment>();
  return r.results;
}

export async function insertAppointment(
  db: D1Database,
  userId: number,
  data: AppointmentInput,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO appointments (user_id, date, start_time, end_time, client_name, who, service,
         manicure_coating, pedicure_coating, comment) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      userId,
      data.date,
      data.start_time,
      data.end_time ?? null,
      data.client_name,
      data.who,
      data.service,
      data.manicure_coating,
      data.pedicure_coating,
      data.comment,
    )
    .run();
  return res.meta.last_row_id as number;
}

export async function updateAppointment(
  db: D1Database,
  userId: number,
  id: number,
  data: AppointmentInput,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE appointments SET date=?, start_time=?, end_time=?, client_name=?, who=?, service=?,
         manicure_coating=?, pedicure_coating=?, comment=?, updated_at=datetime('now')
       WHERE user_id=? AND id=?`,
    )
    .bind(
      data.date,
      data.start_time,
      data.end_time ?? null,
      data.client_name,
      data.who,
      data.service,
      data.manicure_coating,
      data.pedicure_coating,
      data.comment,
      userId,
      id,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteAppointment(db: D1Database, userId: number, id: number): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM appointments WHERE user_id=? AND id=?')
    .bind(userId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getDayNote(db: D1Database, userId: number, date: string): Promise<string> {
  const row = await db
    .prepare('SELECT text FROM day_notes WHERE user_id=? AND date=?')
    .bind(userId, date)
    .first<{ text: string }>();
  return row?.text ?? '';
}

export async function upsertDayNote(db: D1Database, userId: number, date: string, text: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO day_notes (user_id, date, text) VALUES (?,?,?)
       ON CONFLICT(user_id, date) DO UPDATE SET text=excluded.text`,
    )
    .bind(userId, date, text)
    .run();
}

export async function deleteDayNote(db: D1Database, userId: number, date: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM day_notes WHERE user_id=? AND date=?')
    .bind(userId, date)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function searchAppointments(db: D1Database, userId: number, query: string): Promise<Appointment[]> {
  const clean = query.trim().slice(0, 100);
  const escaped = clean.replace(/([%_\\])/g, '\\$1');
  const r = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE user_id = ? AND client_name LIKE ? ESCAPE '\\'
       ORDER BY date DESC, start_time DESC
       LIMIT 50`,
    )
    .bind(userId, `%${escaped}%`)
    .all<Appointment>();
  return r.results;
}

export async function updateUserSettings(
  db: D1Database,
  userId: number,
  settings: {
    notify_enabled?: boolean | number;
    notify_time?: string;
    tz?: string;
    notify_new_appt?: boolean | number;
    work_start_time?: string;
    work_end_time?: string;
    work_days?: string;
  },
): Promise<UserRow> {
  const current = (await getUser(db, userId))!;
  const flag = (v: boolean | number | undefined, fallback: number) =>
    v !== undefined ? (typeof v === 'boolean' ? (v ? 1 : 0) : v) : fallback;

  const notifyEnabled = flag(settings.notify_enabled, current.notify_enabled);
  const notifyTime = settings.notify_time ?? current.notify_time;
  const tz = settings.tz ?? current.tz;
  const notifyNewAppt = flag(settings.notify_new_appt, current.notify_new_appt);
  const workStart = settings.work_start_time ?? current.work_start_time ?? '09:00';
  const workEnd = settings.work_end_time ?? current.work_end_time ?? '20:00';
  const workDays = settings.work_days ?? current.work_days ?? '1,2,3,4,5,6';

  await db
    .prepare(
      `UPDATE users
       SET notify_enabled=?, notify_time=?, tz=?, notify_new_appt=?,
           work_start_time=?, work_end_time=?, work_days=?
       WHERE user_id=?`,
    )
    .bind(notifyEnabled, notifyTime, tz, notifyNewAppt, workStart, workEnd, workDays, userId)
    .run();
  return (await db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first<UserRow>())!;
}

// ===== КЛИЕНТЫ =====

export async function listClients(db: D1Database, userId: number, search?: string) {
  let query = `
    SELECT c.*,
           COUNT(a.id) as appointments_count,
           MAX(a.date) as last_visit,
           MIN(CASE WHEN a.date >= date('now') THEN a.date ELSE NULL END) as next_visit
    FROM clients c
    LEFT JOIN appointments a ON a.user_id = c.user_id AND a.client_name = c.name
    WHERE c.user_id = ?
  `;
  const params: any[] = [userId];
  if (search && search.trim()) {
    const clean = search.trim().replace(/([%_\\])/g, '\\$1');
    query += ` AND (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.telegram LIKE ? ESCAPE '\\')`;
    params.push(`%${clean}%`, `%${clean}%`, `%${clean}%`);
  }
  query += ` GROUP BY c.id ORDER BY c.name COLLATE NOCASE ASC`;
  const r = await db.prepare(query).bind(...params).all<Client>();
  return r.results;
}

export async function getClient(db: D1Database, userId: number, id: number): Promise<Client | null> {
  const query = `
    SELECT c.*,
           COUNT(a.id) as appointments_count,
           MAX(a.date) as last_visit,
           MIN(CASE WHEN a.date >= date('now') THEN a.date ELSE NULL END) as next_visit
    FROM clients c
    LEFT JOIN appointments a ON a.user_id = c.user_id AND a.client_name = c.name
    WHERE c.user_id = ? AND c.id = ?
    GROUP BY c.id
  `;
  return db.prepare(query).bind(userId, id).first<Client>();
}

export async function getClientByName(db: D1Database, userId: number, name: string): Promise<Client | null> {
  return db.prepare('SELECT * FROM clients WHERE user_id = ? AND name = ?').bind(userId, name.trim()).first<Client>();
}

export async function getClientAppointments(db: D1Database, userId: number, clientName: string) {
  const r = await db
    .prepare('SELECT * FROM appointments WHERE user_id = ? AND client_name = ? ORDER BY date DESC, start_time DESC')
    .bind(userId, clientName)
    .all<Appointment>();
  return r.results;
}

export async function insertClient(db: D1Database, userId: number, data: ClientInput): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO clients (user_id, name, phone, telegram, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET
         phone = COALESCE(excluded.phone, clients.phone),
         telegram = COALESCE(excluded.telegram, clients.telegram),
         notes = COALESCE(excluded.notes, clients.notes),
         updated_at = datetime('now')`,
    )
    .bind(userId, data.name.trim(), data.phone || null, data.telegram || null, data.notes || null)
    .run();
  return (res.meta.last_row_id as number) || 0;
}

export async function updateClient(db: D1Database, userId: number, id: number, data: ClientInput): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE clients SET name = ?, phone = ?, telegram = ?, notes = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .bind(data.name.trim(), data.phone || null, data.telegram || null, data.notes || null, userId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteClient(db: D1Database, userId: number, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM clients WHERE user_id = ? AND id = ?').bind(userId, id).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Автоматически создаем клиента, если его еще нет */
export async function ensureClientExists(db: D1Database, userId: number, name: string, who?: string | null) {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO clients (user_id, name, notes)
       VALUES (?, ?, ?)`,
    )
    .bind(userId, trimmed, who ? `Заметка: ${who}` : null)
    .run();
}

export async function getDaySummary(
  db: D1Database,
  userId: number,
  from: string,
  to: string,
): Promise<{ date: string; count: number; has_note: boolean }[]> {
  const a = await db
    .prepare(
      'SELECT date, COUNT(*) AS count FROM appointments WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY date',
    )
    .bind(userId, from, to)
    .all<{ date: string; count: number }>();
  const n = await db
    .prepare('SELECT date FROM day_notes WHERE user_id=? AND date BETWEEN ? AND ?')
    .bind(userId, from, to)
    .all<{ date: string }>();

  const noteDates = new Set(n.results.map((r) => r.date));
  const map = new Map<string, { date: string; count: number; has_note: boolean }>();
  for (const r of a.results) {
    map.set(r.date, { date: r.date, count: r.count, has_note: noteDates.has(r.date) });
  }
  for (const d of noteDates) {
    if (!map.has(d)) {
      map.set(d, { date: d, count: 0, has_note: true });
    }
  }
  return [...map.values()];
}

/** Запланировать удаление сообщения бота из чата через ttlSec секунд. */
export async function scheduleMessageDelete(
  db: D1Database,
  chatId: number,
  messageId: number,
  ttlSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<void> {
  await db
    .prepare('INSERT INTO scheduled_deletes (chat_id, message_id, delete_at) VALUES (?,?,?)')
    .bind(chatId, messageId, nowSec + ttlSec)
    .run();
}

export interface ScheduledDelete {
  id: number;
  chat_id: number;
  message_id: number;
}

/** Сообщения, которые пора удалить из чата. */
export async function getDueMessageDeletes(
  db: D1Database,
  nowSec = Math.floor(Date.now() / 1000),
  limit = 50,
): Promise<ScheduledDelete[]> {
  const r = await db
    .prepare('SELECT id, chat_id, message_id FROM scheduled_deletes WHERE delete_at <= ? ORDER BY delete_at LIMIT ?')
    .bind(nowSec, limit)
    .all<ScheduledDelete>();
  return r.results;
}

export async function removeScheduledDelete(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM scheduled_deletes WHERE id=?').bind(id).run();
}

export async function getAllAppointments(db: D1Database, userId: number): Promise<Appointment[]> {
  const r = await db
    .prepare('SELECT * FROM appointments WHERE user_id = ? ORDER BY date, start_time')
    .bind(userId)
    .all<Appointment>();
  return r.results;
}

export async function getAllDayNotes(db: D1Database, userId: number): Promise<{ date: string; text: string }[]> {
  const r = await db
    .prepare('SELECT date, text FROM day_notes WHERE user_id = ? ORDER BY date')
    .bind(userId)
    .all<{ date: string; text: string }>();
  return r.results;
}
