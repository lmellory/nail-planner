// Восстановление из резервной копии: POST /api/import { backup, confirm? }
//   без confirm: true — только проверка файла и отчёт «что будет восстановлено» (ничего не меняется);
//   с confirm: true — данные мастера заменяются содержимым копии (одной транзакцией).
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { restoreBackup, sanitizeBackup } from '../lib/restore';

export const importer = new Hono<{ Bindings: Env; Variables: AppVars }>();

importer.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { backup?: unknown; confirm?: unknown } | null;
  const parsed = sanitizeBackup(body?.backup);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  if (body?.confirm !== true) return c.json({ dry_run: true, report: parsed.report });

  await restoreBackup(c.env.DB, c.get('userId'), c.env.TZ, parsed.data);
  return c.json({ ok: true, report: parsed.report });
});
