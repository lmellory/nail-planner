// Команды администратора. Администратор задаётся переменной ADMIN_ID (его Telegram ID).
// Для всех остальных (в том числе для других мастеров из ALLOWED_IDS) бот на эти команды молчит.
//
// Команды:
//   /admin            — список команд
//   /users            — все пользователи: доступ, записи, клиенты
//   /user ID          — карточка одного пользователя
//   /stats            — сводка по всей базе
//   /health           — проверка базы, бота и webhook
//   /export [ID]      — список пользователей / CSV и JSON-копия данных пользователя
//   /records [ID]     — CSV (для Excel) со всеми записями за всё время: всех мастеров или одного
//   /backupall        — JSON-копии данных всех пользователей
//   /send ID текст    — сообщение одному пользователю
//   /broadcast текст  — сообщение всем мастерам из ALLOWED_IDS
// Наблюдатели (VIEWER_IDS) могут только /records (и /admin со своим списком): смотреть и выгружать записи.
// Разрушающих команд (удаление данных, смена доступа) нет намеренно: доступ задаётся секретом ALLOWED_IDS.
import type { Appointment, Env } from '../types';
import {
  getAllAppointments,
  getEveryAppointment,
  getGlobalStats,
  getMigrationsInfo,
  getUser,
  getUserIncomeTotal,
  listUsersAdmin,
  listUsersOverview,
} from '../db';
import { parseAllowedIds } from '../auth';
import { buildJsonBackup } from '../lib/backup';
import { buildCsv } from '../api/export';
import { classifySend } from '../cron';
import { periodRange } from '../lib/stats';
import { addDays, nowInTz } from '../lib/time';
import { escapeHtml, getMe, getWebhookInfo, sendDocument, sendMessage } from './telegram';

/** true, если userId совпадает с ADMIN_ID. Пустой или некорректный ADMIN_ID = администратора нет. */
export function isAdmin(env: Pick<Env, 'ADMIN_ID'>, userId: number): boolean {
  const id = Number((env.ADMIN_ID ?? '').trim());
  return Number.isInteger(id) && id > 0 && id === userId;
}

/** true, если userId есть в VIEWER_IDS (список через запятую). Наблюдатель только смотрит записи. */
export function isViewer(env: Pick<Env, 'VIEWER_IDS'>, userId: number): boolean {
  return parseAllowedIds(env.VIEWER_IDS ?? '').includes(userId);
}

export type StaffRole = 'admin' | 'viewer';

/** Все команды администратора (с «/»). Остальным бот на них не отвечает. */
export const ADMIN_COMMANDS = [
  '/admin',
  '/users',
  '/user',
  '/stats',
  '/health',
  '/export',
  '/records',
  '/backupall',
  '/send',
  '/broadcast',
] as const;

export const isAdminCommand = (cmd: string): boolean => (ADMIN_COMMANDS as readonly string[]).includes(cmd);

/** Команды, доступные наблюдателю. */
export const VIEWER_COMMANDS = ['/admin', '/records'] as const;
export const isViewerCommand = (cmd: string): boolean => (VIEWER_COMMANDS as readonly string[]).includes(cmd);

/** Максимальная длина текста для /send и /broadcast (лимит Telegram — 4096 с учётом заголовка). */
export const MAX_ANNOUNCE_LENGTH = 3500;
/** Сколько пользователей показывать в /users одним сообщением (лимит Telegram — 4096 символов). */
const MAX_USERS_SHOWN = 30;

const HELP =
  '🛠 <b>Команды администратора</b>\n\n' +
  '/users — все пользователи: доступ, записи, клиенты\n' +
  '/user <code>ID</code> — карточка пользователя\n' +
  '/stats — сводка по всей базе\n' +
  '/health — проверка базы, бота и webhook\n' +
  '/export — список пользователей для выгрузки\n' +
  '/export <code>ID</code> — CSV и JSON-копия данных пользователя\n' +
  '/records — все записи всех мастеров за всё время (CSV для Excel)\n' +
  '/records <code>ID</code> — все записи одного мастера\n' +
  '/backupall — JSON-копии всех пользователей\n' +
  '/send <code>ID текст</code> — сообщение одному пользователю\n' +
  '/broadcast <code>текст</code> — сообщение всем мастерам из ALLOWED_IDS';

const VIEWER_HELP =
  '👁 <b>Команды наблюдателя</b>\n\n' +
  '/records — все записи всех мастеров за всё время (файл CSV, открывается в Excel)\n' +
  '/records <code>ID</code> — все записи одного мастера';

