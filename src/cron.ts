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
  getClientByName,
  getClientsWithBirthday,
  getDayNote,
  getDueMessageDeletes,
  getUser,
  listAppointments,
  removeScheduledDelete,
} from './db';
import { getAllowedIds } from './lib/access';
import { addDays, nowInTz } from './lib/time';
import { formatDay } from './lib/format';
import { deleteMessage, escapeHtml, openAppKeyboard, sendDocument, sendMessage } from './bot/telegram';
import { buildJsonBackup } from './lib/backup';

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

  for (const userId of await getAllowedIds(env)) {
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

        const clientContacts = new Map<string, { phone?: string | null; telegram?: string | null }>();
        for (const item of items) {
          const cl = await getClientByName(env.DB, userId, item.client_name);
          if (cl) clientContacts.set(item.client_name, { phone: cl.phone, telegram: cl.telegram });
        }

        const text = `🌙 <b>Расписание на завтра</b>\n\n${formatDay(target, items, note, clientContacts)}`;
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

  try {
    await runBirthdayNotifications(env, appUrl);
  } catch (e) {
    console.error('runBirthdayNotifications error', e);
  }
}

export const BIRTHDAY_NOTIFY_TIME = '10:00';

/** Чистая функция: пора ли слать утреннее уведомление о дне рождения в 10:00. */
export function birthdayDecision(
  nowDate: string,
  nowTime: string,
  lastBirthdayNotified: string | null,
  targetTime = BIRTHDAY_NOTIFY_TIME,
): boolean {
  return nowTime >= targetTime && lastBirthdayNotified !== nowDate;
}

/** Форматирование поздравления о дне рождения клиента. */
export function formatBirthdayNotification(
  clients: Array<{ name: string; phone?: string | null; telegram?: string | null; notes?: string | null }>,
): string {
  if (!clients.length) return '';
  if (clients.length === 1) {
    const c = clients[0];
    let msg = `🎂 <b>Сегодня день рождения!</b>\n\n🎉 У клиентки <b>${escapeHtml(c.name)}</b> сегодня день рождения! 💐`;
    if (c.phone) msg += `\n📞 ${escapeHtml(c.phone)}`;
    if (c.telegram) {
      const tg = c.telegram.replace(/^@/, '');
      msg += `\n💬 <a href="https://t.me/${escapeHtml(tg)}">@${escapeHtml(tg)}</a>`;
    }
    if (c.notes) msg += `\n📝 <i>${escapeHtml(c.notes)}</i>`;
    msg += `\n\nНе забудьте поздравить любимого клиента! 🥳`;
    return msg;
  }

  let msg = `🎂 <b>Сегодня день рождения!</b>\n\n🎉 Сегодня день рождения у ваших клиентов:`;
  for (const c of clients) {
    msg += `\n\n• <b>${escapeHtml(c.name)}</b> 💐`;
    if (c.phone) msg += `\n  📞 ${escapeHtml(c.phone)}`;
    if (c.telegram) {
      const tg = c.telegram.replace(/^@/, '');
      msg += `\n  💬 <a href="https://t.me/${escapeHtml(tg)}">@${escapeHtml(tg)}</a>`;
    }
    if (c.notes) msg += `\n  📝 <i>${escapeHtml(c.notes)}</i>`;
  }
  msg += `\n\nНе забудьте поздравить! 🥳`;
  return msg;
}

