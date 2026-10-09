-- 0007: День рождения клиента (число и месяц) и дата утреннего уведомления в users.
BEGIN;

ALTER TABLE clients ADD COLUMN birthday TEXT; -- DD.MM (например '09.10' для 9 октября)
ALTER TABLE users ADD COLUMN last_birthday_notify_date TEXT; -- YYYY-MM-DD последней отправки ДР в 10:00

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0007_client_birthdays');

COMMIT;