const USAGE_RECORDS = 'Использование: <code>/records</code> или <code>/records ID</code>, например <code>/records 123456789</code>.';
const USAGE_EXPORT = 'Использование: <code>/export ID</code>, например <code>/export 123456789</code>.';
const USAGE_USER = 'Использование: <code>/user ID</code>, например <code>/user 123456789</code>.';
const USAGE_SEND = 'Использование: <code>/send ID текст</code>, например <code>/send 123456789 Привет!</code>';
const USAGE_BROADCAST = 'Использование: <code>/broadcast текст</code>';

const isId = (s: string) => /^\d{1,15}$/.test(s);
const onOff = (v: unknown) => (v ? 'вкл' : 'выкл');
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const formatWorkDays = (s?: string | null) => {
  const names = (s ?? '')
    .split(',')
    .map((x) => DAY_NAMES[Number(x) - 1])
    .filter(Boolean);
  return names.length ? names.join(', ') : '—';
};

/**
 * Точка входа: разбирает команду администратора. Вызывать только после isAdmin().
 * args — всё, что написано после команды (без лишних пробелов по краям).
 */
export async function handleAdminCommand(
  env: Env,
  chatId: number,
  adminId: number,
  cmd: string,
  args: string,
  role: StaffRole = 'admin',
): Promise<void> {
  // Наблюдатель: только свои команды (вторая линия защиты, помимо проверки в webhook)
  if (role === 'viewer' && !isViewerCommand(cmd)) return;
  const arg = args.trim();
  switch (cmd) {
    case '/admin':
      await sendMessage(env, chatId, role === 'viewer' ? VIEWER_HELP : HELP);
      return;
    case '/records':
      return handleRecordsCommand(env, chatId, adminId, arg.split(/\s+/)[0] || undefined);
    case '/users':
      return handleUsersCommand(env, chatId);
    case '/user':
      return handleUserCommand(env, chatId, arg.split(/\s+/)[0]);
    case '/stats':
      return handleStatsCommand(env, chatId);
    case '/health':
      return handleHealthCommand(env, chatId);
    case '/export':
      return handleExportCommand(env, chatId, adminId, arg.split(/\s+/)[0] || undefined);
    case '/backupall':
      return handleBackupAllCommand(env, chatId, adminId);
    case '/send':
      return handleSendCommand(env, chatId, adminId, arg);
    case '/broadcast':
      return handleBroadcastCommand(env, chatId, adminId, arg);
  }
}

/** /users — все пользователи в базе с доступом, записями и клиентами. */
export async function handleUsersCommand(env: Env, chatId: number): Promise<void> {
  const { date } = nowInTz(env.TZ);
  const rows = await listUsersAdmin(env.DB, date);
  const allowed = parseAllowedIds(env.ALLOWED_IDS);
  const inDb = new Set(rows.map((r) => r.user_id));

  const lines = rows.slice(0, MAX_USERS_SHOWN).map((u) => {
    const access = allowed.includes(u.user_id) ? '✅' : '⛔';
    const last = u.last_appointment ? `, последняя запись ${u.last_appointment}` : '';
    return `${access} <code>${u.user_id}</code> — записей ${u.appointments} (впереди ${u.upcoming}), клиентов ${u.clients}${last}`;
  });
  if (rows.length > MAX_USERS_SHOWN) lines.push(`…и ещё ${rows.length - MAX_USERS_SHOWN}`);

  let text = `👤 <b>Пользователи</b> (${rows.length})\n\n${lines.length ? lines.join('\n') : 'пока никого'}`;
  text += '\n\n✅ доступ есть · ⛔ нет в ALLOWED_IDS';
  const neverOpened = allowed.filter((id) => !inDb.has(id));
  if (neverOpened.length) {
    text += `\n\nЕсть доступ, но ещё не открывали бота: ${neverOpened.map((id) => `<code>${id}</code>`).join(', ')}`;
  }
  await sendMessage(env, chatId, text);
}