export async function runBirthdayNotifications(env: Env, appUrl: string) {
  for (const userId of await getAllowedIds(env)) {
    try {
      const u = (await getUser(env.DB, userId)) ?? (await ensureUser(env.DB, userId, env.TZ));
      const now = nowInTz(u.tz || env.TZ);
      const previousBdayDate = u.last_birthday_notify_date ?? null;

      if (!birthdayDecision(now.date, now.time, previousBdayDate)) continue;

      // Атомарно бронируем отправку за сегодняшнюю дату
      const claim = await env.DB
        .prepare(
          'UPDATE users SET last_birthday_notify_date=? WHERE user_id=? AND (last_birthday_notify_date IS NULL OR last_birthday_notify_date != ?)',
        )
        .bind(now.date, userId, now.date)
        .run();
      if (!claim.meta.changes) continue;

      const [y, m, d] = now.date.split('-');
      const todayDDMM = `${d}.${m}`;

      const bdayClients = await getClientsWithBirthday(env.DB, userId, todayDDMM);
      if (!bdayClients.length) {
        // Именинников сегодня нет — бронь остаётся, чтобы больше не проверять сегодня
        continue;
      }

      const text = formatBirthdayNotification(bdayClients);
      const outcome = classifySend(await sendMessage(env, userId, text, openAppKeyboard(appUrl)));

      if (outcome === 'sent') {
        console.log(`birthday notify sent user=${userId} count=${bdayClients.length}`);
      } else if (outcome === 'retry') {
        // Откатываем бронь при сбое сети, чтобы повторить через минуту
        try {
          await env.DB
            .prepare('UPDATE users SET last_birthday_notify_date=? WHERE user_id=? AND last_birthday_notify_date=?')
            .bind(previousBdayDate, userId, now.date)
            .run();
        } catch (e) {
          console.error('birthday rollback failed', userId, e);
        }
      }
    } catch (e) {
      console.error('birthday notify error', userId, e);
    }
  }
}

// ===== Еженедельная резервная копия =====
// «Слот» — воскресенье 21:00 по часовому поясу мастера. Копия отправляется, если за последний прошедший
// слот её ещё не слали (так пропущенное из-за сбоя досылается, а не теряется до следующей недели).
// users.last_backup_date хранит дату слота; бронь делается атомарным UPDATE, как у вечернего уведомления.
// Первая копия после включения функции уходит сразу (last_backup_date ещё пуст) — заодно видно, что всё работает.
export const BACKUP_TIME = '21:00';

/** Чистая функция: пора ли слать копию и за какой слот (дату воскресенья). */
export function backupDecision(
  nowDate: string,
  nowTime: string,
  lastBackupDate: string | null,
): { send: boolean; slot: string } {
  const dow = new Date(nowDate + 'T00:00:00Z').getUTCDay(); // 0 = воскресенье
  const daysBack = dow === 0 ? (nowTime >= BACKUP_TIME ? 0 : 7) : dow;
  const slot = addDays(nowDate, -daysBack);
  return { send: lastBackupDate !== slot, slot };
}

export async function runWeeklyBackups(env: Env) {
  for (const userId of await getAllowedIds(env)) {
    try {
      const u = (await getUser(env.DB, userId)) ?? (await ensureUser(env.DB, userId, env.TZ));
      if (u.backup_enabled === 0) continue;

      const now = nowInTz(u.tz || env.TZ);
      const previous = u.last_backup_date ?? null;
      const { send, slot } = backupDecision(now.date, now.time, previous);
      if (!send) continue;

      const claim = await env.DB
        .prepare(
          'UPDATE users SET last_backup_date=? WHERE user_id=? AND (last_backup_date IS NULL OR last_backup_date != ?)',
        )
        .bind(slot, userId, slot)
        .run();
      if (!claim.meta.changes) continue;

      let outcome: SendOutcome = 'retry';
      try {
        const json = await buildJsonBackup(env.DB, userId, env.TZ);
        outcome = classifySend(
          await sendDocument(
            env,
            userId,
            new Blob([json], { type: 'application/json; charset=utf-8' }),
            `nail-planner-backup-${now.date}.json`,
            `💾 Еженедельная резервная копия (${now.date})`,
          ),
        );
      } catch (e) {
        console.error('backup send failed', userId, e);
      }

      if (outcome === 'sent') {
        console.log(`backup sent user=${userId} slot=${slot}`);
      } else if (outcome === 'blocked') {
        console.warn(`backup blocked (403) user=${userId}: бот заблокирован или чат недоступен, до следующей недели не пытаемся`);
      } else {
        try {
          await env.DB
            .prepare('UPDATE users SET last_backup_date=? WHERE user_id=? AND last_backup_date=?')
            .bind(previous, userId, slot)
            .run();
        } catch (e) {
          console.error('backup rollback failed', userId, e);
        }
      }
    } catch (e) {
      console.error('backup error', userId, e);
    }
  }
}
