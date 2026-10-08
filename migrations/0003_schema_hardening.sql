-- 0003: укрепление схемы.
--  1) таблица учёта применённых миграций (schema_migrations);
--  2) users: DEFAULT notify_time = '22:00' (раньше в схеме было '23:00', а код писал 22:00);
--  3) appointments: CHECK (end_time > start_time) на уровне базы;
--  4) удалён индекс idx_appt_user_name: он не ускоряет LIKE '%…%' (поиск по подстроке всё равно
--     идёт по записям пользователя через idx_appt_user_date), а лишь замедляет записи.
--
-- SQLite не умеет менять DEFAULT и добавлять CHECK через ALTER, поэтому таблицы пересоздаются.
-- ПЕРЕД ЗАПУСКОМ проверь, что нет записей с некорректным интервалом (иначе миграция упадёт и откатится):
--   SELECT id, date, start_time, end_time FROM appointments WHERE end_time <= start_time;
-- Если такие есть, исправь или удали их вручную, затем запускай миграцию.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- users
CREATE TABLE users_new (
  user_id            INTEGER PRIMARY KEY,
  tz                 TEXT    NOT NULL DEFAULT 'Europe/Chisinau',
  notify_enabled     INTEGER NOT NULL DEFAULT 1,
  notify_time        TEXT    NOT NULL DEFAULT '22:00',
  last_notified_date TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new (user_id, tz, notify_enabled, notify_time, last_notified_date, created_at)
  SELECT user_id, tz, notify_enabled, notify_time, last_notified_date, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- appointments
CREATE TABLE appointments_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  date               TEXT    NOT NULL,   -- YYYY-MM-DD
  start_time         TEXT    NOT NULL,   -- HH:MM
  end_time           TEXT    NOT NULL,   -- HH:MM
  client_name        TEXT    NOT NULL,
  who                TEXT,               -- «кто это, что за человек»
  service            TEXT    NOT NULL CHECK (service IN ('manicure','pedicure','both')),
  manicure_coating   TEXT    CHECK (manicure_coating IN ('gel','none')),
  pedicure_coating   TEXT    CHECK (pedicure_coating IN ('gel','none')),
  comment            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time)
);
INSERT INTO appointments_new
  (id, user_id, date, start_time, end_time, client_name, who, service,
   manicure_coating, pedicure_coating, comment, created_at, updated_at)
  SELECT id, user_id, date, start_time, end_time, client_name, who, service,
         manicure_coating, pedicure_coating, comment, created_at, updated_at
  FROM appointments;
DROP TABLE appointments;
ALTER TABLE appointments_new RENAME TO appointments;
CREATE INDEX IF NOT EXISTS idx_appt_user_date ON appointments(user_id, date);

-- Отмечаем уже применённые ранее миграции и эту
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0001_init');
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0002_notify_22');
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0003_schema_hardening');

COMMIT;
