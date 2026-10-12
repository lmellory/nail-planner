-- 0012: статус записи + снимаем CHECK с service.
--  status: 'scheduled' (по умолчанию) | 'no_show' (не пришла) | 'cancelled' (отменила).
--  Допустимые значения status и service проверяются в коде (src/lib/status.ts, src/lib/services.ts),
--  чтобы новая услуга или статус больше не требовали пересоздания таблицы.
--  Остальные ограничения сохранены: покрытия gel/none, цена 0..10 000 000, конец позже начала.
--  Таблица пересоздаётся (SQLite не умеет менять CHECK через ALTER); миграция идёт одной транзакцией.

CREATE TABLE appointments_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  date               TEXT    NOT NULL,   -- YYYY-MM-DD
  start_time         TEXT    NOT NULL,   -- HH:MM
  end_time           TEXT,               -- HH:MM
  client_name        TEXT    NOT NULL,
  who                TEXT,               -- «кто это, что за человек»
  service            TEXT    NOT NULL,
  manicure_coating   TEXT    CHECK (manicure_coating IN ('gel','none')),
  pedicure_coating   TEXT    CHECK (pedicure_coating IN ('gel','none')),
  comment            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  price              INTEGER CHECK (price IS NULL OR (price >= 0 AND price <= 10000000)),
  status             TEXT    NOT NULL DEFAULT 'scheduled',
  CHECK (end_time IS NULL OR end_time > start_time)
);

INSERT INTO appointments_new
  (id, user_id, date, start_time, end_time, client_name, who, service,
   manicure_coating, pedicure_coating, comment, created_at, updated_at, price)
  SELECT id, user_id, date, start_time, end_time, client_name, who, service,
         manicure_coating, pedicure_coating, comment, created_at, updated_at, price
  FROM appointments;

DROP TABLE appointments;
ALTER TABLE appointments_new RENAME TO appointments;
CREATE INDEX IF NOT EXISTS idx_appt_user_date ON appointments(user_id, date);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0012_status_free_service');
