// Обработка апдейтов Telegram (webhook). Команды: /start /menu /today /tomorrow /notify /id
import { Hono } from 'hono';
import type { Env } from '../types';
import { parseAllowedIds } from '../auth';
import { ensureUser, getDayNote, listAppointments } from '../db';
import { addDays, nowInTz } from '../lib/time';
import { formatDay } from '../lib/format';
import { openAppKeyboard, sendMessage } from './telegram';

export const webhook = new Hono<{ Bindings: Env }>();

const WELCOME =
  `🌸 <b>Добро пожаловать в твой Ежедневник!</b>\n\n` +
  `Здесь удобно вести записи клиентов, следить за расписанием и базой постоянных гостей. Вот как всё устроено:\n\n` +
  `💅 <b>Записи клиентов:</b>\n` +
  `Нажми «<b>+</b>» внизу экрана, чтобы добавить запись. Укажи время приёма, имя, услугу и покрытие. Длительность и проверка пересечений рассчитываются автоматически. При нажатии на карточку запись можно изменить, перенести или удалить.\n\n` +
  `👥 <b>База клиентов:</b>\n` +
  `Кнопка «Клиенты» хранит телефоны, ссылки на Telegram, заметки (аллергии, пожелания) и историю визитов. При вводе имени клиента данные подсказываются автоматически!\n\n` +
  `📅 <b>Неделя и календарь:</b>\n` +
  `• Листай дни недели свайпом влево/вправо.\n` +
  `• Точки под числами показывают количество записей.\n` +
  `• Иконка 📅 в правом верхнем углу открывает большой календарь на 3 года вперёд.\n\n` +
  `📝 <b>Заметки на день:</b>\n` +
  `Кнопка «Заметка» вверху списка сохраняет напоминания на день (закупки, задачи). Заметка сразу дублируется сюда в чат, а в календаре появится значок 📝.\n\n` +
  `🌙 <b>Вечерние напоминания:</b>\n` +
  `Каждый вечер в заданное время (по умолчанию 22:00) бот сам присылает сюда расписание на завтра со ссылками на клиентов. Время и вкл/выкл настраиваются в ⚙️.\n\n` +
  `💰 <b>Доходы:</b>\n` +
  `В записи можно указать цену. Иконка с графиком вверху показывает доход за неделю, месяц и год, средний чек и сравнение с прошлым периодом. Покупки материалов вносятся отдельными записями (кнопка «Добавить трату» на этом экране): бот посчитает траты по каждому материалу и прибыль.\n\n` +
  `🔍 <b>Поиск и экспорт:</b>\n` +
  `• 🔍 Находит историю записей любого клиента по имени.\n` +
  `• ⚙️ В настройках кнопка «Выгрузить в Excel» отправит файл со всеми записями сюда в чат.\n\n` +
  `💬 <b>Быстрые команды бота:</b>\n` +
  `• /today — расписание на сегодня\n` +
  `• /tomorrow — расписание на завтра\n` +
  `• /notify — принудительно прислать вечернюю сводку\n` +
  `• /menu — открыть ежедневник`;

webhook.post('/', async (c) => {
  // Telegram присылает секрет в заголовке (задаётся при setWebhook через secret_token).
  // Если секрет в окружении не задан — не принимаем ничего.
  const secret = c.env.WEBHOOK_SECRET;
  if (!secret || c.req.header('X-Telegram-Bot-Api-Secret-Token') !== secret) return c.text('forbidden', 403);

  // Любая ошибка внутри обработчика не должна превращаться в 500: иначе Telegram будет
  // бесконечно повторять доставку одного и того же апдейта.
  try {
    const update = await c.req.json<any>();
    const msg = update.message;
    if (!msg?.text || !msg.from) return c.text('ok');

    const userId: number = msg.from.id;
    const text: string = msg.text.trim();
    const cmd = text.split(/[\s@]/)[0];
    const appUrl = new URL(c.req.url).origin + '/';

    // /id отвечает всем (нужен, чтобы узнать свой ID). Можно отключить: ENABLE_ID_COMMAND="false"
    if (cmd === '/id' && c.env.ENABLE_ID_COMMAND !== 'false') {
      await sendMessage(c.env, msg.chat.id, `Твой ID: <code>${userId}</code>`);
      return c.text('ok');
    }

    // Чужим бот молчит
    if (!parseAllowedIds(c.env.ALLOWED_IDS).includes(userId)) return c.text('ok');

    if (cmd === '/start' || cmd === '/menu') {
      await sendMessage(c.env, msg.chat.id, WELCOME, openAppKeyboard(appUrl, '💅 Открыть ежедневник'));
    } else if (cmd === '/today' || cmd === '/tomorrow' || cmd === '/notify') {
      // «Сегодня» считаем в часовом поясе пользователя (как и cron), а не в глобальном TZ
      const u = await ensureUser(c.env.DB, userId, c.env.TZ);
      const { date } = nowInTz(u.tz);
      const target = cmd === '/today' ? date : addDays(date, 1);
      const items = await listAppointments(c.env.DB, userId, target, target);
      const note = await getDayNote(c.env.DB, userId, target);
      const body = formatDay(target, items, note);
      const out = cmd === '/notify' ? `🌙 <b>Расписание на завтра</b>\n\n${body}` : body;
      await sendMessage(c.env, msg.chat.id, out, openAppKeyboard(appUrl));
    }
  } catch (e) {
    console.error('webhook error', e);
  }
  return c.text('ok');
});
