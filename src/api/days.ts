// Сводка по дням для полосы недели и календаря: количество записей + есть ли заметка + свободные окна.
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { addMinutes, calculateFreeSlots, defaultServiceDuration, isDate } from '../lib/time';
import { ensureUser, getDaySummary, getUser, listAppointments } from '../db';
import { isActiveStatus } from '../lib/status';

export const days = new Hono<{ Bindings: Env; Variables: AppVars }>();

// GET /api/days?from=...&to=...  ->  [{date, count, has_note}]
days.get('/', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  return c.json(await getDaySummary(c.env.DB, c.get('userId'), from, to));
});

// GET /api/days/slots?date=YYYY-MM-DD -> расчет свободных окон на день
days.get('/slots', async (c) => {
  const userId = c.get('userId');
  const date = c.req.query('date');
  if (!isDate(date)) return c.json({ error: 'date required' }, 400);

  const u = (await getUser(c.env.DB, userId)) ?? (await ensureUser(c.env.DB, userId, c.env.TZ));
  const workStart = u.work_start_time || '09:00';
  const workEnd = u.work_end_time || '20:00';
  const workDays = (u.work_days || '1,2,3,4,5,6').split(',').map((s) => Number(s.trim()));

  const dayOfWeekIso = new Date(date + 'T00:00:00Z').getUTCDay() || 7; // 1=Пн ... 7=Вс
  const isWorkDay = workDays.includes(dayOfWeekIso);

  if (!isWorkDay) {
    return c.json({
      date,
      is_work_day: false,
      work_start: workStart,
      work_end: workEnd,
      slots: [],
    });
  }

  const appts = (await listAppointments(c.env.DB, userId, date, date)).filter((a) => isActiveStatus(a.status));
  const busy = appts.map((a) => ({
    start: a.start_time,
    end: a.end_time || addMinutes(a.start_time, defaultServiceDuration(a.service)),
  }));

  const slots = calculateFreeSlots(workStart, workEnd, busy);

  return c.json({
    date,
    is_work_day: true,
    work_start: workStart,
    work_end: workEnd,
    slots,
  });
});
