-- 0011: прайс услуг (цена подставляется в форму записи) и еженедельная резервная копия в чат.
--  service_prices: по строке на услугу. Список услуг проверяется в коде, а не CHECK-ом,
--  чтобы новая услуга не требовала миграции.
--  users.backup_enabled: присылать ли копию раз в неделю (по умолчанию да).
--  users.last_backup_date: «слот» (дата воскресенья), за который копия уже отправлена.

CREATE TABLE IF NOT EXISTS service_prices (
  user_id INTEGER NOT NULL,
  service TEXT    NOT NULL,
  price   INTEGER NOT NULL CHECK (price >= 0 AND price <= 10000000),
  PRIMARY KEY (user_id, service)
);

ALTER TABLE users ADD COLUMN backup_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_backup_date TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0011_prices_and_backup');
