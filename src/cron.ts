// Cron раз в минуту: вечернее уведомление «расписание на завтра».
// Логика:
//  - «вечерняя дата» = сегодня, а если сейчас до 03:00 — вчера (так досылаем пропущенное после полуночи)
//  - отправляем, если время >= notify_time (или уже после полуночи, но до 03:00)
//  - защита от дублей: users.last_notified_date хранит вечернюю дату последней отправки
import type { Env } from './types';
import { ensureUser, listAppointments } from './db';
import { parseAllowedIds } from './auth';
import { addDays, nowInTz } from './lib/time';
import { formatDay } from './lib/format';
import { openAppKeyboard, sendMessage } from './bot/telegram';

const CUTOFF = '03:00';

export async function runNotifications(env: Env, appUrl: string) {
  for (const userId of parseAllowedIds(env.ALLOWED_IDS)) {
    try {
      const u = await ensureUser(env.DB, userId, env.TZ);
      if (!u.notify_enabled) continue;

      const now = nowInTz(u.tz);
      const afterMidnight = now.time < CUTOFF;
      const eveningDate = afterMidnight ? addDays(now.date, -1) : now.date;
      const due = afterMidnight || now.time >= u.notify_time;
      if (!due || u.last_notified_date === eveningDate) continue;

      const target = addDays(eveningDate, 1); // «завтра» относительно вечера
      const items = await listAppointments(env.DB, userId, target, target);
      const note = await env.DB.prepare('SELECT text FROM day_notes WHERE user_id=? AND date=?')
        .bind(userId, target).first<{ text: string }>();

      const text = `🌙 <b>Расписание на завтра</b>\n\n${formatDay(target, items, note?.text)}`;
      const r = await sendMessage(env, userId, text, openAppKeyboard(appUrl));
      if (r.ok) {
        await env.DB.prepare('UPDATE users SET last_notified_date=? WHERE user_id=?').bind(eveningDate, userId).run();
      }
    } catch (e) {
      console.error('notify error', userId, e);
    }
  }
}
