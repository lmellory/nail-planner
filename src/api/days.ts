// Сводка по дням для полосы недели и календаря: количество записей + есть ли заметка.
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { isDate } from '../lib/time';

export const days = new Hono<{ Bindings: Env; Variables: AppVars }>();

// GET /api/days?from=...&to=...  ->  [{date, count, has_note}]
days.get('/', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  const uid = c.get('userId');
  const a = await c.env.DB.prepare(
    'SELECT date, COUNT(*) AS count FROM appointments WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY date',
  ).bind(uid, from, to).all<{ date: string; count: number }>();
  const n = await c.env.DB.prepare(
    'SELECT date FROM day_notes WHERE user_id=? AND date BETWEEN ? AND ?',
  ).bind(uid, from, to).all<{ date: string }>();
  const noteDates = new Set(n.results.map((r) => r.date));
  const map = new Map<string, { date: string; count: number; has_note: boolean }>();
  for (const r of a.results) map.set(r.date, { date: r.date, count: r.count, has_note: noteDates.has(r.date) });
  for (const d of noteDates) if (!map.has(d)) map.set(d, { date: d, count: 0, has_note: true });
  return c.json([...map.values()]);
});
