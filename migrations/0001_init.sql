-- Пользователи (1-2 человека). Настройки уведомлений хранятся тут.
CREATE TABLE IF NOT EXISTS users (
  user_id            INTEGER PRIMARY KEY,
  tz                 TEXT    NOT NULL DEFAULT 'Europe/Chisinau',
  notify_enabled     INTEGER NOT NULL DEFAULT 1,
  notify_time        TEXT    NOT NULL DEFAULT '23:00',
  last_notified_date TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Записи клиентов. service: manicure | pedicure | both
-- coating: 'gel' (с покрытием) | 'none' (без). Для 'both' покрытия отдельно по каждой услуге.
CREATE TABLE IF NOT EXISTS appointments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  date               TEXT    NOT NULL,   -- YYYY-MM-DD
  start_time         TEXT    NOT NULL,   -- HH:MM
  end_time           TEXT    NOT NULL,   -- HH:MM (строго позже start_time)
  client_name        TEXT    NOT NULL,
  who                TEXT,               -- «кто это, что за человек»
  service            TEXT    NOT NULL CHECK (service IN ('manicure','pedicure','both')),
  manicure_coating   TEXT    CHECK (manicure_coating IN ('gel','none')),
  pedicure_coating   TEXT    CHECK (pedicure_coating IN ('gel','none')),
  comment            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_user_date ON appointments(user_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_user_name ON appointments(user_id, client_name);

-- Заметка к дню (необязательная)
CREATE TABLE IF NOT EXISTS day_notes (
  user_id INTEGER NOT NULL,
  date    TEXT    NOT NULL,
  text    TEXT    NOT NULL,
  PRIMARY KEY (user_id, date)
);
