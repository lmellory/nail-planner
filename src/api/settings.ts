// Настройки пользователя: GET/PUT /api/settings
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { ensureUser, updateUserSettings } from '../db/users';
import { isTime } from '../lib/time';
import { settingsView, validateSchedule } from '../lib/settings';

export const settings = new Hono<{ Bindings: Env; Variables: AppVars }>();

settings.get('/', async (c) => {
  const u = await ensureUser(c.env.DB, c.get('userId'), c.env.TZ);
  return c.json(settingsView(u));
});

settings.put('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Некорректное тело запроса' }, 400);
  }

  const {
    notify_enabled,
    notify_time,
    tz,
    notify_new_appt,
    work_start_time,
    work_end_time,
    work_days,
    backup_enabled,
  } = body as Record<string, unknown>;

  if (typeof notify_enabled !== 'boolean') {
    return c.json({ error: 'notify_enabled должен быть булевым значением' }, 400);
  }

  if (notify_new_appt !== undefined && typeof notify_new_appt !== 'boolean') {
    return c.json({ error: 'notify_new_appt должен быть булевым значением' }, 400);
  }

  if (backup_enabled !== undefined && typeof backup_enabled !== 'boolean') {
    return c.json({ error: 'backup_enabled должен быть булевым значением' }, 400);
  }

  if (!isTime(notify_time)) {
    return c.json({ error: 'notify_time должен быть формата HH:MM' }, 400);
  }

  if (work_start_time !== undefined && !isTime(work_start_time)) {
    return c.json({ error: 'work_start_time должен быть формата HH:MM' }, 400);
  }

  if (work_end_time !== undefined && !isTime(work_end_time)) {
    return c.json({ error: 'work_end_time должен быть формата HH:MM' }, 400);
  }

  if (typeof tz !== 'string') {
    return c.json({ error: 'Некорректный часовой пояс' }, 400);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return c.json({ error: 'Неподдерживаемый часовой пояс' }, 400);
  }

  const userId = c.get('userId');
  const current = await ensureUser(c.env.DB, userId, c.env.TZ);
  const scheduleError = validateSchedule(work_start_time ?? current.work_start_time ?? '09:00', work_end_time ?? current.work_end_time ?? '20:00', work_days ?? current.work_days ?? '1,2,3,4,5,6');
  if (scheduleError) return c.json({ error: scheduleError }, 400);
  const updated = await updateUserSettings(c.env.DB, userId, {
    notify_enabled,
    notify_time,
    tz,
    notify_new_appt: notify_new_appt === undefined ? current.notify_new_appt : notify_new_appt,
    work_start_time: typeof work_start_time === 'string' ? work_start_time : current.work_start_time,
    work_end_time: typeof work_end_time === 'string' ? work_end_time : current.work_end_time,
    work_days: typeof work_days === 'string' ? work_days : current.work_days,
    backup_enabled: backup_enabled === undefined ? current.backup_enabled : backup_enabled,
  });

  return c.json(settingsView(updated));
});
