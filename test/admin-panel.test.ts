// Админ-панель Mini App (правка записей за мастера, X-Act-As) и управление доступом (/adduser /ban /unban).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { actAsAllowed, parseInitDataUser } from '../src/auth';
import { isAdmin } from '../src/bot/admin';
import { accessState, getAllowedIds, parseIdList } from '../src/lib/access';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, signInitData, stubTelegram, type TgCall } from './helpers/harness';

const ADMIN2 = 999; // второй администратор: не мастер, в ALLOWED_IDS его нет
const STRANGER = 333;

let env: any;
let tg: TgCall[];
let closeDb: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  env = makeEnv(t.db, { WEBHOOK_SECRET: 'sec', ADMIN_ID: `${OWNER},${ADMIN2}` });
  tg = stubTelegram();
  for (const [user, name] of [[OWNER, 'Админская клиентка'], [OTHER, 'Чужая клиентка']] as const) {
    const r = await api(env, user, 'POST', '/api/appointments', { date: '2026-10-14', start_time: '10:00', client_name: name, service: 'manicure', manicure_coating: 'gel' });
    expect(r.status).toBe(201);
  }
  tg.length = 0;
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Запрос от имени actor; actAs — заголовок X-Act-As (правка за мастера). */
async function apiAs(actor: number, actAs: number | string | null, method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { 'X-Init-Data': await signInitData(actor) };
  if (actAs !== null) headers['X-Act-As'] = String(actAs);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(
    new Request('https://app.test' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    undefined as any,
  );
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, json };
}

const hook = (from: number, text: string) =>
  worker.fetch(
    new Request('https://app.test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
      body: JSON.stringify({ update_id: 1, message: { message_id: 1, from: { id: from }, chat: { id: from }, text } }),
    }),
    env,
    undefined as any,
  );

const messages = () => tg.filter((c) => c.method === 'sendMessage') as any[];
const list = (user: number, date = '2026-10-14') => api(env, user, 'GET', `/api/appointments?from=${date}&to=${date}`);
const NEW_APPT = { date: '2026-10-15', start_time: '10:00', client_name: 'Новая клиентка', service: 'manicure', manicure_coating: 'gel' };

describe('чистые функции', () => {
  it('isAdmin: несколько ID через запятую, пробелы, мусор', () => {
    expect(isAdmin({ ADMIN_ID: '5067848442,352999678' }, 352999678)).toBe(true);
    expect(isAdmin({ ADMIN_ID: ' 5067848442 , 352999678 ' }, 5067848442)).toBe(true);
    expect(isAdmin({ ADMIN_ID: '5067848442,352999678' }, 1)).toBe(false);
    expect(isAdmin({ ADMIN_ID: 'abc,,-5,0' }, 5)).toBe(false);
    expect(isAdmin({}, 352999678)).toBe(false);
  });

  it('parseIdList', () => {
    expect(parseIdList('1, 2,abc,-3,0, 4')).toEqual([1, 2, 4]);
    expect(parseIdList(undefined)).toEqual([]);
  });

  it('accessState: блокировка сильнее и секрета, и /adduser', () => {
    expect(accessState(true, null)).toBe('allowed');
    expect(accessState(false, { added: 1, banned: 0 })).toBe('allowed');
    expect(accessState(false, null)).toBe('none');
    expect(accessState(true, { added: 0, banned: 1 })).toBe('banned');
    expect(accessState(false, { added: 1, banned: 1 })).toBe('banned');
  });

  it('actAsAllowed: все действия с записями; из остального только чтение нужного для формы', () => {
    for (const m of ['GET', 'POST', 'PUT', 'DELETE']) expect(actAsAllowed(m, '/api/appointments')).toBe(true);
    expect(actAsAllowed('POST', '/api/appointments/check')).toBe(true);
    expect(actAsAllowed('DELETE', '/api/appointments/5')).toBe(true);
    for (const p of ['/api/days', '/api/days/slots', '/api/search', '/api/clients', '/api/clients/3', '/api/prices', '/api/settings', '/api/notes/2026-10-14']) {
      expect(actAsAllowed('GET', p)).toBe(true);
      expect(actAsAllowed('PUT', p)).toBe(false);
      expect(actAsAllowed('POST', p)).toBe(false);
      expect(actAsAllowed('DELETE', p)).toBe(false);
    }
    for (const p of ['/api/stats', '/api/expenses', '/api/export/csv', '/api/import', '/api/admin/masters', '/api/me', '/api/appointmentsX']) {
      expect(actAsAllowed('GET', p)).toBe(false);
    }
  });

  it('parseInitDataUser: имя и @username из подписанных данных', () => {
    const q = (user: unknown) => new URLSearchParams({ user: JSON.stringify(user) }).toString();
    expect(parseInitDataUser(q({ id: 5, first_name: 'Анна', last_name: 'К', username: 'anna' }))).toEqual({ id: 5, name: 'Анна К', username: 'anna' });
    expect(parseInitDataUser(q({ id: 5 }))).toEqual({ id: 5, name: '', username: null });
    expect(parseInitDataUser(q({ first_name: 'x' }))).toBeNull();
    expect(parseInitDataUser('user=not-json')).toBeNull();
    expect(parseInitDataUser('')).toBeNull();
  });
});

