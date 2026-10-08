// CRUD записей + проверка пересечений (предупреждение, без запрета).
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { findConflicts, getAppointment, listAppointments } from '../db';
import { isDate, isTime } from '../lib/time';

export const appointments = new Hono<{ Bindings: Env; Variables: AppVars }>();

const SERVICES = ['manicure', 'pedicure', 'both'];
const COATINGS = ['gel', 'none'];

/** Проверка и нормализация тела запроса. Возвращает [данные, ошибка]. */
function validate(b: any) {
  if (!isDate(b?.date)) return [null, 'Некорректная дата'] as const;
  if (!isTime(b?.start_time) || !isTime(b?.end_time)) return [null, 'Некорректное время'] as const;
  if (b.end_time <= b.start_time) return [null, 'Конец должен быть позже начала'] as const;
  const name = String(b.client_name ?? '').trim();
  if (!name) return [null, 'Укажи имя клиента'] as const;
  if (!SERVICES.includes(b.service)) return [null, 'Некорректная услуга'] as const;

  const needM = b.service === 'manicure' || b.service === 'both';
  const needP = b.service === 'pedicure' || b.service === 'both';
  const mc = needM ? b.manicure_coating : null;
  const pc = needP ? b.pedicure_coating : null;
  if ((needM && !COATINGS.includes(mc)) || (needP && !COATINGS.includes(pc)))
    return [null, 'Укажи покрытие: с покрытием или без'] as const;

  return [{
    date: b.date, start_time: b.start_time, end_time: b.end_time,
    client_name: name.slice(0, 100),
    who: b.who ? String(b.who).slice(0, 200) : null,
    service: b.service, manicure_coating: mc, pedicure_coating: pc,
    comment: b.comment ? String(b.comment).slice(0, 1000) : null,
  }, null] as const;
}

// GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
appointments.get('/', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  return c.json(await listAppointments(c.env.DB, c.get('userId'), from, to));
});

// POST /api/appointments/check — проверка пересечений до сохранения (для предупреждения в форме)
appointments.post('/check', async (c) => {
  const b = await c.req.json();
  const conflicts = await findConflicts(c.env.DB, c.get('userId'), b.date, b.start_time, b.end_time, Number(b.exclude_id ?? 0));
  return c.json({ conflicts });
});

// POST /api/appointments — создать (пересечение не блокирует, возвращаем conflicts)
appointments.post('/', async (c) => {
  const userId = c.get('userId');
  const [d, err] = validate(await c.req.json());
  if (!d) return c.json({ error: err }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO appointments (user_id, date, start_time, end_time, client_name, who, service,
       manicure_coating, pedicure_coating, comment) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(userId, d.date, d.start_time, d.end_time, d.client_name, d.who, d.service,
         d.manicure_coating, d.pedicure_coating, d.comment).run();
  const id = res.meta.last_row_id as number;
  const conflicts = (await findConflicts(c.env.DB, userId, d.date, d.start_time, d.end_time, id));

  // Уведомление мастера в Telegram о новой записи
  try {
    const [y, m, dNum] = d.date.split('-');
    const coat = (val: string | null) => (val === 'gel' ? 'с покрытием' : 'без покрытия');
    let sLabel = `маникюр ${coat(d.manicure_coating)}`;
    if (d.service === 'pedicure') sLabel = `педикюр ${coat(d.pedicure_coating)}`;
    else if (d.service === 'both') sLabel = `маникюр ${coat(d.manicure_coating)} + педикюр ${coat(d.pedicure_coating)}`;

    const text = `💅 <b>Новая запись: ${dNum}.${m}.${y}</b>\n🕐 <b>${d.start_time}–${d.end_time}</b> · ${d.client_name}${d.who ? ` (${d.who})` : ''}\n💅 ${sLabel}${d.comment ? `\n💬 ${d.comment}` : ''}`;
    await c.env.DB && c.env.BOT_TOKEN && (await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text, parse_mode: 'HTML' }),
    }));
  } catch {}

  return c.json({ id, conflicts }, 201);
});

// PUT /api/appointments/:id — изменить / перенести (меняется date и/или время)
appointments.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!(await getAppointment(c.env.DB, userId, id))) return c.json({ error: 'not found' }, 404);
  const [d, err] = validate(await c.req.json());
  if (!d) return c.json({ error: err }, 400);
  await c.env.DB.prepare(
    `UPDATE appointments SET date=?, start_time=?, end_time=?, client_name=?, who=?, service=?,
       manicure_coating=?, pedicure_coating=?, comment=?, updated_at=datetime('now')
     WHERE user_id=? AND id=?`,
  ).bind(d.date, d.start_time, d.end_time, d.client_name, d.who, d.service,
         d.manicure_coating, d.pedicure_coating, d.comment, userId, id).run();
  const conflicts = await findConflicts(c.env.DB, userId, d.date, d.start_time, d.end_time, id);
  return c.json({ ok: true, conflicts });
});

// DELETE /api/appointments/:id
appointments.delete('/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM appointments WHERE user_id=? AND id=?')
    .bind(c.get('userId'), Number(c.req.param('id'))).run();
  return c.json({ ok: r.meta.changes > 0 });
});
