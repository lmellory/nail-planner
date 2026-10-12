// Точка входа Worker: API + webhook бота + cron
import { Hono } from 'hono';
import type { AppVars, Env } from './types';
import { authMiddleware } from './auth';
import { appointments } from './api/appointments';
import { clients } from './api/clients';
import { notes } from './api/notes';
import { days } from './api/days';
import { search } from './api/search';
import { settings } from './api/settings';
import { stats } from './api/stats';
import { expenses } from './api/expenses';
import { prices } from './api/prices';
import { importer } from './api/import';
import { exporter } from './api/export';
import { webhook } from './bot/webhook';
import { runNotifications, runWeeklyBackups } from './cron';
import { createTursoD1 } from './lib/turso';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

// Подключение Turso (если заданы переменные TURSO_URL и TURSO_AUTH_TOKEN)
app.use('*', async (c, next) => {
  if (c.env.TURSO_URL && c.env.TURSO_AUTH_TOKEN) {
    c.env.DB = createTursoD1(c.env.TURSO_URL, c.env.TURSO_AUTH_TOKEN);
  }
  await next();
});

// Бот (webhook Telegram)
app.route('/webhook', webhook as any);

// Проверка наличия базы для API роутов
app.use('/api/*', async (c, next) => {
  if (!c.env.DB) {
    return c.json({ error: 'Database connection is not configured' }, 500);
  }
  await next();
});

// API Mini App — только с валидной подписью Telegram и ID из ALLOWED_IDS
app.use('/api/*', authMiddleware);
app.route('/api/appointments', appointments);
app.route('/api/clients', clients);
app.route('/api/notes', notes);
app.route('/api/days', days);
app.route('/api/search', search);
app.route('/api/settings', settings);
app.route('/api/stats', stats);
app.route('/api/expenses', expenses);
app.route('/api/prices', prices);
app.route('/api/import', importer);
app.route('/api/export', exporter);

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'internal error' }, 500);
});

// Всё остальное (интерфейс) отдаёт Workers Static Assets
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // Cron Trigger (каждую минуту)
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (env.TURSO_URL && env.TURSO_AUTH_TOKEN) {
      env.DB = createTursoD1(env.TURSO_URL, env.TURSO_AUTH_TOKEN);
    }
    const appUrl = env.APP_URL ?? '';
    try {
      await runNotifications(env, appUrl);
    } catch (err) {
      console.error('Scheduled notification error:', err);
    }
    try {
      await runWeeklyBackups(env);
    } catch (err) {
      console.error('Scheduled backup error:', err);
    }
  },
};
