// Обработка апдейтов Telegram (webhook). Команды: /start /menu /today /tomorrow /notify /id; для администратора ещё
// /admin /users /user /stats /health /export /records /backupall /send /broadcast (см. admin.ts);
// наблюдателю (VIEWER_IDS) доступны только /admin и /records
import { Hono } from 'hono';
import type { Env } from '../types';
import { isAllowedUser } from '../lib/access';
import { ensureUser, getDayNote, listAppointments } from '../db';
import { addDays, nowInTz } from '../lib/time';
import { formatDay } from '../lib/format';
import { openAppKeyboard, sendMessage } from './telegram';
import { handleAdminCommand, isAdmin, isAdminCommand, isViewer, isViewerCommand } from './admin';

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

const ADMIN_NOTE =
  `\n\n🛠 <b>Админ-панель:</b> кнопка 🛠 в шапке приложения. Там можно выбрать мастера и добавлять, менять и удалять его записи. Команды администратора: /admin`;

const ADMIN_WELCOME =
  `🛠 <b>Вы администратор.</b>\n\nОткройте приложение: кнопка 🛠 в шапке открывает админ-панель, где можно выбрать мастера и добавлять, менять и удалять его записи.\n\nКоманды администратора: /admin`;

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

    // Команды администратора (ADMIN_ID) и наблюдателей (VIEWER_IDS, только /admin и /records).
    // Всем остальным бот на них молчит, как и чужим.
    if (isAdminCommand(cmd)) {
      const role = isAdmin(c.env, userId) ? 'admin' : isViewer(c.env, userId) && isViewerCommand(cmd) ? 'viewer' : null;
      // аргументы — всё после команды (в том числе после суффикса «@бот»)
      if (role) await handleAdminCommand(c.env, msg.chat.id, userId, cmd, text.replace(/^\S+\s*/, ''), role);
      return c.text('ok');
    }

    // Чужим (и заблокированным) бот молчит. Администратор без доступа мастера получает только вход в приложение.
    const staff = isAdmin(c.env, userId);
    const allowed = await isAllowedUser(c.env, userId);
    if (!allowed && !staff) return c.text('ok');
    if (!allowed) {
      if (cmd === '/start' || cmd === '/menu') {
        await sendMessage(c.env, msg.chat.id, ADMIN_WELCOME, openAppKeyboard(appUrl, '🛠 Открыть приложение'));
      }
      return c.text('ok');
    }

    if (cmd === '/start' || cmd === '/menu') {
      await sendMessage(c.env, msg.chat.id, staff ? WELCOME + ADMIN_NOTE : WELCOME, openAppKeyboard(appUrl, '💅 Открыть ежедневник'));
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
