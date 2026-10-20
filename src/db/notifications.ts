import type { Database } from '../types';
// Запросы notifications. Данные мастера всегда ограничиваются user_id.

/**
 * Через сколько секунд бот удаляет из чата своё сообщение «Новая запись».
 * Должно быть меньше 48 часов: позже Telegram не даёт удалить сообщение.
 */
export const NEW_APPT_MSG_TTL_SEC = 24 * 60 * 60;

/** Запланировать удаление сообщения бота из чата через ttlSec секунд. */
export async function scheduleMessageDelete(
  db: Database,
  chatId: number,
  messageId: number,
  ttlSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<void> {
  await db
    .prepare('INSERT INTO scheduled_deletes (chat_id, message_id, delete_at) VALUES (?,?,?)')
    .bind(chatId, messageId, nowSec + ttlSec)
    .run();
}

export interface ScheduledDelete {
  id: number;
  chat_id: number;
  message_id: number;
}

/** Сообщения, которые пора удалить из чата. */
export async function getDueMessageDeletes(
  db: Database,
  nowSec = Math.floor(Date.now() / 1000),
  limit = 50,
): Promise<ScheduledDelete[]> {
  const r = await db
    .prepare('SELECT id, chat_id, message_id FROM scheduled_deletes WHERE delete_at <= ? ORDER BY delete_at LIMIT ?')
    .bind(nowSec, limit)
    .all<ScheduledDelete>();
  return r.results;
}

export async function removeScheduledDelete(db: Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM scheduled_deletes WHERE id=?').bind(id).run();
}