describe('/api/me и список мастеров', () => {
  it('администратор без доступа мастера входит в API; мастер и посторонний — нет админ-прав', async () => {
    expect((await apiAs(ADMIN2, null, 'GET', '/api/me')).json).toEqual({ user_id: ADMIN2, is_admin: true });
    expect((await apiAs(OTHER, null, 'GET', '/api/me')).json).toEqual({ user_id: OTHER, is_admin: false });
    expect((await apiAs(STRANGER, null, 'GET', '/api/me')).status).toBe(403);
    expect((await api(env, null, 'GET', '/api/me')).status).toBe(403);
  });

  it('/api/admin/masters: только администраторам; мастера с числом записей', async () => {
    expect((await apiAs(OTHER, null, 'GET', '/api/admin/masters')).status).toBe(403);
    expect((await apiAs(STRANGER, null, 'GET', '/api/admin/masters')).status).toBe(403);
    const r = await apiAs(ADMIN2, null, 'GET', '/api/admin/masters');
    expect(r.status).toBe(200);
    expect(r.json.masters.map((m: any) => m.user_id)).toEqual([OWNER, OTHER]); // сам ADMIN2 мастером не считается
    expect(r.json.masters[0]).toMatchObject({ appointments: 1, upcoming: 1, has_access: true, banned: false, name: null });
  });

  it('имя мастера запоминается при открытии приложения и появляется в списке', async () => {
    await apiAs(OTHER, null, 'GET', '/api/me'); // в подписанных данных тестов first_name = «Test»
    const r = await apiAs(ADMIN2, null, 'GET', '/api/admin/masters');
    expect(r.json.masters.find((m: any) => m.user_id === OTHER).name).toBe('Test');
    expect(r.json.masters.find((m: any) => m.user_id === OWNER).name).toBeNull();
  });

  it('открытие приложения администратором не создаёт ему запись мастера', async () => {
    await apiAs(ADMIN2, null, 'GET', '/api/me');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE user_id = ?').bind(ADMIN2).first();
    expect(Number(n.n)).toBe(0);
  });

  it('мастер из ALLOWED_IDS, который ещё не открывал бота, тоже в списке', async () => {
    env.ALLOWED_IDS = `${OWNER},${OTHER},444`;
    const r = await apiAs(ADMIN2, null, 'GET', '/api/admin/masters');
    expect(r.json.masters.find((m: any) => m.user_id === 444)).toMatchObject({ appointments: 0, has_access: true });
  });
});

