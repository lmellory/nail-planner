// Cron раз в минуту: вечернее уведомление «расписание на завтра».
// Логика:
//  - «вечерняя дата» = сегодня, а если сейчас до 03:00 — вчера (так досылаем пропущенное после полуночи)
//  - отправляем, если время >= notify_time (или уже после полуночи, но до 03:00)
//  - защита от дублей: users.last_notified_date хранит вечернюю дату последней отправки;
//    «бронируем» её атомарным UPDATE ещё до отправки, а при ошибке Telegram откатываем,
//    поэтому на следующей минуте отправка будет повторена
//  - если notify_time сам раньше 03:00, режим «доотправки после полуночи» отключается
// Ночная очистка: в окне 03:00–03:04 по времени пользователя удаляются записи и заметки старше RETENTION_DAYS дней.
//  Запрос идемпотентный, поэтому несколько срабатываний подряд в окне безопасны (и страхуют от пропущенной минуты).
import type { Env } from './types';
import { deleteDataBefore, ensureUser, getDayNote, getUser, listAppointments } from './db';
import { parseAllowedIds } from './auth';
import { addDays, nowInTz } from './lib/time';
import { formatDay } from './lib/format';
import { openAppKeyboard, sendMessage } from './bot/telegram';

const CUTOFF = '03:00';

/** Сколько дней хранить записи и заметки. Всё, что старше, удаляется ночью безвозвратно. */
export const RETENTION_DAYS = 2;
const CLEANUP_FROM = '03:00';
const CLEANUP_TO = '03:05'; // не включительно

/** Чистая функция: попадает ли текущее время в окно ночной очистки. */
export const isCleanupTime = (nowTime: string): boolean => nowTime >= CLEANUP_FROM && nowTime < CLEANUP_TO;

/** Чистая функция: записи с датой строго раньше возвращённой удаляются. */
export const cleanupCutoff = (today: string): string => addDays(today, -RETENTION_DAYS);

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
      const now = nowInTz(u.tz);

      // Ночная очистка старых данных (не зависит от того, включены ли уведомления; её сбой не мешает уведомлениям)
      if (isCleanupTime(now.time)) {
        try {
          const cutoff = cleanupCutoff(now.date);
          const del = await deleteDataBefore(env.DB, userId, cutoff);
          if (del.appointments || del.notes) {
            console.log(`cleanup user=${userId}: удалено записей=${del.appointments}, заметок=${del.notes} (даты до ${cutoff})`);
          }
        } catch (e) {
          console.error('cleanup error', userId, e);
        }
      }

      if (!u.notify_enabled) continue;

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
      if (r.ok) {
        console.log(`notify sent user=${userId} evening=${eveningDate} target=${target} appointments=${items.length}`);
      } else {
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