/** /user ID — карточка пользователя: настройки, объёмы данных, доход за месяц. */
export async function handleUserCommand(env: Env, chatId: number, arg?: string): Promise<void> {
  if (!arg) {
    await sendMessage(env, chatId, USAGE_USER);
    return;
  }
  if (!isId(arg)) {
    await sendMessage(env, chatId, `Некорректный ID.\n${USAGE_USER}`);
    return;
  }
  const id = Number(arg);
  const { date: globalToday } = nowInTz(env.TZ);
  const [u] = await listUsersAdmin(env.DB, globalToday, id);
  if (!u) {
    await sendMessage(env, chatId, `Пользователь <code>${id}</code> не найден в базе.`);
    return;
  }

  // «Сегодня» и «месяц» — в часовом поясе самого пользователя, как в его приложении
  const now = nowInTz(u.tz || env.TZ);
  const month = periodRange('month', now.date);
  const income = await getUserIncomeTotal(env.DB, id, month.from, month.to, now.date, now.time);
  const hasAccess = parseAllowedIds(env.ALLOWED_IDS).includes(id);

  const text =
    `👤 <b>Пользователь</b> <code>${id}</code>\n\n` +
    `Доступ: ${hasAccess ? '✅ есть' : '⛔ нет в ALLOWED_IDS'}\n` +
    `В базе с: ${escapeHtml(String(u.created_at ?? '—'))}\n` +
    `Часовой пояс: ${escapeHtml(u.tz)}\n\n` +
    `📅 Записей: ${u.appointments} (впереди ${u.upcoming})\n` +
    `👥 Клиентов: ${u.clients}\n` +
    `🧾 Трат: ${u.expenses}\n` +
    `💰 Доход за ${month.from.slice(0, 7)}: ${income}\n` +
    `Последняя запись: ${u.last_appointment ?? '—'}\n\n` +
    `⚙️ Вечернее напоминание: ${onOff(u.notify_enabled)}, ${escapeHtml(u.notify_time)}\n` +
    `Рабочие дни: ${formatWorkDays(u.work_days)}, ${escapeHtml(u.work_start_time ?? '09:00')}–${escapeHtml(u.work_end_time ?? '20:00')}\n` +
    `Еженедельная копия: ${onOff(u.backup_enabled !== 0)}, последняя за ${u.last_backup_date ?? '—'}`;
  await sendMessage(env, chatId, text);
}

/** /stats — сводка по всей базе. */
export async function handleStatsCommand(env: Env, chatId: number): Promise<void> {
  const { date } = nowInTz(env.TZ);
  const g = await getGlobalStats(env.DB, date, addDays(date, 1), addDays(date, -7));
  const allowed = parseAllowedIds(env.ALLOWED_IDS).length;
  await sendMessage(
    env,
    chatId,
    `📊 <b>Сводка</b> на ${date}\n\n` +
      `👤 Пользователей в базе: ${g.users} (с доступом: ${allowed})\n` +
      `📅 Записей всего: ${g.appointments}\n` +
      `   сегодня: ${g.today}, завтра: ${g.tomorrow}, впереди всего: ${g.upcoming}\n` +
      `   добавлено за 7 дней: ${g.created_last_7d}\n` +
      `👥 Клиентов: ${g.clients}\n` +
      `🧾 Трат: ${g.expenses}\n` +
      `🗑 Сообщений в очереди на удаление: ${g.pending_deletes}`,
  );
}

const shorten = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + '…' : s);

