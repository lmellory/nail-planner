// Заметки к дню (необязательные) + уведомление в Telegram
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { isDate, weekdayRu } from '../lib/time';
import { escapeHtml, sendMessage } from '../bot/telegram';

export const notes = new Hono<{ Bindings: Env; Variables: AppVars }>();

notes.get('/:date', async (c) => {
  const date = c.req.param('date');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  const row = await c.env.DB.prepare('SELECT text FROM day_notes WHERE user_id=? AND date=?')
    .bind(c.get('userId'), date).first<{ text: string }>();
  return c.json({ text: row?.text ?? '' });
});

// PUT — создать/изменить. Пустой текст = удалить заметку.
notes.put('/:date', async (c) => {
  const date = c.req.param('date');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  const text = String((await c.req.json()).text ?? '').trim().slice(0, 2000);
  const uid = c.get('userId');
  if (!text) {
    await c.env.DB.prepare('DELETE FROM day_notes WHERE user_id=? AND date=?').bind(uid, date).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO day_notes (user_id, date, text) VALUES (?,?,?)
       ON CONFLICT(user_id, date) DO UPDATE SET text=excluded.text`,
    ).bind(uid, date, text).run();

    // Отправляем заметку в чат Telegram мастера
    const [y, m, d] = date.split('-');
    const msg = `📝 <b>Заметка на ${d}.${m}.${y} (${weekdayRu(date)}):</b>\n\n${escapeHtml(text)}`;
    await sendMessage(c.env, uid, msg).catch((e) => console.error('Ошибка отправки заметки в бот:', e));
  }
  return c.json({ ok: true });
});
