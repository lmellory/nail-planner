// Доходы и траты: GET /api/stats?period=week|month|year&date=YYYY-MM-DD
// date — любая дата внутри нужного периода (по умолчанию «сегодня» в часовом поясе мастера).
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { ensureUser, getExpensesByDay, getExpensesByName, getIncomeByDay } from '../db';
import { isDate, nowInTz } from '../lib/time';
import { buildIncomeReport, isPeriod, periodRange, previousRange } from '../lib/stats';

export const stats = new Hono<{ Bindings: Env; Variables: AppVars }>();

stats.get('/', async (c) => {
  const userId = c.get('userId');
  const period = c.req.query('period');
  if (!isPeriod(period)) return c.json({ error: 'period: week | month | year' }, 400);

  let date = c.req.query('date');
  if (date === undefined) {
    const u = await ensureUser(c.env.DB, userId, c.env.TZ);
    date = nowInTz(u.tz).date;
  } else if (!isDate(date)) {
    return c.json({ error: 'Некорректная дата' }, 400);
  }

  const { from, to } = periodRange(period, date);
  const prev = previousRange(period, date);
  const [rows, prevRows, expRows, prevExpRows, materials] = await Promise.all([
    getIncomeByDay(c.env.DB, userId, from, to),
    getIncomeByDay(c.env.DB, userId, prev.from, prev.to),
    getExpensesByDay(c.env.DB, userId, from, to),
    getExpensesByDay(c.env.DB, userId, prev.from, prev.to),
    getExpensesByName(c.env.DB, userId, from, to),
  ]);
  return c.json(buildIncomeReport(period, from, to, rows, prevRows, expRows, prevExpRows, materials));
});
