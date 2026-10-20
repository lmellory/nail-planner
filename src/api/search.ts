// Поиск клиента по части имени: GET /api/search?q=...
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { searchAppointments } from '../db/appointments';

export const search = new Hono<{ Bindings: Env; Variables: AppVars }>();

search.get('/', async (c) => {
  const q = String(c.req.query('q') ?? '').trim();
  if (q.length < 2) {
    return c.json({ error: 'Минимум 2 символа для поиска' }, 400);
  }
  const results = await searchAppointments(c.env.DB, c.get('userId'), q);
  return c.json(results);
});
