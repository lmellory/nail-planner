-- 0014: имя и @username пользователя для админ-панели (чтобы в списке мастеров были имена, а не только ID).
--  Заполняются при открытии Mini App самим мастером из подписанных данных Telegram (initData); пока пусто — в списке только ID.

ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN username TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0014_user_names');
