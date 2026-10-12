// Команды администратора. Администратор задаётся переменной ADMIN_ID (его Telegram ID).
// Для всех остальных (в том числе для других мастеров из ALLOWED_IDS) бот на эти команды молчит.
import type { Env } from '../types';
import { getAllAppointments, getUser, listUsersOverview } from '../db';
import { buildJsonBackup } from '../lib/backup';
import { buildCsv } from '../api/export';
import { nowInTz } from '../lib/time';
import { sendDocument, sendMessage } from './telegram';

/** true, если userId совпадает с ADMIN_ID. Пустой или некорректный ADMIN_ID = администратора нет. */
export function isAdmin(env: Pick<Env, 'ADMIN_ID'>, userId: number): boolean {
  const id = Number((env.ADMIN_ID ?? '').trim());
  return Number.isInteger(id) && id > 0 && id === userId;
}

const USAGE = 'Использование: <code>/export ID</code>, например <code>/export 123456789</code>.';

/**
 * /export — список пользователей в базе (ID и число записей).
 * /export ID — присылает администратору в чат CSV (для Excel) и JSON-копию данных этого пользователя.
 * Вызывать только после isAdmin().
 */
export async function handleExportCommand(env: Env, chatId: number, adminId: number, arg?: string): Promise<void> {
  if (!arg) {
    const users = await listUsersOverview(env.DB);
    const lines = users.map((u) => `• <code>${u.user_id}</code>: записей ${u.appointments}`);
    await sendMessage(
      env,
      chatId,
      `👤 <b>Пользователи в базе</b>\n\n${lines.length ? lines.join('\n') : 'пока никого'}\n\n${USAGE}`,
    );
    return;
  }

  if (!/^\d{1,15}$/.test(arg)) {
    await sendMessage(env, chatId, `Некорректный ID.\n${USAGE}`);
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
