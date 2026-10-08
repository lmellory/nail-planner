// Cron раз в минуту: вечернее уведомление «расписание на завтра» + удаление старых сообщений бота.
// Вечернее уведомление:
//  - «вечерняя дата» = сегодня, а если сейчас до 03:00 — вчера (так досылаем пропущенное после полуночи)
//  - отправляем, если время >= notify_time (или уже после полуночи, но до 03:00)
//  - защита от дублей: users.last_notified_date хранит вечернюю дату последней отправки;
//    «бронируем» её атомарным UPDATE ещё до отправки
//  - если отправка не удалась (сетевая ошибка, исключение, ответ Telegram с ошибкой), бронь откатывается
//    и на следующей минуте отправка повторяется
//  - исключение: 403 (бот заблокирован / чат недоступен). Повторять бессмысленно, поэтому бронь остаётся,
//    и до следующего вечера бот этому пользователю не пишет
//  - если notify_time сам раньше 03:00, режим «доотправки после полуночи» отключается
// Удаление сообщений: бот сам стирает из чата сообщения «Новая запись» (см. scheduled_deletes).
// Записи и заметки в базе НЕ удаляются.
import type { Env } from './types';
import {
  ensureUser,
  getDayNote,
  getDueMessageDeletes,
  getUser,
  listAppointments,
  removeScheduledDelete,
} from './db';
import { parseAllowedIds } from './auth';
import { addDays, nowInTz } from './lib/time';
import { formatDay } from './lib/format';
import { deleteMessage, openAppKeyboard, sendMessage } from './bot/telegram';

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

/** Чистая функция: что делать с результатом отправки. */
export type SendOutcome = 'sent' | 'blocked' | 'retry';
export function classifySend(r: { ok: boolean; error_code?: number } | null): SendOutcome {
  if (r?.ok) return 'sent';
  if (r?.error_code === 403) return 'blocked';
  return 'retry';
}

/** Чистая функция: нужно ли забыть запланированное удаление после ответа Telegram. */
export function shouldForgetDelete(r: { ok: boolean; error_code?: number }): boolean {
  if (r.ok) return true;
  const c = r.error_code;
  // 4xx (кроме 429): сообщение уже удалено или слишком старое, повторять нет смысла
  return typeof c === 'number' && c >= 400 && c < 500 && c !== 429;
}

/** Удаляет из чата сообщения, срок которых вышел. Сетевые ошибки и 429/5xx оставляют запись на следующую минуту. */
export async function processScheduledDeletes(env: Env): Promise<void> {
  const due = await getDueMessageDeletes(env.DB);
  for (const d of due) {
    try {
      const r = await deleteMessage(env, d.chat_id, d.message_id);
      if (shouldForgetDelete(r)) await removeScheduledDelete(env.DB, d.id);
    } catch (e) {
      console.error('scheduled delete error', d.id, e);
    }
  }
}

export async function runNotifications(env: Env, appUrl: string) {
  try {
    await processScheduledDeletes(env);
  } catch (e) {
    console.error('processScheduledDeletes error', e);
  }

  for (const userId of parseAllowedIds(env.ALLOWED_IDS)) {
    try {
      const u = (await getUser(env.DB, userId)) ?? (await ensureUser(env.DB, userId, env.TZ));
      if (!u.notify_enabled) continue;

      const now = nowInTz(u.tz);
      const previousNotifiedDate = u.last_notified_date;
      const { send, eveningDate } = notifyDecision(now.date, now.time, u.notify_time, previousNotifiedDate);
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
      let outcome: SendOutcome = 'retry';
      let count = 0;
      try {
        const items = await listAppointments(env.DB, userId, target, target);
        const note = await getDayNote(env.DB, userId, target);
        count = items.length;
        const text = `🌙 <b>Расписание на завтра</b>\n\n${formatDay(target, items, note)}`;
        outcome = classifySend(await sendMessage(env, userId, text, openAppKeyboard(appUrl)));
      } catch (e) {
        console.error('notify send failed', userId, e);
      }

      if (outcome === 'sent') {
        console.log(`notify sent user=${userId} evening=${eveningDate} target=${target} appointments=${count}`);
      } else if (outcome === 'blocked') {
        // 403: повторять бессмысленно. Бронь остаётся, до следующего вечера не пытаемся.
        console.warn(`notify blocked (403) user=${userId}: бот заблокирован или чат недоступен, повторов не будет`);
      } else {
        // Не доставили: откатываем бронь, на следующей минуте попробуем снова.
        // Условие по eveningDate не даёт затереть более свежую бронь.
        try {
          await env.DB
            .prepare('UPDATE users SET last_notified_date=? WHERE user_id=? AND last_notified_date=?')
            .bind(previousNotifiedDate, userId, eveningDate)
            .run();
        } catch (e) {
          console.error('notify rollback failed', userId, e);
        }
      }
    } catch (e) {
      console.error('notify error', userId, e);
    }
  }
}
