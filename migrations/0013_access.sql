-- 0013: управление доступом из бота (/adduser, /ban, /unban).
--  Итоговый доступ = (ALLOWED_IDS из секрета ∪ added = 1) минус banned = 1.
--  Секрет ALLOWED_IDS не меняется: пользователи из него остаются, пока их не заблокировали командой /ban.
--  added  — доступ выдан командой /adduser;
--  banned — доступ закрыт командой /ban (сильнее и ALLOWED_IDS, и added). Данные пользователя в базе не удаляются.

CREATE TABLE IF NOT EXISTS access (
  user_id    INTEGER PRIMARY KEY,
  added      INTEGER NOT NULL DEFAULT 0 CHECK (added IN (0, 1)),
  banned     INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0013_access');
