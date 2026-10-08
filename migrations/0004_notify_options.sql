-- 0004: настройка «уведомлять о новой записи» и очередь удаления сообщений бота из чата.
--  - users.notify_new_appt: 1 = слать мастеру сообщение «Новая запись» (по умолчанию включено, как было раньше);
--  - scheduled_deletes: какие сообщения бота и когда удалить из чата (unix-время в секундах).
--    Удаляются только сообщения в Telegram. Записи и заметки в базе не затрагиваются.

BEGIN;

ALTER TABLE users ADD COLUMN notify_new_appt INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS scheduled_deletes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  delete_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_del_at ON scheduled_deletes(delete_at);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0004_notify_options');

COMMIT;
