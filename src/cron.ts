// Cron раз в минуту: вечернее уведомление «расписание на завтра».
// Логика:
//  - «вечерняя дата» = сегодня, а если сейчас до 03:00 — вчера (так досылаем пропущенное после полуночи)
//  - отправляем, если время >= notify_time (или уже после полуночи, но до 03:00)
//  - защита от дублей: users.last_notified_date хранит вечернюю дату последней отправки;
//    «бронируем» её атомарным UPDATE ещё до отправки, а при ошибке Telegram откатываем,
//    поэтому на следующей минуте отправка будет повторена
//  - если notify_time сам раньше 03:00, режим «доотправки после полуночи» отключается
import type { Env } from './types';
import { ensureUser, getDayNote, getUser, listAppointments } from './db';
import { parseAllowedIds } from './auth';
import { addDays, nowInTz } from './lib/time';
import { formatDay } from './lib/format';
import { openAppKeyboard, sendMessage } from './bot/telegram';

const CUTOFF = '03:00';

/** Чистая функция: пора ли слать уведомление и за какую «вечернюю дату». */
export function notifyDecision(
  nowDate: string,
  nowTime: string,
  notifyTime: string,
  lastNotified: string | null,
): { send: boolean; eveningDate: string } {
  const catchUp = notifyTime >= CUTOFF; // «доотправка после полуночи» имеет смысл только для вечерних времён
  const afterMidnight = catchUp && nowTime < CUTOFF;
  const eveningDate = afterMidnight ? addDays(nowDate, -1) : nowDate;
  const due = afterMidnight || nowTime >= notifyTime;
  return { send: due && lastNotified !== eveningDate, eveningDate };
}

export async function runNotifications(env: Env, appUrl: string) {
  for (const userId of parseAllowedIds(env.ALLOWED_IDS)) {
    try {
      const u = (await getUser(env.DB, userId)) ?? (await ensureUser(env.DB, userId, env.TZ));
      if (!u.notify_enabled) continue;

      const now = nowInTz(u.tz);
      const { send, eveningDate } = notifyDecision(now.date, now.time, u.notify_time, u.last_notified_date);
      if (!send) continue;

      // Атомарно «бронируем» отправку: если параллельный запуск cron уже успел — changes будет 0
      const claim = await env.DB
        .prepare(
          'UPDATE users SET last_notified_date=? WHERE user_id=? AND (last_notified_date IS NULL OR last_notified_date != ?)',
        )
        .bind(eveningDate, userId, eveningDate)
        .run();
      if (!claim.meta.changes) continue;

      const target = addDays(eveningDate, 1); // «завтра» относительно вечера
      const items = await listAppointments(env.DB, userId, target, target);
      const note = await getDayNote(env.DB, userId, target);

      const text = `🌙 <b>Расписание на завтра</b>\n\n${formatDay(target, items, note)}`;
      const r = await sendMessage(env, userId, text, openAppKeyboard(appUrl));
      if (!r.ok) {
        // Не доставили — откатываем бронь, на следующей минуте попробуем снова
        await env.DB
          .prepare('UPDATE users SET last_notified_date=? WHERE user_id=?')
          .bind(u.last_notified_date, userId)
          .run();
      }
    } catch (e) {
      console.error('notify error', userId, e);
    }
  }
}
