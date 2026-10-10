// Экспорт данных пользователя: CSV (UTF-8 с BOM, разделитель «;»), JSON и отправка в чат ботом
import { Hono, type Context } from 'hono';
import type { Appointment, AppVars, Env } from '../types';
import { ensureUser, getAllAppointments, getAllDayNotes } from '../db';
import { sendDocument } from '../bot/telegram';
import { nowInTz } from '../lib/time';

export const exporter = new Hono<{ Bindings: Env; Variables: AppVars }>();

export function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  // Защита от CSV-инъекции: Excel выполнит ячейку, начинающуюся с = + - @ как формулу
  // Но если это телефонный номер (+цифры, скобки, пробелы), не ломаем его апострофом
  if (/^[=+\-@\t\r]/.test(str)) {
    if (!/^\+[\d\s()\-]+$/.test(str)) {
      str = `'${str}`;
    }
  }
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serviceLabelRu(service: string): string {
  if (service === 'manicure') return 'маникюр';
  if (service === 'pedicure') return 'педикюр';
  if (service === 'both') return 'маникюр + педикюр';
  if (service === 'fingers') return 'пальцы';
  return service;
}

function coatingLabel(service: string, manicureCoating: string | null, pedicureCoating: string | null): string {
  const coat = (c: string | null) => (c === 'gel' ? 'с покрытием' : c === 'none' ? 'без покрытия' : '');
  if (service === 'manicure') return coat(manicureCoating);
  if (service === 'pedicure') return coat(pedicureCoating);
  if (service === 'both') {
    return `маникюр ${coat(manicureCoating)}, педикюр ${coat(pedicureCoating)}`;
  }
  return '';
}

export function buildCsv(items: Appointment[]): string {
  const header = ['дата', 'начало', 'конец', 'имя', 'кто это', 'услуга', 'покрытие', 'цена', 'комментарий'];
  const lines = [
    header.map(csvEscape).join(';'),
    ...items.map((a) =>
      [
        a.date,
        a.start_time,
        a.end_time ?? '',
        a.client_name,
        a.who ?? '',
        serviceLabelRu(a.service),
        coatingLabel(a.service, a.manicure_coating, a.pedicure_coating),
        a.price ?? '',
        a.comment ?? '',
      ]
        .map(csvEscape)
        .join(';'),
    ),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

export async function buildJsonBackup(db: D1Database, userId: number, fallbackTz: string) {
  const appointments = await getAllAppointments(db, userId);
  const day_notes = await getAllDayNotes(db, userId);
  const u = await ensureUser(db, userId, fallbackTz);
  const settings = {
    notify_enabled: !!u.notify_enabled,
    notify_time: u.notify_time,
    tz: u.tz,
    notify_new_appt: !!u.notify_new_appt,
  };
  return JSON.stringify({ appointments, day_notes, settings }, null, 2);
}

async function handleCsv(c: Context<{ Bindings: Env; Variables: AppVars }>) {
  const userId = c.get('userId');
  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const { date: today } = nowInTz(u.tz);
  const appointments = await getAllAppointments(c.env.DB, userId);
  const csvStr = buildCsv(appointments);
  const filename = `nail-planner-${today}.csv`;

  return new Response(csvStr, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function handleJson(c: Context<{ Bindings: Env; Variables: AppVars }>) {
  const userId = c.get('userId');
  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const { date: today } = nowInTz(u.tz);
  const jsonStr = await buildJsonBackup(c.env.DB, userId, c.env.TZ);
  const filename = `nail-planner-backup-${today}.json`;

  return new Response(jsonStr, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// Маршруты для прямого скачивания
exporter.get('/csv', handleCsv);
exporter.get('/json', handleJson);
exporter.get('/', (c) => (c.req.query('format') === 'json' ? handleJson(c) : handleCsv(c)));

// Отправка файла в чат Telegram пользователю
exporter.post('/send', async (c) => {
  const userId = c.get('userId');
  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const { date: today } = nowInTz(u.tz);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const format = body?.format === 'json' ? 'json' : 'csv';

  if (format === 'json') {
    const jsonStr = await buildJsonBackup(c.env.DB, userId, c.env.TZ);
    const filename = `nail-planner-backup-${today}.json`;
    const res = await sendDocument(
      c.env,
      userId,
      new Blob([jsonStr], { type: 'application/json; charset=utf-8' }),
      filename,
      `💾 Резервная копия (${today})`,
    );
    if (!res.ok) {
      return c.json({ error: 'Не удалось отправить файл в Telegram' }, 500);
    }
    return c.json({ ok: true, filename });
  } else {
    const appointments = await getAllAppointments(c.env.DB, userId);
    const csvStr = buildCsv(appointments);
    const filename = `nail-planner-${today}.csv`;
    const res = await sendDocument(
      c.env,
      userId,
      new Blob([csvStr], { type: 'text/csv; charset=utf-8' }),
      filename,
      `📊 Экспорт записей (${today})`,
    );
    if (!res.ok) {
      return c.json({ error: 'Не удалось отправить файл в Telegram' }, 500);
    }
    return c.json({ ok: true, filename });
  }
});
