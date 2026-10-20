// Доходы и траты: GET /api/stats?period=week|month|year&date=YYYY-MM-DD
// date — любая дата внутри нужного периода (по умолчанию «сегодня» в часовом поясе мастера).
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { ensureUser } from '../db/users';
import { getExpectedIncome, getExpensesByDay, getExpensesByName, getIncomeByDay, getStatusCounts } from '../db/reports';
import { isDate, nowInTz } from '../lib/time';
import { buildIncomeReport, isPeriod, periodRange, previousRange } from '../lib/stats';

export const stats = new Hono<{ Bindings: Env; Variables: AppVars }>();

stats.get('/', async (c) => {
  const userId = c.get('userId');
  const period = c.req.query('period');
  if (!isPeriod(period)) return c.json({ error: 'period: week | month | year' }, 400);

  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const now = nowInTz(u.tz);
  const date = c.req.query('date') ?? now.date;
  if (!isDate(date)) return c.json({ error: 'Некорректная дата' }, 400);

  const { from, to } = periodRange(period, date);
  const prev = previousRange(period, date);
  // В доход идут только состоявшиеся записи (живые, время начала уже прошло); будущие — «ожидается»
  const [rows, prevRows, expRows, prevExpRows, materials, expected, counts] = await Promise.all([
    getIncomeByDay(c.env.DB, userId, from, to, now.date, now.time),
    getIncomeByDay(c.env.DB, userId, prev.from, prev.to, now.date, now.time),
    getExpensesByDay(c.env.DB, userId, from, to),
    getExpensesByDay(c.env.DB, userId, prev.from, prev.to),
    getExpensesByName(c.env.DB, userId, from, to),
    getExpectedIncome(c.env.DB, userId, from, to, now.date, now.time),
    getStatusCounts(c.env.DB, userId, from, to),
  ]);
  return c.json(
    buildIncomeReport(period, from, to, rows, prevRows, expRows, prevExpRows, materials, {
      expected: expected.sum,
      expected_count: expected.count,
      no_show: counts.no_show ?? 0,
      cancelled: counts.cancelled ?? 0,
    }),
  );
});
