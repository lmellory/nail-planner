// Сводка по дням для полосы недели и календаря: количество записей + есть ли заметка.
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { isDate } from '../lib/time';
import { getDaySummary } from '../db';

export const days = new Hono<{ Bindings: Env; Variables: AppVars }>();

// GET /api/days?from=...&to=...  ->  [{date, count, has_note}]
days.get('/', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  return c.json(await getDaySummary(c.env.DB, c.get('userId'), from, to));
});
