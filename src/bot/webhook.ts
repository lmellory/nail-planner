// Обработка апдейтов Telegram (webhook). Команды: /start /menu /today /tomorrow /id
import { Hono } from 'hono';
import type { Env } from '../types';
import { parseAllowedIds } from '../auth';
import { listAppointments } from '../db';
import { addDays, nowInTz } from '../lib/time';
import { formatDay } from '../lib/format';
import { openAppKeyboard, sendMessage } from './telegram';

export const webhook = new Hono<{ Bindings: Env }>();

webhook.post('/', async (c) => {
  // Telegram присылает секрет в заголовке (задаётся при setWebhook через secret_token)
  if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== c.env.WEBHOOK_SECRET) return c.text('forbidden', 403);

  const update = await c.req.json<any>();
  const msg = update.message;
  if (!msg?.text || !msg.from) return c.text('ok');

  const userId: number = msg.from.id;
  const text: string = msg.text.trim();
  const appUrl = new URL(c.req.url).origin + '/';

  // /id отвечает всем (нужен, чтобы узнать свой ID). Можно отключить: ENABLE_ID_COMMAND="false"
  if (text.startsWith('/id') && c.env.ENABLE_ID_COMMAND !== 'false') {
    await sendMessage(c.env, msg.chat.id, `Твой ID: <code>${userId}</code>`);
    return c.text('ok');
  }

  // Чужим бот молчит
  if (!parseAllowedIds(c.env.ALLOWED_IDS).includes(userId)) return c.text('ok');

  const cmd = text.split(/[\s@]/)[0];
  if (cmd === '/start' || cmd === '/menu') {
    const welcome = `🌸 <b>Добро пожаловать в твой Ежедневник!</b>\n\n` +
      `Здесь удобно вести записи клиентов, следить за расписанием и ничего не забывать. Вот как всё устроено:\n\n` +
      `💅 <b>Записи клиентов:</b>\n` +
      `Нажми «<b>+</b>» внизу экрана, чтобы добавить клиента. Укажи время (есть быстрые чипы 1ч, 1.5ч, 2ч, 3ч), имя, услугу (маникюр / педикюр / оба) и покрытие (гель / без). При нажатии на карточку запись можно изменить, перенести или удалить.\n\n` +
      `📅 <b>Неделя и календарь:</b>\n` +
      `• Листай дни недели свайпом влево/вправо.\n` +
      `• Точки под числами показывают количество записей.\n` +
      `• Иконка 📅 в правом верхнем углу открывает большой календарь на 3 года вперёд.\n\n` +
      `📝 <b>Заметки на день:</b>\n` +
      `Кнопка «Заметка» вверху списка сохраняет напоминания на день (закупки, задачи). Заметка сразу дублируется сюда в чат, а в календаре появится значок 📝.\n\n` +
      `🌙 <b>Вечерние напоминания:</b>\n` +
      `Каждый вечер в заданное время (по умолчанию 23:00) бот сам присылает сюда расписание на завтра. Время и вкл/выкл настраиваются в ⚙️.\n\n` +
      `🔍 <b>Поиск и экспорт:</b>\n` +
      `• 🔍 Находит историю записей любого клиента по имени.\n` +
      `• ⚙️ В настройках кнопка «Выгрузить в Excel» отправит файл со всеми записями сюда в чат.\n\n` +
      `💬 <b>Быстрые команды бота:</b>\n` +
      `• /today — расписание на сегодня\n` +
      `• /tomorrow — расписание на завтра\n` +
      `• /notify — принудительно прислать вечернюю сводку\n` +
      `• /menu — открыть ежедневник`;

    await sendMessage(c.env, msg.chat.id, welcome, openAppKeyboard(appUrl, '💅 Открыть ежедневник'));
  } else if (cmd === '/today' || cmd === '/tomorrow') {
    const { date } = nowInTz(c.env.TZ);
    const target = cmd === '/today' ? date : addDays(date, 1);
    const items = await listAppointments(c.env.DB, userId, target, target);
    const note = await c.env.DB.prepare('SELECT text FROM day_notes WHERE user_id=? AND date=?')
      .bind(userId, target).first<{ text: string }>();
    await sendMessage(c.env, msg.chat.id, formatDay(target, items, note?.text), openAppKeyboard(appUrl));
  } else if (cmd === '/notify') {
    const { date } = nowInTz(c.env.TZ);
    const target = addDays(date, 1);
    const items = await listAppointments(c.env.DB, userId, target, target);
    const note = await c.env.DB.prepare('SELECT text FROM day_notes WHERE user_id=? AND date=?')
      .bind(userId, target).first<{ text: string }>();
    const textMsg = `🌙 <b>Расписание на завтра</b>\n\n${formatDay(target, items, note?.text)}`;
    await sendMessage(c.env, msg.chat.id, textMsg, openAppKeyboard(appUrl));
  }
  return c.text('ok');
});
