// Экспорт данных пользователя: CSV (UTF-8 с BOM, разделитель «;»), JSON и отправка в чат ботом
import { Hono, type Context } from 'hono';
import type { Appointment, AppVars, Env, Expense } from '../types';
import { ensureUser, getAllAppointments, listAppointments, listExpenses } from '../db';
import { buildJsonBackup } from '../lib/backup';
import { isPeriod, periodRange } from '../lib/stats';
import { sendDocument } from '../bot/telegram';
import { isDate, nowInTz } from '../lib/time';

export { buildJsonBackup };

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

/** Одна ячейка CSV: числа пишем как есть (иначе отрицательная прибыль получила бы апостроф от защиты csvEscape). */
const cell = (v: unknown) => (typeof v === 'number' ? String(v) : csvEscape(v));

/**
 * CSV «Доходы и траты» за период: построчно доходы (записи с ценой) и траты, затем итоги и траты по материалам.
 * Записи без цены в доход не входят — их количество указано отдельной строкой.
 */
export function buildFinanceCsv(appointments: Appointment[], expenses: Expense[]): string {
  const paid = appointments.filter((a) => a.price !== null && a.price !== undefined);
  const unpaid = appointments.length - paid.length;

  type Row = { date: string; kind: number; cells: Array<string | number> };
  const rows: Row[] = [
    ...paid.map((a) => ({ date: a.date, kind: 0, cells: ['доход', a.date, a.client_name, serviceLabelRu(a.service), a.price as number] })),
    ...expenses.map((e) => ({ date: e.date, kind: 1, cells: ['трата', e.date, e.name, 'материалы', e.amount] })),
  ].sort((x, y) => (x.date === y.date ? x.kind - y.kind : x.date < y.date ? -1 : 1));

  const totalIncome = paid.reduce((s, a) => s + (a.price as number), 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);

  const byName = new Map<string, { sum: number; count: number }>();
  for (const e of expenses) {
    const m = byName.get(e.name) ?? { sum: 0, count: 0 };
    m.sum += e.amount;
    m.count += 1;
    byName.set(e.name, m);
  }
  const materials = [...byName.entries()].sort((a, b) => b[1].sum - a[1].sum || a[0].localeCompare(b[0], 'ru'));

  const line = (cells: Array<string | number>) => cells.map(cell).join(';');
  const lines = [
    line(['тип', 'дата', 'описание', 'категория', 'сумма']),
    ...rows.map((r) => line(r.cells)),
    '',
    line(['итого доход', '', '', '', totalIncome]),
    line(['итого траты', '', '', '', totalExpense]),
    line(['прибыль', '', '', '', totalIncome - totalExpense]),
    ...(unpaid > 0 ? [line(['записей без цены (не учтены)', '', '', '', unpaid])] : []),
    '',
    line(['траты по материалам', '', '', 'покупок', 'сумма']),
    ...materials.map(([name, m]) => line(['материал', '', name, m.count, m.sum])),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

// Отправка в чат CSV «Доходы и траты» за период: POST /api/export/finance { period, date? }
exporter.post('/finance', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isPeriod(body?.period)) return c.json({ error: 'period: week | month | year' }, 400);

  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const date = body.date === undefined ? nowInTz(u.tz).date : body.date;
  if (!isDate(date)) return c.json({ error: 'Некорректная дата' }, 400);

  const { from, to } = periodRange(body.period, date);
  const [appointments, expenses] = await Promise.all([
    listAppointments(c.env.DB, userId, from, to),
    listExpenses(c.env.DB, userId, from, to, 10000),
  ]);
  const filename = `nail-planner-finance-${from}_${to}.csv`;
  const res = await sendDocument(
    c.env,
    userId,
    new Blob([buildFinanceCsv(appointments, expenses)], { type: 'text/csv; charset=utf-8' }),
    filename,
    `📊 Доходы и траты: ${from} — ${to}`,
  );
  if (!res.ok) return c.json({ error: 'Не удалось отправить файл в Telegram' }, 500);
  return c.json({ ok: true, filename });
});
