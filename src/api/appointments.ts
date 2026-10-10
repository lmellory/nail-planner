// CRUD записей + проверка пересечений (предупреждение, без запрета).
import { Hono } from 'hono';
import type { AppVars, Env, Service } from '../types';
import {
  NEW_APPT_MSG_TTL_SEC,
  deleteAppointment,
  ensureClientExists,
  ensureUser,
  findConflicts,
  getAppointment,
  insertAppointment,
  listAppointments,
  scheduleMessageDelete,
  updateAppointment,
} from '../db';
import { addMinutes, defaultServiceDuration, isDate, isTime } from '../lib/time';
import { escapeHtml, sendMessage } from '../bot/telegram';
import { serviceLabel, timeLabel } from '../lib/format';

export const appointments = new Hono<{ Bindings: Env; Variables: AppVars }>();

const SERVICES = ['manicure', 'pedicure', 'both', 'fingers'];
const COATINGS = ['gel', 'none'];
export const MAX_PRICE = 10_000_000;

/** Цена: пусто → null, иначе целое число от 0 до MAX_PRICE (допускаются пробелы: «1 500»). */
function parsePrice(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isInteger(n) || n < 0 || n > MAX_PRICE) return { ok: false };
  return { ok: true, value: n };
}

/** Проверка и нормализация тела запроса. Возвращает [данные, ошибка]. */
export function validate(b: any) {
  if (!isDate(b?.date)) return [null, 'Некорректная дата'] as const;
  if (!isTime(b?.start_time)) return [null, 'Некорректное время'] as const;
  const name = String(b?.client_name ?? '').trim();
  if (!name) return [null, 'Укажи имя клиента'] as const;
  if (!SERVICES.includes(b?.service)) return [null, 'Некорректная услуга'] as const;

  let endTime = isTime(b?.end_time) ? (b.end_time as string) : null;
  if (!endTime) {
    endTime = addMinutes(b.start_time, defaultServiceDuration(b.service));
  }
  if (endTime <= b.start_time) return [null, 'Конец должен быть позже начала'] as const;

  const needM = b.service === 'manicure' || b.service === 'both';
  const needP = b.service === 'pedicure' || b.service === 'both';
  const mc = needM ? b.manicure_coating : null;
  const pc = needP ? b.pedicure_coating : null;
  if ((needM && !COATINGS.includes(mc)) || (needP && !COATINGS.includes(pc)))
    return [null, 'Укажи покрытие: с покрытием или без'] as const;

  const price = parsePrice(b?.price);
  if (!price.ok) return [null, 'Цена: целое число от 0 до 10 000 000'] as const;

  return [{
    date: b.date as string,
    start_time: b.start_time as string,
    end_time: endTime,
    client_name: name.slice(0, 100),
    who: b.who ? String(b.who).slice(0, 200) : null,
    service: b.service as Service,
    manicure_coating: mc as 'gel' | 'none' | null,
    pedicure_coating: pc as 'gel' | 'none' | null,
    comment: b.comment ? String(b.comment).slice(0, 1000) : null,
    price: price.value,
  }, null] as const;
}

// GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
appointments.get('/', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  return c.json(await listAppointments(c.env.DB, c.get('userId'), from, to));
});

// POST /api/appointments/check — проверка пересечений до сохранения (для предупреждения в форме).
appointments.post('/check', async (c) => {
  const b: any = await c.req.json().catch(() => null);
  if (!isDate(b?.date) || !isTime(b?.start_time)) return c.json({ conflicts: [] });
  const service = SERVICES.includes(b?.service) ? b.service : 'manicure';
  const endTime = isTime(b?.end_time)
    ? (b.end_time as string)
    : addMinutes(b.start_time, defaultServiceDuration(service));
  const conflicts = await findConflicts(
    c.env.DB, c.get('userId'), b.date, b.start_time, endTime, Number(b.exclude_id) || 0,
  );
  return c.json({ conflicts });
});

// POST /api/appointments — создать (пересечение не блокирует, возвращаем conflicts)
appointments.post('/', async (c) => {
  const userId = c.get('userId');
  const [d, err] = validate(await c.req.json().catch(() => null));
  if (!d) return c.json({ error: err }, 400);

  const id = await insertAppointment(c.env.DB, userId, d);
  await ensureClientExists(c.env.DB, userId, d.client_name, d.who).catch(() => {});
  const conflicts = await findConflicts(
    c.env.DB,
    userId,
    d.date,
    d.start_time,
    d.end_time ?? addMinutes(d.start_time, 120),
    id,
  );

  // Уведомление мастера в Telegram о новой записи (только если включено в настройках).
  // Отправляем в фоне: не задерживает ответ, ошибки не ломают сохранение.
  // Сообщение бот сам удалит из чата через NEW_APPT_MSG_TTL_SEC (запись в базе остаётся).
  const notify = (async () => {
    const u = await ensureUser(c.env.DB, userId, c.env.TZ);
    if (!u.notify_new_appt) return;
    const [y, m, dNum] = d.date.split('-');
    const text =
      `💅 <b>Новая запись: ${dNum}.${m}.${y}</b>\n` +
      `🕐 <b>${timeLabel(d)}</b> · ${escapeHtml(d.client_name)}${d.who ? ` (${escapeHtml(d.who)})` : ''}\n` +
      `💅 ${serviceLabel({ ...d, id, user_id: userId })}` +
      (d.comment ? `\n💬 ${escapeHtml(d.comment)}` : '');
    const r = await sendMessage(c.env, userId, text);
    const messageId = r.result?.message_id;
    if (r.ok && typeof messageId === 'number') {
      await scheduleMessageDelete(c.env.DB, userId, messageId, NEW_APPT_MSG_TTL_SEC);
    }
  })().catch((e) => console.error('new-appointment notify error', e));
  try {
    c.executionCtx.waitUntil(notify);
  } catch {
    await notify; // окружение без executionCtx (например, тесты)
  }

  return c.json({ id, conflicts }, 201);
});

// PUT /api/appointments/:id — изменить / перенести (меняется date и/или время)
appointments.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  if (!(await getAppointment(c.env.DB, userId, id))) return c.json({ error: 'not found' }, 404);
  const [d, err] = validate(await c.req.json().catch(() => null));
  if (!d) return c.json({ error: err }, 400);
  await updateAppointment(c.env.DB, userId, id, d);
  await ensureClientExists(c.env.DB, userId, d.client_name, d.who).catch(() => {});
  const conflicts = await findConflicts(
    c.env.DB,
    userId,
    d.date,
    d.start_time,
    d.end_time ?? addMinutes(d.start_time, 120),
    id,
  );
  return c.json({ ok: true, conflicts });
});

// DELETE /api/appointments/:id
appointments.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  return c.json({ ok: await deleteAppointment(c.env.DB, c.get('userId'), id) });
});
