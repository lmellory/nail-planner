-- 0009: цена записи (для раздела «Доходы»).
--  Целое число в валюте мастера, необязательное: у старых записей цена остаётся NULL
--  и в доходах не учитывается. Таблица не пересоздаётся — достаточно ADD COLUMN.

ALTER TABLE appointments ADD COLUMN price INTEGER CHECK (price IS NULL OR (price >= 0 AND price <= 10000000));

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0009_price');
