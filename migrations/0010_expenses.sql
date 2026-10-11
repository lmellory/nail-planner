-- 0010: учёт трат на материалы. Каждая покупка — отдельная запись (дата, название, сумма).
--  Название вводится свободным текстом; одинаковые названия группируются в «трат по материалам».

CREATE TABLE IF NOT EXISTS expenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  date       TEXT    NOT NULL,   -- YYYY-MM-DD
  name       TEXT    NOT NULL,   -- на что потрачено: «Гель-лак», «Пилки»…
  amount     INTEGER NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0010_expenses');
