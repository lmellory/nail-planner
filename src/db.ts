// Все запросы к D1. ВАЖНО: каждый запрос фильтруется по user_id.
import type { Appointment, UserRow } from './types';

export type AppointmentInput = Omit<Appointment, 'id' | 'user_id'>;

export async function ensureUser(db: D1Database, userId: number, tz: string): Promise<UserRow> {
  await db.prepare('INSERT OR IGNORE INTO users (user_id, tz) VALUES (?, ?)').bind(userId, tz).run();
  return (await db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first<UserRow>())!;
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

/** Записи дня, пересекающиеся с интервалом [start, end). excludeId — при редактировании. */
export async function findConflicts(
  db: D1Database, userId: number, date: string, start: string, end: string, excludeId = 0,
) {
  const r = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE user_id = ? AND date = ? AND id != ? AND start_time < ? AND end_time > ?`,
    )
    .bind(userId, date, excludeId, end, start).all<Appointment>();
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
      data.end_time,
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
      data.end_time,
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
  settings: { notify_enabled: boolean | number; notify_time: string; tz: string },
): Promise<UserRow> {
  const enabled = typeof settings.notify_enabled === 'boolean' ? (settings.notify_enabled ? 1 : 0) : settings.notify_enabled;
  await db
    .prepare('UPDATE users SET notify_enabled=?, notify_time=?, tz=? WHERE user_id=?')
    .bind(enabled, settings.notify_time, settings.tz, userId)
    .run();
  return (await db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first<UserRow>())!;
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
