// Настройки пользователя: GET/PUT /api/settings
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { ensureUser, updateUserSettings } from '../db';
import { isTime } from '../lib/time';

export const settings = new Hono<{ Bindings: Env; Variables: AppVars }>();

settings.get('/', async (c) => {
  const u = await ensureUser(c.env.DB, c.get('userId'), c.env.TZ);
  return c.json({ notify_enabled: !!u.notify_enabled, notify_time: u.notify_time, tz: u.tz });
});

settings.put('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Некорректное тело запроса' }, 400);
  }

  const { notify_enabled, notify_time, tz } = body as Record<string, unknown>;

  if (typeof notify_enabled !== 'boolean') {
    return c.json({ error: 'notify_enabled должен быть булевым значением' }, 400);
  }

  if (!isTime(notify_time)) {
    return c.json({ error: 'notify_time должен быть формата HH:MM' }, 400);
  }

  if (typeof tz !== 'string') {
    return c.json({ error: 'Некорректный часовой пояс' }, 400);
  }

  const getSupportedTimezones = (): Set<string> | null => {
    try {
      if (typeof (Intl as any).supportedValuesOf === 'function') {
        return new Set<string>((Intl as any).supportedValuesOf('timeZone'));
      }
    } catch {
      // fallback
    }
    return null;
  };

  const supported = getSupportedTimezones();
  if (supported && !supported.has(tz)) {
    return c.json({ error: 'Неподдерживаемый часовой пояс' }, 400);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return c.json({ error: 'Неподдерживаемый часовой пояс' }, 400);
  }

  const userId = c.get('userId');
  await ensureUser(c.env.DB, userId, c.env.TZ);
  const updated = await updateUserSettings(c.env.DB, userId, { notify_enabled, notify_time, tz });

  return c.json({
    notify_enabled: !!updated.notify_enabled,
    notify_time: updated.notify_time,
    tz: updated.tz,
  });
});
