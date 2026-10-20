import type { Database } from '../types';
// Запросы admin. Данные мастера всегда ограничиваются user_id.
import type { Appointment } from '../types';
import { getIncomeByDay } from './reports';

/** Все пользователи в базе и число их записей (для команды администратора /export). */
export async function listUsersOverview(db: Database): Promise<Array<{ user_id: number; appointments: number }>> {
  const r = await db
    .prepare(
      `SELECT u.user_id AS user_id, COUNT(a.id) AS appointments
       FROM users u LEFT JOIN appointments a ON a.user_id = u.user_id
       GROUP BY u.user_id ORDER BY u.user_id`,
    )
    .all<{ user_id: number; appointments: number }>();
  return r.results.map((x) => ({ user_id: Number(x.user_id), appointments: Number(x.appointments) }));
}

/** Строка пользователя с подсчётами для команд администратора /users и /user. */
export interface UserAdminRow {
  user_id: number;
  tz: string;
  notify_enabled: number;
  notify_time: string;
  backup_enabled: number;
  last_backup_date: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  work_days: string | null;
  created_at: string;
  appointments: number;     // всего записей
  upcoming: number;         // живые записи с сегодняшней даты и позже
  clients: number;
  expenses: number;
  last_appointment: string | null; // дата самой поздней записи
}

/**
 * Пользователи с подсчётами (для /users и /user). today — сегодняшняя дата YYYY-MM-DD.
 * onlyId — вернуть только этого пользователя.
 */
export async function listUsersAdmin(db: Database, today: string, onlyId?: number): Promise<UserAdminRow[]> {
  const r = await db
    .prepare(
      `SELECT u.user_id, u.tz, u.notify_enabled, u.notify_time, u.backup_enabled, u.last_backup_date,
              u.work_start_time, u.work_end_time, u.work_days, u.created_at,
              (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.user_id) AS appointments,
              (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.user_id AND a.status = 'scheduled' AND a.date >= ?) AS upcoming,
              (SELECT COUNT(*) FROM clients c WHERE c.user_id = u.user_id) AS clients,
              (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.user_id) AS expenses,
              (SELECT MAX(a.date) FROM appointments a WHERE a.user_id = u.user_id) AS last_appointment
       FROM users u
       ${onlyId === undefined ? '' : 'WHERE u.user_id = ?'}
       ORDER BY u.user_id`,
    )
    .bind(...(onlyId === undefined ? [today] : [today, onlyId]))
    .all<UserAdminRow>();
  return r.results.map((x) => ({
    ...x,
    user_id: Number(x.user_id),
    appointments: Number(x.appointments),
    upcoming: Number(x.upcoming),
    clients: Number(x.clients),
    expenses: Number(x.expenses),
  }));
}

/** Сводка по всей базе для команды администратора /stats. */
export interface GlobalStats {
  users: number;
  appointments: number;
  clients: number;
  expenses: number;
  upcoming: number;         // живые записи с сегодняшней даты и позже
  today: number;            // живые записи на сегодня
  tomorrow: number;         // живые записи на завтра
  created_last_7d: number;  // записей добавлено за последние 7 дней
  pending_deletes: number;  // сообщений бота в очереди на удаление из чата
}

export async function getGlobalStats(db: Database, today: string, tomorrow: string, weekAgo: string): Promise<GlobalStats> {
  const r = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM appointments) AS appointments,
         (SELECT COUNT(*) FROM clients) AS clients,
         (SELECT COUNT(*) FROM expenses) AS expenses,
         (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND date >= ?) AS upcoming,
         (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND date = ?) AS today,
         (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND date = ?) AS tomorrow,
         (SELECT COUNT(*) FROM appointments WHERE created_at >= ?) AS created_last_7d,
         (SELECT COUNT(*) FROM scheduled_deletes) AS pending_deletes`,
    )
    .bind(today, today, tomorrow, weekAgo)
    .first<Record<string, number>>();
  const n = (k: string) => Number(r?.[k]) || 0;
  return {
    users: n('users'),
    appointments: n('appointments'),
    clients: n('clients'),
    expenses: n('expenses'),
    upcoming: n('upcoming'),
    today: n('today'),
    tomorrow: n('tomorrow'),
    created_last_7d: n('created_last_7d'),
    pending_deletes: n('pending_deletes'),
  };
}

/** Применённые миграции: сколько и какая последняя (для /health). */
export async function getMigrationsInfo(db: Database): Promise<{ count: number; latest: string | null }> {
  const r = await db
    .prepare('SELECT COUNT(*) AS count, MAX(version) AS latest FROM schema_migrations')
    .first<{ count: number; latest: string | null }>();
  return { count: Number(r?.count) || 0, latest: r?.latest ?? null };
}

/** Доход пользователя за период по состоявшимся записям (для карточки /user). */
export async function getUserIncomeTotal(
  db: Database,
  userId: number,
  from: string,
  to: string,
  nowDate: string,
  nowTime: string,
): Promise<number> {
  const rows = await getIncomeByDay(db, userId, from, to, nowDate, nowTime);
  return rows.reduce((s, x) => s + (Number(x.sum) || 0), 0);
}

/** Записи всех мастеров за всё время (для роли «наблюдатель» и администратора). */
export async function getEveryAppointment(db: Database): Promise<Appointment[]> {
  const r = await db.prepare('SELECT * FROM appointments ORDER BY user_id, date, start_time').all<Appointment>();
  return r.results;
}
