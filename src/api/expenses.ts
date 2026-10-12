// Траты на материалы: CRUD + подсказки названий.
//   GET    /api/expenses?from=&to=   — список за период (новые сверху)
//   GET    /api/expenses/names       — ранее использованные названия (для подсказок)
//   POST   /api/expenses             — добавить
//   PUT    /api/expenses/:id         — изменить
//   DELETE /api/expenses/:id         — удалить
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import {
  deleteExpense,
  getExpense,
  insertExpense,
  listExpenseNames,
  listExpenses,
  updateExpense,
} from '../db';
import { isDate } from '../lib/time';
import { parseAmount } from '../lib/money';
import { normalizeName } from '../lib/text';

export const expenses = new Hono<{ Bindings: Env; Variables: AppVars }>();

export { normalizeName };

/** Проверка тела запроса. Возвращает [данные, ошибка]. */
export function validateExpense(b: any) {
  if (!isDate(b?.date)) return [null, 'Некорректная дата'] as const;
  const name = normalizeName(b?.name);
  if (!name) return [null, 'Укажи, на что потрачено'] as const;
  const amount = parseAmount(b?.amount);
  if (!amount) return [null, 'Сумма: целое число от 1 до 10 000 000'] as const; // null, undefined и 0
  return [{ date: b.date as string, name, amount }, null] as const;
}

expenses.get('/names', async (c) => c.json(await listExpenseNames(c.env.DB, c.get('userId'))));

expenses.get('/', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  return c.json(await listExpenses(c.env.DB, c.get('userId'), from, to));
});

expenses.post('/', async (c) => {
  const [d, err] = validateExpense(await c.req.json().catch(() => null));
  if (!d) return c.json({ error: err }, 400);
  const id = await insertExpense(c.env.DB, c.get('userId'), d);
  return c.json({ id }, 201);
});

expenses.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  if (!(await getExpense(c.env.DB, userId, id))) return c.json({ error: 'not found' }, 404);
  const [d, err] = validateExpense(await c.req.json().catch(() => null));
  if (!d) return c.json({ error: err }, 400);
  await updateExpense(c.env.DB, userId, id, d);
  return c.json({ ok: true });
});

expenses.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  return c.json({ ok: await deleteExpense(c.env.DB, c.get('userId'), id) });
});
