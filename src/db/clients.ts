import type { Database } from '../types';
// Запросы clients. Данные мастера всегда ограничиваются user_id.
import type { Appointment, Client } from '../types';
import { getUser } from './users';
import { nowInTz } from '../lib/time';

export type ClientInput = { name: string; phone?: string | null; telegram?: string | null; notes?: string | null; birthday?: string | null };

// ===== КЛИЕНТЫ =====

export async function listClients(db: Database, userId: number, search?: string) {
  const u = await getUser(db, userId);
  const now = nowInTz(u?.tz || 'UTC');
  let query = `
    SELECT c.*,
           COUNT(a.id) as appointments_count,
           MAX(CASE WHEN a.date < ? OR (a.date = ? AND a.start_time <= ?) THEN a.date ELSE NULL END) as last_visit,
           MIN(CASE WHEN a.date > ? OR (a.date = ? AND a.start_time > ?) THEN a.date ELSE NULL END) as next_visit
    FROM clients c
    LEFT JOIN appointments a ON a.user_id = c.user_id AND a.client_name = c.name AND a.status = 'scheduled'
    WHERE c.user_id = ?
  `;
  const params: (string | number)[] = [now.date, now.date, now.time, now.date, now.date, now.time, userId];
  if (search && search.trim()) {
    const clean = search.trim().replace(/([%_\\])/g, '\\$1');
    query += ` AND (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.telegram LIKE ? ESCAPE '\\')`;
    params.push(`%${clean}%`, `%${clean}%`, `%${clean}%`);
  }
  query += ` GROUP BY c.id ORDER BY c.name COLLATE NOCASE ASC`;
  const r = await db.prepare(query).bind(...params).all<Client>();
  return r.results;
}

export async function getClient(db: Database, userId: number, id: number): Promise<Client | null> {
  const u = await getUser(db, userId);
  const now = nowInTz(u?.tz || 'UTC');
  const query = `
    SELECT c.*,
           COUNT(a.id) as appointments_count,
           MAX(CASE WHEN a.date < ? OR (a.date = ? AND a.start_time <= ?) THEN a.date ELSE NULL END) as last_visit,
           MIN(CASE WHEN a.date > ? OR (a.date = ? AND a.start_time > ?) THEN a.date ELSE NULL END) as next_visit
    FROM clients c
    LEFT JOIN appointments a ON a.user_id = c.user_id AND a.client_name = c.name AND a.status = 'scheduled'
    WHERE c.user_id = ? AND c.id = ?
    GROUP BY c.id
  `;
  return db.prepare(query).bind(now.date, now.date, now.time, now.date, now.date, now.time, userId, id).first<Client>();
}

export async function getClientByName(db: Database, userId: number, name: string): Promise<Client | null> {
  return db.prepare('SELECT * FROM clients WHERE user_id = ? AND name = ?').bind(userId, name.trim()).first<Client>();
}

export async function getClientAppointments(db: Database, userId: number, clientName: string) {
  const r = await db
    .prepare('SELECT * FROM appointments WHERE user_id = ? AND client_name = ? ORDER BY date DESC, start_time DESC')
    .bind(userId, clientName)
    .all<Appointment>();
  return r.results;
}

export async function insertClient(db: Database, userId: number, data: ClientInput): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO clients (user_id, name, phone, telegram, notes, birthday)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET
         phone = COALESCE(excluded.phone, clients.phone),
         telegram = COALESCE(excluded.telegram, clients.telegram),
         notes = COALESCE(excluded.notes, clients.notes),
         birthday = COALESCE(excluded.birthday, clients.birthday),
         updated_at = datetime('now')`,
    )
    .bind(userId, data.name.trim(), data.phone || null, data.telegram || null, data.notes || null, data.birthday || null)
    .run();
  return (res.meta.last_row_id as number) || 0;
}

export async function updateClient(db: Database, userId: number, id: number, data: ClientInput): Promise<'ok' | 'not_found' | 'name_taken'> {
  const name = data.name.trim();
  const update = db.prepare(`UPDATE clients SET name=?, phone=?, telegram=?, notes=?, birthday=?, updated_at=datetime('now') WHERE user_id=? AND id=?`)
    .bind(name, data.phone || null, data.telegram || null, data.notes || null, data.birthday || null, userId, id);
  try {
    const result = await db.batch([
      // Читаем текущее имя внутри той же транзакции: два одновременных переименования не разрывают историю.
      db.prepare(`UPDATE appointments SET client_name=?, updated_at=datetime('now')
        WHERE user_id=? AND client_name=(SELECT name FROM clients WHERE user_id=? AND id=?)`)
        .bind(name, userId, userId, id),
      update,
    ]);
    return result[1].meta.changes ? 'ok' : 'not_found';
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: clients.user_id, clients.name')) return 'name_taken';
    throw error;
  }
}

export async function deleteClient(db: Database, userId: number, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM clients WHERE user_id = ? AND id = ?').bind(userId, id).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getClientsWithBirthday(db: Database, userId: number, birthdayDDMM: string): Promise<Client[]> {
  const r = await db
    .prepare('SELECT * FROM clients WHERE user_id = ? AND birthday = ? ORDER BY name COLLATE NOCASE ASC')
    .bind(userId, birthdayDDMM)
    .all<Client>();
  return r.results;
}

/** Автоматически создаем клиента, если его еще нет */
export async function ensureClientExists(db: Database, userId: number, name: string, who?: string | null) {
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

/** Все клиенты «как есть» (для резервной копии), без подсчёта визитов. */
export async function getAllClients(db: Database, userId: number): Promise<Client[]> {
  const r = await db.prepare('SELECT * FROM clients WHERE user_id = ? ORDER BY id').bind(userId).all<Client>();
  return r.results;
}
