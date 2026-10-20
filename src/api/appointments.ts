// CRUD записей + проверка пересечений (предупреждение, без запрета).
import { Hono } from 'hono';
import type { AppVars, Env, Service } from '../types';
import { NEW_APPT_MSG_TTL_SEC, scheduleMessageDelete } from '../db/notifications';
import { deleteAppointment, findConflicts, getAppointment, insertAppointment, listAppointments, updateAppointment } from '../db/appointments';
import { ensureUser } from '../db/users';
import { addMinutes, defaultServiceDuration, isDate, isTime } from '../lib/time';
import { escapeHtml, sendMessage } from '../bot/telegram';
import { parseAmount } from '../lib/money';
import { isService } from '../lib/services';
import { asRecord } from '../lib/validation';
import { isStatus } from '../lib/status';
import { serviceLabel, timeLabel } from '../lib/format';

export const appointments = new Hono<{ Bindings: Env; Variables: AppVars }>();

const COATINGS = ['gel', 'none'];

/** Проверка и нормализация тела запроса. Возвращает [данные, ошибка]. */
export function validate(input: unknown) {
  const b = asRecord(input);
  if (!isDate(b?.date)) return [null, 'Некорректная дата'] as const;
  if (!isTime(b?.start_time)) return [null, 'Некорректное время'] as const;
  const name = typeof b.client_name === 'string' ? b.client_name.trim() : '';
  if (!name) return [null, 'Укажи имя клиента'] as const;
  if (!isService(b?.service)) return [null, 'Некорректная услуга'] as const;

  let endTime = isTime(b?.end_time) ? (b.end_time as string) : null;
  if (!endTime) {
    endTime = addMinutes(b.start_time, defaultServiceDuration(b.service));
  }
  if (endTime <= b.start_time) return [null, 'Конец должен быть позже начала'] as const;

  const needM = b.service === 'manicure' || b.service === 'both';
  const needP = b.service === 'pedicure' || b.service === 'both';
  const mc = needM ? b.manicure_coating : null;
  const pc = needP ? b.pedicure_coating : null;
  if ((needM && !COATINGS.includes(String(mc))) || (needP && !COATINGS.includes(String(pc))))
    return [null, 'Укажи покрытие: с покрытием или без'] as const;

  const price = parseAmount(b?.price);
  if (price === undefined) return [null, 'Цена: целое число от 0 до 10 000 000'] as const;

  const status = b?.status === undefined || b?.status === null ? 'scheduled' : b.status;
  if (!isStatus(status)) return [null, 'Некорректный статус'] as const;

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
    price,
    status,
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
  const b = asRecord(await c.req.json().catch(() => null));
  if (!isDate(b?.date) || !isTime(b?.start_time)) return c.json({ conflicts: [] });
  const service = isService(b?.service) ? b.service : 'manicure';
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

  const conflicts = await findConflicts(
    c.env.DB,
    userId,
    d.date,
    d.start_time,
    d.end_time ?? addMinutes(d.start_time, 120),
    0,
  );

  const id = await insertAppointment(c.env.DB, userId, d, c.env.TZ);

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
  const conflicts = await findConflicts(
    c.env.DB,
    userId,
    d.date,
    d.start_time,
    d.end_time ?? addMinutes(d.start_time, 120),
    id,
  );
  if (!(await updateAppointment(c.env.DB, userId, id, d))) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, conflicts });
});

// DELETE /api/appointments/:id
appointments.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  return c.json({ ok: await deleteAppointment(c.env.DB, c.get('userId'), id) });
});