/** /health — база, бот, webhook и конфигурация (секреты не показываются). */
export async function handleHealthCommand(env: Env, chatId: number): Promise<void> {
  const lines: string[] = [];

  try {
    const t0 = Date.now();
    const m = await getMigrationsInfo(env.DB);
    lines.push(`✅ База: отвечает за ${Date.now() - t0} мс, миграций ${m.count}, последняя ${escapeHtml(m.latest ?? '—')}`);
  } catch (e) {
    lines.push(`❌ База: ${escapeHtml(shorten(String(e)))}`);
  }

  const me = await getMe(env);
  lines.push(
    me.ok
      ? `✅ Бот: ${me.result?.username ? '@' + escapeHtml(String(me.result.username)) : 'отвечает'}`
      : `❌ Бот: ${escapeHtml(shorten(me.description ?? 'нет ответа'))}`,
  );

  const wh = await getWebhookInfo(env);
  if (!wh.ok) {
    lines.push(`❌ Webhook: ${escapeHtml(shorten(wh.description ?? 'нет ответа'))}`);
  } else {
    const info = wh.result ?? {};
    if (!info.url) {
      lines.push('❌ Webhook: не установлен');
    } else {
      const pending = Number(info.pending_update_count) || 0;
      let line = `${info.last_error_message ? '⚠️' : '✅'} Webhook: установлен, ожидает апдейтов: ${pending}`;
      if (info.last_error_message) {
        const when = info.last_error_date ? new Date(Number(info.last_error_date) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
        line += `\n   последняя ошибка${when ? ' (' + when + ')' : ''}: ${escapeHtml(shorten(String(info.last_error_message)))}`;
      }
      lines.push(line);
    }
  }

  lines.push(
    `⚙️ Конфигурация: Turso ${env.TURSO_URL && env.TURSO_AUTH_TOKEN ? 'подключён' : 'не задан'}, ` +
      `ALLOWED_IDS: ${parseAllowedIds(env.ALLOWED_IDS).length}, APP_URL ${env.APP_URL ? 'задан' : 'не задан'}`,
  );
  await sendMessage(env, chatId, `🩺 <b>Состояние</b>\n\n${lines.join('\n')}`);
}

/**
 * /export — список пользователей в базе (ID и число записей).
 * /export ID — присылает администратору в чат CSV (для Excel) и JSON-копию данных этого пользователя.
 */
export async function handleExportCommand(env: Env, chatId: number, adminId: number, arg?: string): Promise<void> {
  if (!arg) {
    const users = await listUsersOverview(env.DB);
    const lines = users.map((u) => `• <code>${u.user_id}</code>: записей ${u.appointments}`);
    await sendMessage(
      env,
      chatId,
      `👤 <b>Пользователи в базе</b>\n\n${lines.length ? lines.join('\n') : 'пока никого'}\n\n${USAGE_EXPORT}`,
    );
    return;
  }

  if (!isId(arg)) {
    await sendMessage(env, chatId, `Некорректный ID.\n${USAGE_EXPORT}`);
    return;
  }
  const targetId = Number(arg);
  if (!(await getUser(env.DB, targetId))) {
    await sendMessage(env, chatId, `Пользователь <code>${targetId}</code> не найден в базе.`);
    return;
  }

  const { date } = nowInTz(env.TZ);
  const appointments = await getAllAppointments(env.DB, targetId);
  const csv = await sendDocument(
    env,
    chatId,
    new Blob([buildCsv(appointments)], { type: 'text/csv; charset=utf-8' }),
    `nail-planner-${targetId}-${date}.csv`,
    `📊 Записи пользователя ${targetId} (${date}): ${appointments.length}`,
  );
  const json = await sendDocument(
    env,
    chatId,
    new Blob([await buildJsonBackup(env.DB, targetId, env.TZ)], { type: 'application/json; charset=utf-8' }),
    `nail-planner-backup-${targetId}-${date}.json`,
    `💾 Полная копия данных пользователя ${targetId}`,
  );
  if (!csv.ok || !json.ok) await sendMessage(env, chatId, 'Не удалось отправить файл в Telegram, попробуйте ещё раз.');
  console.log(`admin export admin=${adminId} target=${targetId} appointments=${appointments.length} ok=${csv.ok && json.ok}`);
}

/** /backupall — присылает администратору JSON-копию данных каждого пользователя из базы. */
export async function handleBackupAllCommand(env: Env, chatId: number, adminId: number): Promise<void> {
  const users = await listUsersOverview(env.DB);
  if (!users.length) {
    await sendMessage(env, chatId, 'В базе пока никого нет.');
    return;
  }
  const { date } = nowInTz(env.TZ);
  let sent = 0;
  const failed: number[] = [];
  for (const u of users) {
    try {
      const json = await buildJsonBackup(env.DB, u.user_id, env.TZ);
      const r = await sendDocument(
        env,
        chatId,
        new Blob([json], { type: 'application/json; charset=utf-8' }),
        `nail-planner-backup-${u.user_id}-${date}.json`,
        `💾 Копия данных пользователя ${u.user_id} (${date})`,
      );
      if (r.ok) sent++;
      else failed.push(u.user_id);
    } catch (e) {
      console.error('admin backupall failed', u.user_id, e);
      failed.push(u.user_id);
    }
  }
  let text = `💾 Копий отправлено: ${sent} из ${users.length}`;
  if (failed.length) text += `\nНе удалось: ${failed.map((id) => `<code>${id}</code>`).join(', ')}`;
  await sendMessage(env, chatId, text);
  console.log(`admin backupall admin=${adminId} sent=${sent} failed=${failed.length}`);
}

const announce = (text: string) => `📢 <b>Сообщение от администратора</b>\n\n${escapeHtml(text)}`;

/** /send ID текст — сообщение одному пользователю (обычным текстом, без разметки). */
export async function handleSendCommand(env: Env, chatId: number, adminId: number, arg: string): Promise<void> {
  const m = /^(\S+)\s+([\s\S]+)$/.exec(arg);
  if (!m) {
    await sendMessage(env, chatId, USAGE_SEND);
    return;
  }
  const [, idRaw, text] = m;
  if (!isId(idRaw)) {
    await sendMessage(env, chatId, `Некорректный ID.\n${USAGE_SEND}`);
    return;
  }
  if (text.length > MAX_ANNOUNCE_LENGTH) {
    await sendMessage(env, chatId, `Слишком длинный текст: ${text.length} символов, максимум ${MAX_ANNOUNCE_LENGTH}.`);
    return;
  }
  const targetId = Number(idRaw);
  const known = parseAllowedIds(env.ALLOWED_IDS).includes(targetId) || !!(await getUser(env.DB, targetId));
  if (!known) {
    await sendMessage(env, chatId, `Пользователь <code>${targetId}</code> не найден ни в базе, ни в ALLOWED_IDS.`);
    return;
  }

  const outcome = classifySend(await sendMessage(env, targetId, announce(text)));
  const report =
    outcome === 'sent'
      ? `✅ Доставлено пользователю <code>${targetId}</code>.`
      : outcome === 'blocked'
        ? `⛔ Пользователь <code>${targetId}</code> заблокировал бота или не открывал чат с ним.`
        : `❌ Не удалось отправить пользователю <code>${targetId}</code>, попробуйте ещё раз.`;
  await sendMessage(env, chatId, report);
  console.log(`admin send admin=${adminId} target=${targetId} outcome=${outcome}`);
}

/** /broadcast текст — сообщение всем мастерам из ALLOWED_IDS (обычным текстом, без разметки). */
export async function handleBroadcastCommand(env: Env, chatId: number, adminId: number, text: string): Promise<void> {
  if (!text) {
    await sendMessage(env, chatId, USAGE_BROADCAST);
    return;
  }
  if (text.length > MAX_ANNOUNCE_LENGTH) {
    await sendMessage(env, chatId, `Слишком длинный текст: ${text.length} символов, максимум ${MAX_ANNOUNCE_LENGTH}.`);
    return;
  }
  const recipients = parseAllowedIds(env.ALLOWED_IDS);
  if (!recipients.length) {
    await sendMessage(env, chatId, 'Список ALLOWED_IDS пуст: рассылать некому.');
    return;
  }

  let sent = 0;
  const blocked: number[] = [];
  const failed: number[] = [];
  for (const id of recipients) {
    const outcome = classifySend(await sendMessage(env, id, announce(text)));
    if (outcome === 'sent') sent++;
    else if (outcome === 'blocked') blocked.push(id);
    else failed.push(id);
  }

  let report = `📢 Рассылка: доставлено ${sent} из ${recipients.length}`;
  if (blocked.length) report += `\n⛔ Заблокировали бота: ${blocked.map((id) => `<code>${id}</code>`).join(', ')}`;
  if (failed.length) report += `\n❌ Не удалось: ${failed.map((id) => `<code>${id}</code>`).join(', ')}`;
  await sendMessage(env, chatId, report);
  console.log(`admin broadcast admin=${adminId} recipients=${recipients.length} sent=${sent} blocked=${blocked.length} failed=${failed.length}`);
}

/**
 * /records — все записи всех мастеров за всё время одним файлом CSV (UTF-8 с BOM, «;»: открывается в Excel).
 * /records ID — записи одного мастера. Только просмотр: ничего не меняет. Доступно администратору и наблюдателям.
 */
export async function handleRecordsCommand(env: Env, chatId: number, viewerId: number, arg?: string): Promise<void> {
  const { date } = nowInTz(env.TZ);
  let items: Appointment[];
  let filename: string;
  let caption: string;

  if (!arg) {
    items = await getEveryAppointment(env.DB);
    const masters = new Set(items.map((a) => a.user_id)).size;
    filename = `nail-planner-all-${date}.csv`;
    caption = `📊 Все записи за всё время (${date}): ${items.length}, мастеров: ${masters}`;
  } else {
    if (!isId(arg)) {
      await sendMessage(env, chatId, `Некорректный ID.\n${USAGE_RECORDS}`);
      return;
    }
    const targetId = Number(arg);
    if (!(await getUser(env.DB, targetId))) {
      await sendMessage(env, chatId, `Мастер <code>${targetId}</code> не найден в базе.`);
      return;
    }
    items = await getAllAppointments(env.DB, targetId);
    filename = `nail-planner-${targetId}-${date}.csv`;
    caption = `📊 Записи мастера ${targetId} (${date}): ${items.length}`;
  }

  if (!items.length) {
    await sendMessage(env, chatId, 'Записей пока нет.');
    return;
  }
  const r = await sendDocument(
    env,
    chatId,
    new Blob([buildCsv(items, { withUser: !arg })], { type: 'text/csv; charset=utf-8' }),
    filename,
    caption,
  );
  if (!r.ok) await sendMessage(env, chatId, 'Не удалось отправить файл в Telegram, попробуйте ещё раз.');
  console.log(`records viewer=${viewerId} target=${arg ?? 'all'} appointments=${items.length} ok=${r.ok}`);
}
