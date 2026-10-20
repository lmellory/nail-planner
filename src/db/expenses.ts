import type { Database } from '../types';
// Запросы expenses. Данные мастера всегда ограничиваются user_id.
import type { Expense, ExpenseInput } from '../types';

// ===== Траты на материалы =====

export async function listExpenses(
  db: Database,
  userId: number,
  from: string,
  to: string,
  limit = 1000,
): Promise<Expense[]> {
  const r = await db
    .prepare(
      `SELECT id, user_id, date, name, amount FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ?
       ORDER BY date DESC, id DESC LIMIT ?`,
    )
    .bind(userId, from, to, limit)
    .all<Expense>();
  return r.results;
}

export async function getExpense(db: Database, userId: number, id: number): Promise<Expense | null> {
  return db
    .prepare('SELECT id, user_id, date, name, amount FROM expenses WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .first<Expense>();
}

export async function insertExpense(db: Database, userId: number, data: ExpenseInput): Promise<number> {
  const res = await db
    .prepare('INSERT INTO expenses (user_id, date, name, amount) VALUES (?,?,?,?)')
    .bind(userId, data.date, data.name, data.amount)
    .run();
  return res.meta.last_row_id as number;
}

export async function updateExpense(db: Database, userId: number, id: number, data: ExpenseInput): Promise<boolean> {
  const res = await db
    .prepare("UPDATE expenses SET date=?, name=?, amount=?, updated_at=datetime('now') WHERE user_id=? AND id=?")
    .bind(data.date, data.name, data.amount, userId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteExpense(db: Database, userId: number, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM expenses WHERE user_id=? AND id=?').bind(userId, id).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Ранее использованные названия: частые и свежие сверху (для подсказок в форме). */
export async function listExpenseNames(db: Database, userId: number): Promise<string[]> {
  const r = await db
    .prepare(
      `SELECT name FROM expenses WHERE user_id = ?
       GROUP BY name ORDER BY COUNT(*) DESC, MAX(date) DESC LIMIT 100`,
    )
    .bind(userId)
    .all<{ name: string }>();
  return r.results.map((x) => x.name);
}

export async function getAllExpenses(db: Database, userId: number): Promise<Expense[]> {
  const r = await db
    .prepare('SELECT id, user_id, date, name, amount FROM expenses WHERE user_id = ? ORDER BY date, id')
    .bind(userId)
    .all<Expense>();
  return r.results;
}
