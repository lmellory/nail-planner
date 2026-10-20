import type { Database } from '../types';
// Запросы appointments. Данные мастера всегда ограничиваются user_id.
import type { Appointment } from '../types';

export type AppointmentInput = Omit<Appointment, 'id' | 'user_id'>;

export async function listAppointments(db: Database, userId: number, from: string, to: string) {
  const r = await db
    .prepare('SELECT * FROM appointments WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time')
    .bind(userId, from, to).all<Appointment>();
  return r.results;
}

export async function getAppointment(db: Database, userId: number, id: number) {
  return db.prepare('SELECT * FROM appointments WHERE user_id = ? AND id = ?').bind(userId, id).first<Appointment>();
}

/**
 * Записи дня, пересекающиеся с интервалом [start, end).
 * Учитывает как записи с интервалом, так и точечные записи без end_time.
 */
export async function findConflicts(
  db: Database,
  userId: number,
  date: string,
  start: string,
  end: string,
  excludeId = 0,
) {
  const r = await db
    .prepare(
      `SELECT * FROM appointments
       WHERE user_id = ? AND date = ? AND id != ? AND status = 'scheduled'
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
  db: Database,
  userId: number,
  data: AppointmentInput,
  tz = 'UTC',
): Promise<number> {
  const statement = db
    .prepare(
      `INSERT INTO appointments (user_id, date, start_time, end_time, client_name, who, service,
         manicure_coating, pedicure_coating, comment, price, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      data.price ?? null,
      data.status ?? 'scheduled',
    );
  const [res] = await db.batch([
    statement,
    db.prepare('INSERT OR IGNORE INTO clients (user_id, name, notes) VALUES (?, ?, ?)')
      .bind(userId, data.client_name, data.who ? `Заметка: ${data.who}` : null),
    db.prepare('INSERT OR IGNORE INTO users (user_id, tz, notify_time) VALUES (?, ?, ?)').bind(userId, tz, '22:00'),
  ]);
  return res.meta.last_row_id as number;
}

export async function updateAppointment(
  db: Database,
  userId: number,
  id: number,
  data: AppointmentInput,
): Promise<boolean> {
  const statement = db
    .prepare(
      `UPDATE appointments SET date=?, start_time=?, end_time=?, client_name=?, who=?, service=?,
         manicure_coating=?, pedicure_coating=?, comment=?, price=?, status=?, updated_at=datetime('now')
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
      data.price ?? null,
      data.status ?? 'scheduled',
      userId,
      id,
    );
  const [res] = await db.batch([
    statement,
    db.prepare('INSERT OR IGNORE INTO clients (user_id, name, notes) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM appointments WHERE user_id=? AND id=?)')
      .bind(userId, data.client_name, data.who ? `Заметка: ${data.who}` : null, userId, id),
  ]);
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteAppointment(db: Database, userId: number, id: number): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM appointments WHERE user_id=? AND id=?')
    .bind(userId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function searchAppointments(db: Database, userId: number, query: string): Promise<Appointment[]> {
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

export async function getAllAppointments(db: Database, userId: number): Promise<Appointment[]> {
  const r = await db
    .prepare('SELECT * FROM appointments WHERE user_id = ? ORDER BY date, start_time')
    .bind(userId)
    .all<Appointment>();
  return r.results;
}