describe('правка записей за мастера (X-Act-As)', () => {
  it('админ добавляет запись мастеру: она у мастера, у других нет; мастер получает уведомление', async () => {
    const r = await apiAs(ADMIN2, OTHER, 'POST', '/api/appointments', NEW_APPT);
    expect(r.status).toBe(201);
    const mine = await list(OTHER, '2026-10-15');
    expect(mine.json.map((a: any) => a.client_name)).toEqual(['Новая клиентка']);
    expect((await list(OWNER, '2026-10-15')).json).toHaveLength(0);
    expect((await list(ADMIN2, '2026-10-15')).json).toHaveLength(0); // у самого админа ничего не появилось
    expect(messages().some((m) => m.chat_id === OTHER && String(m.text).includes('Новая запись'))).toBe(true);
  });

  it('админ меняет и переносит запись мастера', async () => {
    const [a] = (await list(OTHER)).json;
    const r = await apiAs(ADMIN2, OTHER, 'PUT', `/api/appointments/${a.id}`, { ...NEW_APPT, date: '2026-10-16', price: 900 });
    expect(r.status).toBe(200);
    expect((await list(OTHER)).json).toHaveLength(0);
    expect((await list(OTHER, '2026-10-16')).json[0]).toMatchObject({ id: a.id, price: 900, client_name: 'Новая клиентка' });
  });

  it('админ удаляет запись мастера; чужую (другого мастера) по ID не удалить', async () => {
    const [mine] = (await list(OTHER)).json;
    const [foreign] = (await list(OWNER)).json;
    expect((await apiAs(ADMIN2, OTHER, 'DELETE', `/api/appointments/${foreign.id}`)).json).toEqual({ ok: false });
    expect((await list(OWNER)).json).toHaveLength(1);
    expect((await apiAs(ADMIN2, OTHER, 'DELETE', `/api/appointments/${mine.id}`)).json).toEqual({ ok: true });
    expect((await list(OTHER)).json).toHaveLength(0);
  });

  it('админ видит только записи выбранного мастера', async () => {
    const r = await apiAs(ADMIN2, OTHER, 'GET', '/api/appointments?from=2026-10-14&to=2026-10-14');
    expect(r.json.map((a: any) => a.client_name)).toEqual(['Чужая клиентка']);
  });

  it('действия администратора пишутся в журнал; чтение — нет', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await apiAs(ADMIN2, OTHER, 'POST', '/api/appointments', NEW_APPT);
    expect(log).toHaveBeenCalledWith(`admin-act actor=${ADMIN2} target=${OTHER} POST /api/appointments status=201`);
    log.mockClear();
    await apiAs(ADMIN2, OTHER, 'GET', '/api/appointments?from=2026-10-14&to=2026-10-14');
    expect(log).not.toHaveBeenCalled();
  });

  it('работает и для администратора, который сам мастер (OWNER правит записи OTHER)', async () => {
    expect((await apiAs(OWNER, OTHER, 'POST', '/api/appointments', NEW_APPT)).status).toBe(201);
    expect((await list(OTHER, '2026-10-15')).json).toHaveLength(1);
    expect((await list(OWNER, '2026-10-15')).json).toHaveLength(0);
  });

  it('читать можно то, что нужно форме записи и расписанию', async () => {
    for (const url of [
      '/api/days?from=2026-10-12&to=2026-10-18',
      '/api/days/slots?date=2026-10-14',
      '/api/clients',
      '/api/prices',
      '/api/settings',
      '/api/notes/2026-10-14',
      '/api/search?q=' + encodeURIComponent('Чужая'),
    ]) {
      expect((await apiAs(ADMIN2, OTHER, 'GET', url)).status, url).toBe(200);
    }
  });

  it('всё остальное закрыто: доходы, траты, клиенты, настройки, заметки, импорт, экспорт, сама админка', async () => {
    const blocked: Array<[string, string, unknown?]> = [
      ['GET', '/api/stats?period=week'],
      ['GET', '/api/expenses?from=2026-10-01&to=2026-10-31'],
      ['DELETE', '/api/expenses/1'],
      ['POST', '/api/clients', { name: 'Х' }],
      ['PUT', '/api/settings', { notify_time: '21:00' }],
      ['PUT', '/api/prices', { manicure: 1 }],
      ['PUT', '/api/notes/2026-10-14', { text: 'x' }],
      ['POST', '/api/import', {}],
      ['GET', '/api/export/csv'],
      ['GET', '/api/admin/masters'],
      ['GET', '/api/me'],
    ];
    for (const [method, url, body] of blocked) {
      const r = await apiAs(ADMIN2, OTHER, method, url, body);
      expect(r.status, `${method} ${url}`).toBe(400); // не 403: приложение на 403 пишет «сессия устарела»
      expect(r.json.error).toContain('недоступна');
    }
    expect((await list(OTHER)).json).toHaveLength(1); // ничего не изменилось
  });

  it('не администратор с заголовком X-Act-As получает 403 и ничего не меняет', async () => {
    expect((await apiAs(OTHER, OWNER, 'POST', '/api/appointments', NEW_APPT)).status).toBe(403);
    expect((await apiAs(OTHER, OWNER, 'GET', '/api/appointments?from=2026-10-14&to=2026-10-14')).status).toBe(403);
    expect((await apiAs(STRANGER, OWNER, 'GET', '/api/appointments?from=2026-10-14&to=2026-10-14')).status).toBe(403);
    expect((await list(OWNER, '2026-10-15')).json).toHaveLength(0);
  });

  it('кривой и неизвестный мастер', async () => {
    expect((await apiAs(ADMIN2, 'abc', 'GET', '/api/appointments?from=2026-10-14&to=2026-10-14')).status).toBe(400);
    expect((await apiAs(ADMIN2, '-5', 'GET', '/api/appointments?from=2026-10-14&to=2026-10-14')).status).toBe(400);
    const r = await apiAs(ADMIN2, 424242, 'POST', '/api/appointments', NEW_APPT);
    expect(r.status).toBe(404);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM appointments WHERE user_id = ?').bind(424242).first();
    expect(Number(n.n)).toBe(0);
  });

  it('валидация записи работает как обычно (пустое имя — 400)', async () => {
    const r = await apiAs(ADMIN2, OTHER, 'POST', '/api/appointments', { ...NEW_APPT, client_name: '  ' });
    expect(r.status).toBe(400);
  });
});

