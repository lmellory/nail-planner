// Заметки к дню (необязательные) + уведомление в Telegram
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { isDate, weekdayRu } from '../lib/time';
import {
  NEW_APPT_MSG_TTL_SEC,
  deleteDayNote,
  getDayNote,
  scheduleMessageDelete,
  upsertDayNote,
} from '../db';
import { escapeHtml, sendMessage } from '../bot/telegram';

export const notes = new Hono<{ Bindings: Env; Variables: AppVars }>();

notes.get('/:date', async (c) => {
  const date = c.req.param('date');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  return c.json({ text: await getDayNote(c.env.DB, c.get('userId'), date) });
});

// PUT — создать/изменить. Пустой текст = удалить заметку.
notes.put('/:date', async (c) => {
  const date = c.req.param('date');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  const body: any = await c.req.json().catch(() => null);
  const text = String(body?.text ?? '').trim().slice(0, 2000);
  const uid = c.get('userId');

  if (!text) {
    await deleteDayNote(c.env.DB, uid, date);
    return c.json({ ok: true });
  }

  const previous = await getDayNote(c.env.DB, uid, date);
  await upsertDayNote(c.env.DB, uid, date, text);

  // Дублируем в чат Telegram только если текст действительно изменился (без спама при повторном сохранении)
  if (text !== previous) {
    const [y, m, d] = date.split('-');
    const msg = `📝 <b>Заметка на ${d}.${m}.${y} (${weekdayRu(date)}):</b>\n\n${escapeHtml(text)}`;
    const notify = (async () => {
      const r = await sendMessage(c.env, uid, msg);
      const messageId = r.result?.message_id;
      if (r.ok && typeof messageId === 'number') {
        await scheduleMessageDelete(c.env.DB, uid, messageId, NEW_APPT_MSG_TTL_SEC);
      }
    })().catch((e) => console.error('Ошибка отправки заметки в бот:', e));

    try {
      c.executionCtx.waitUntil(notify);
    } catch {
      await notify;
    }
  }
  return c.json({ ok: true });
});
