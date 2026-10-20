import type { Database } from '../types';
// Запросы reports. Данные мастера всегда ограничиваются user_id.
import type { DayRow, ExpenseDayRow, MaterialRow } from '../lib/stats';

/** Условие «запись состоялась к моменту now»: живая и её начало уже наступило. Параметры: nowDate, nowDate, nowTime. */
const HELD_SQL = "status = 'scheduled' AND (date < ? OR (date = ? AND start_time <= ?))";

/** Доходы по дням за период — только состоявшиеся записи: сумма цен, число записей с ценой и без неё. */
export async function getIncomeByDay(
  db: Database,
  userId: number,
  from: string,
  to: string,
  nowDate: string,
  nowTime: string,
): Promise<DayRow[]> {
  const r = await db
    .prepare(
      `SELECT date, COALESCE(SUM(price), 0) AS sum, COUNT(price) AS paid, COUNT(*) - COUNT(price) AS unpaid
       FROM appointments
       WHERE user_id = ? AND date >= ? AND date <= ? AND ${HELD_SQL}
       GROUP BY date`,
    )
    .bind(userId, from, to, nowDate, nowDate, nowTime)
    .all<DayRow>();
  return r.results;
}

/** Ожидаемый доход: будущие живые записи с ценой в периоде. */
export async function getExpectedIncome(
  db: Database,
  userId: number,
  from: string,
  to: string,
  nowDate: string,
  nowTime: string,
): Promise<{ sum: number; count: number }> {
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(price), 0) AS sum, COUNT(price) AS count
       FROM appointments
       WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'scheduled'
         AND NOT (date < ? OR (date = ? AND start_time <= ?))`,
    )
    .bind(userId, from, to, nowDate, nowDate, nowTime)
    .first<{ sum: number; count: number }>();
  return { sum: Number(r?.sum) || 0, count: Number(r?.count) || 0 };
}

/** Сколько записей в периоде по статусам (для «сорвалось записей»). */
export async function getStatusCounts(
  db: Database,
  userId: number,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const r = await db
    .prepare(
      'SELECT status, COUNT(*) AS count FROM appointments WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY status',
    )
    .bind(userId, from, to)
    .all<{ status: string; count: number }>();
  return Object.fromEntries(r.results.map((x) => [x.status, Number(x.count)]));
}

/** Траты по дням за период: сумма и число покупок. */
export async function getExpensesByDay(db: Database, userId: number, from: string, to: string): Promise<ExpenseDayRow[]> {
  const r = await db
    .prepare(
      `SELECT date, SUM(amount) AS sum, COUNT(*) AS count FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY date`,
    )
    .bind(userId, from, to)
    .all<ExpenseDayRow>();
  return r.results;
}

/** Траты по материалам за период (самые большие сверху). */
export async function getExpensesByName(db: Database, userId: number, from: string, to: string): Promise<MaterialRow[]> {
  const r = await db
    .prepare(
      `SELECT name, SUM(amount) AS sum, COUNT(*) AS count FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ?
       GROUP BY name ORDER BY sum DESC, name LIMIT 100`,
    )
    .bind(userId, from, to)
    .all<MaterialRow>();
  return r.results;
}