describe('вход и бот для администратора', () => {
  it('/start администратору без доступа мастера: приветствие админа с кнопкой приложения; остальные команды молчат', async () => {
    await hook(ADMIN2, '/start');
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ chat_id: ADMIN2 });
    expect(messages()[0].text).toContain('Вы администратор');
    expect(messages()[0].reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://app.test/');
    tg.length = 0;
    await hook(ADMIN2, '/today');
    await hook(ADMIN2, '/notify');
    expect(tg).toHaveLength(0);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE user_id = ?').bind(ADMIN2).first();
    expect(Number(n.n)).toBe(0); // /today не создал админу запись пользователя
  });

  it('админ, который и мастер, видит обычное приветствие с подсказкой про админ-панель; обычный мастер — без неё', async () => {
    await hook(OWNER, '/start');
    await hook(OTHER, '/start');
    expect(messages()[0].text).toContain('Админ-панель');
    expect(messages()[1].text).not.toContain('Админ-панель');
  });

  it('посторонний по-прежнему получает тишину', async () => {
    await hook(STRANGER, '/start');
    await hook(STRANGER, '/today');
    expect(tg).toHaveLength(0);
  });
});

describe('/adduser, /ban, /unban', () => {
  it('/adduser: доступ к API и боту, пользователь получает сообщение, администратор — подтверждение', async () => {
    expect((await apiAs(555, null, 'GET', '/api/settings')).status).toBe(403);
    await hook(OWNER, '/adduser 555');
    expect(messages().map((m) => m.chat_id)).toEqual([555, OWNER]);
    expect(messages()[0].text).toContain('открыт доступ');
    expect(messages()[1].text).toContain(`Доступ выдан: <code>555</code>`);
    expect((await apiAs(555, null, 'GET', '/api/settings')).status).toBe(200);
    tg.length = 0;
    await hook(555, '/start');
    expect(messages()[0]).toMatchObject({ chat_id: 555 });
    expect(await getAllowedIds(env)).toEqual([OWNER, OTHER, 555]);
  });

  it('/adduser: повторно — «уже есть»; пользователь не писал боту — подсказка администратору', async () => {
    await hook(OWNER, `/adduser ${OTHER}`);
    expect(messages()[0].text).toContain('доступ уже есть');
    tg.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init?: any) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const ok = body.chat_id !== 555;
      return new Response(JSON.stringify(ok ? { ok: true, result: { message_id: 1 } } : { ok: false, error_code: 403, description: 'Forbidden' }));
    }));
    await hook(OWNER, '/adduser 555');
    expect((await apiAs(555, null, 'GET', '/api/settings')).status).toBe(200); // доступ выдан, даже если сообщение не дошло
  });

  it('/ban: доступ закрыт везде, данные на месте; /unban возвращает', async () => {
    await hook(OWNER, `/ban ${OTHER}`);
    expect(messages()[0].text).toContain('Доступ закрыт');
    tg.length = 0;
    expect((await apiAs(OTHER, null, 'GET', '/api/settings')).status).toBe(403);
    await hook(OTHER, '/today');
    expect(tg).toHaveLength(0);
    expect(await getAllowedIds(env)).toEqual([OWNER]);
    const kept = await env.DB.prepare('SELECT COUNT(*) AS n FROM appointments WHERE user_id = ?').bind(OTHER).first();
    expect(Number(kept.n)).toBe(1);

    await hook(OWNER, `/unban ${OTHER}`);
    expect(messages()[0].text).toContain('Доступ вернулся');
    expect((await apiAs(OTHER, null, 'GET', '/api/settings')).status).toBe(200);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM access').first();
    expect(Number(rows.n)).toBe(0); // пустая строка access не остаётся
  });

  it('заблокированный отмечен в /users и в списке мастеров, не получает рассылку', async () => {
    await hook(OWNER, `/ban ${OTHER}`);
    tg.length = 0;
    await hook(OWNER, '/users');
    expect(messages()[0].text).toContain(`🚫 <code>${OTHER}</code>`);
    tg.length = 0;
    const masters = (await apiAs(ADMIN2, null, 'GET', '/api/admin/masters')).json.masters;
    expect(masters.find((m: any) => m.user_id === OTHER)).toMatchObject({ banned: true, has_access: false });
    await hook(OWNER, '/broadcast привет');
    expect(messages().map((m) => m.chat_id)).toEqual([OWNER, OWNER]);
    expect(messages()[1].text).toContain('доставлено 1 из 1');
  });

  it('/adduser заблокированному: сначала /unban; /unban тому, кого нет в секрете и не выдавали доступ — доступа нет', async () => {
    await hook(OWNER, '/ban 777');
    await hook(OWNER, '/adduser 777');
    expect(messages()[1].text).toContain('заблокирован');
    tg.length = 0;
    await hook(OWNER, '/unban 777');
    expect(messages()[0].text).toContain('Доступа по-прежнему нет');
    expect(await getAllowedIds(env)).not.toContain(777);
  });

  it('/adduser выдан, затем /ban и /unban: доступ возвращается без повторной выдачи', async () => {
    await hook(OWNER, '/adduser 555');
    await hook(OWNER, '/ban 555');
    expect((await apiAs(555, null, 'GET', '/api/settings')).status).toBe(403);
    await hook(OWNER, '/unban 555');
    expect((await apiAs(555, null, 'GET', '/api/settings')).status).toBe(200);
  });

  it('администратора заблокировать нельзя', async () => {
    await hook(OWNER, `/ban ${ADMIN2}`);
    await hook(OWNER, `/ban ${OWNER}`);
    expect(messages().every((m) => String(m.text).includes('Администратора заблокировать нельзя'))).toBe(true);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM access').first();
    expect(Number(rows.n)).toBe(0);
  });

  it('«не заблокирован», без ID и с кривым ID', async () => {
    await hook(OWNER, `/unban ${OTHER}`);
    await hook(OWNER, '/ban');
    await hook(OWNER, '/adduser abc');
    expect(messages()[0].text).toContain('не заблокирован');
    expect(messages()[1].text).toContain('Использование');
    expect(messages()[2].text).toContain('Некорректный ID');
  });

  it('вторая администраторша тоже управляет доступом', async () => {
    await hook(ADMIN2, '/adduser 555');
    expect((await apiAs(555, null, 'GET', '/api/settings')).status).toBe(200);
  });

  it('мастер и посторонний этих команд не выполняют: бот молчит, доступ не меняется', async () => {
    for (const from of [OTHER, STRANGER]) {
      for (const text of ['/adduser 555', `/ban ${OWNER}`, `/unban ${OWNER}`]) await hook(from, text);
    }
    expect(tg).toHaveLength(0);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM access').first();
    expect(Number(rows.n)).toBe(0);
  });

  it('/admin показывает новые команды и подсказку про админ-панель', async () => {
    await hook(OWNER, '/admin');
    for (const c of ['/adduser', '/ban', '/unban', 'Записи мастеров правятся в приложении']) expect(messages()[0].text).toContain(c);
  });

  it('сбой чтения таблицы access (нет миграции): работаем по ALLOWED_IDS, никого не отрезает', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await env.DB.prepare('DROP TABLE access').run();
    expect((await apiAs(OTHER, null, 'GET', '/api/settings')).status).toBe(200); // OTHER не админ: доступ идёт по ALLOWED_IDS
    expect((await apiAs(STRANGER, null, 'GET', '/api/settings')).status).toBe(403);
    expect(await getAllowedIds(env)).toEqual([OWNER, OTHER]);
  });
});
