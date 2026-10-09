-- 0006: Таблица клиентов (clients), рабочие часы и свободные окна мастера в users.
--  - clients: база постоянных клиентов с контактами (телефон, telegram) и заметками мастера (аллергии, особенности);
--  - миграция автоматически заполняет таблицу clients уникальными именами из существующих appointments;
--  - users: work_start_time, work_end_time, work_days для расчета свободных окон в расписании.

BEGIN;

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  phone       TEXT,
  telegram    TEXT,
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_clients_user_name ON clients(user_id, name);

-- Автоматически наполняем clients существующими клиентами из записей appointments
INSERT OR IGNORE INTO clients (user_id, name, created_at, updated_at)
SELECT user_id, trim(client_name), min(created_at), max(updated_at)
FROM appointments
WHERE client_name IS NOT NULL AND trim(client_name) != ''
GROUP BY user_id, trim(client_name);

-- Добавляем колонки рабочих часов мастера в users (если их еще нет)
ALTER TABLE users ADD COLUMN work_start_time TEXT DEFAULT '09:00';
ALTER TABLE users ADD COLUMN work_end_time TEXT DEFAULT '20:00';
ALTER TABLE users ADD COLUMN work_days TEXT DEFAULT '1,2,3,4,5,6';

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0006_clients_and_schedule');

COMMIT;
