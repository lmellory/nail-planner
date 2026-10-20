import type { Database } from '../types';
// Запросы notes. Данные мастера всегда ограничиваются user_id.

export async function getDayNote(db: Database, userId: number, date: string): Promise<string> {
  const row = await db
    .prepare('SELECT text FROM day_notes WHERE user_id=? AND date=?')
    .bind(userId, date)
    .first<{ text: string }>();
  return row?.text ?? '';
}

export async function upsertDayNote(db: Database, userId: number, date: string, text: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO day_notes (user_id, date, text) VALUES (?,?,?)
       ON CONFLICT(user_id, date) DO UPDATE SET text=excluded.text`,
    )
    .bind(userId, date, text)
    .run();
}

export async function deleteDayNote(db: Database, userId: number, date: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM day_notes WHERE user_id=? AND date=?')
    .bind(userId, date)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getDaySummary(
  db: Database,
  userId: number,
  from: string,
  to: string,
): Promise<{ date: string; count: number; has_note: boolean }[]> {
  const a = await db
    .prepare(
      "SELECT date, COUNT(*) AS count FROM appointments WHERE user_id=? AND date BETWEEN ? AND ? AND status='scheduled' GROUP BY date",
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

export async function getAllDayNotes(db: Database, userId: number): Promise<{ date: string; text: string }[]> {
  const r = await db
    .prepare('SELECT date, text FROM day_notes WHERE user_id = ? ORDER BY date')
    .bind(userId)
    .all<{ date: string; text: string }>();
  return r.results;
}
