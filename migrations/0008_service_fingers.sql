-- 0008: новая услуга «пальцы» (service = 'fingers').
--  В 0001/0003/0005 на колонке service стоит CHECK (service IN ('manicure','pedicure','both')),
--  а SQLite не умеет менять CHECK через ALTER, поэтому таблица appointments пересоздаётся
--  (так же, как в 0005). Все существующие записи копируются без изменений.
--  Для 'fingers' оба покрытия (manicure_coating / pedicure_coating) хранятся как NULL.

BEGIN;

CREATE TABLE appointments_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  date               TEXT    NOT NULL,   -- YYYY-MM-DD
  start_time         TEXT    NOT NULL,   -- HH:MM
  end_time           TEXT,               -- HH:MM (необязательно)
  client_name        TEXT    NOT NULL,
  who                TEXT,               -- «кто это, что за человек»
  service            TEXT    NOT NULL CHECK (service IN ('manicure','pedicure','both','fingers')),
  manicure_coating   TEXT    CHECK (manicure_coating IN ('gel','none')),
  pedicure_coating   TEXT    CHECK (pedicure_coating IN ('gel','none')),
  comment            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time IS NULL OR end_time > start_time)
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

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0008_service_fingers');

COMMIT;
