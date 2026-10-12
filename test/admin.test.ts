// Команды администратора (/admin /users /user /stats /health /export /backupall /send /broadcast):
// только для ADMIN_ID, остальным бот молчит.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { ADMIN_COMMANDS, isAdmin, isAdminCommand, isViewer, VIEWER_COMMANDS } from '../src/bot/admin';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, stubTelegram, type TgCall } from './helpers/harness';

let env: any;
let tg: TgCall[];
let closeDb: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  env = makeEnv(t.db, { WEBHOOK_SECRET: 'sec', ADMIN_ID: String(OWNER) });
  tg = stubTelegram();
  // у обоих пользователей есть по записи
  for (const [user, name] of [[OWNER, 'Админская клиентка'], [OTHER, 'Чужая клиентка']] as const) {
    const r = await api(env, user, 'POST', '/api/appointments', { date: '2026-10-14', start_time: '10:00', client_name: name, service: 'manicure', manicure_coating: 'gel' });
    expect(r.status).toBe(201);
  }
  tg.length = 0; // уведомления о создании записей не интересны
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

describe('isAdmin', () => {
  it('совпадение по ADMIN_ID; пустой или кривой ADMIN_ID = администратора нет', () => {
    expect(isAdmin({ ADMIN_ID: '5067848442' }, 5067848442)).toBe(true);
    expect(isAdmin({ ADMIN_ID: ' 5067848442 ' }, 5067848442)).toBe(true);
    expect(isAdmin({ ADMIN_ID: '5067848442' }, 1)).toBe(false);
    expect(isAdmin({}, 5067848442)).toBe(false);
    expect(isAdmin({ ADMIN_ID: '' }, 0)).toBe(false);
    expect(isAdmin({ ADMIN_ID: 'abc' }, 5067848442)).toBe(false);
  });
});

describe('/export', () => {
  it('админ получает в чат CSV и JSON выбранного пользователя (и только его данные)', async () => {
    expect((await hook(OWNER, `/export ${OTHER}`)).status).toBe(200);
    const docs = tg.filter((c) => c.method === 'sendDocument');
    expect(docs.map((d) => d.filename)).toEqual([`nail-planner-${OTHER}-2026-10-14.csv`, `nail-planner-backup-${OTHER}-2026-10-14.json`]);
    for (const d of docs) {
      expect(d.file).toContain('Чужая клиентка');
      expect(d.file).not.toContain('Админская клиентка');
    }
    expect(docs[0].caption).toContain(`пользователя ${OTHER}`);
  });

  it('работает и с суффиксом бота: /export@mybot ID', async () => {
    await hook(OWNER, `/export@mybot ${OTHER}`);
    expect(tg.filter((c) => c.method === 'sendDocument')).toHaveLength(2);
  });

  it('без ID присылает список пользователей', async () => {
    await hook(OWNER, '/export');
    expect(tg).toHaveLength(1);
    expect(tg[0].text).toContain(`<code>${OWNER}</code>: записей 1`);
    expect(tg[0].text).toContain(`<code>${OTHER}</code>: записей 1`);
  });

  it('неизвестный и некорректный ID: сообщение, файлов нет', async () => {
    await hook(OWNER, '/export 999999');
    await hook(OWNER, '/export abc');
    expect(tg.filter((c) => c.method === 'sendDocument')).toHaveLength(0);
    expect(tg[0].text).toContain('не найден');
    expect(tg[1].text).toContain('Некорректный ID');
  });

  it('не админ (даже мастер из ALLOWED_IDS) не получает ничего: бот молчит', async () => {
    expect((await hook(OTHER, `/export ${OWNER}`)).status).toBe(200);
    expect(tg).toHaveLength(0);
  });

  it('посторонний (не из ALLOWED_IDS) тоже получает тишину', async () => {
    await hook(333, `/export ${OWNER}`);
    expect(tg).toHaveLength(0);
  });

  it('без ADMIN_ID команда никому не доступна', async () => {
    env.ADMIN_ID = undefined;
    await hook(OWNER, `/export ${OTHER}`);
    expect(tg).toHaveLength(0);
  });
});

// ===== Остальные команды администратора =====

/** Подмена fetch с управляемыми ответами Telegram: reply(запрос) → тело ответа (по умолчанию ok). */
function stubTelegramWith(reply: (rec: any) => unknown): any[] {
  const sent: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init?: any) => {
      const rec: any = { method: String(url).split('/').pop() };
      const body = init?.body;
      if (body instanceof FormData) {
        const doc = body.get('document');
        if (doc && typeof doc !== 'string') { rec.filename = (doc as File).name; rec.file = await (doc as File).text(); }
        rec.caption = String(body.get('caption') ?? '');
      } else if (typeof body === 'string') {
        try { Object.assign(rec, JSON.parse(body)); } catch { /* не JSON */ }
      }
      sent.push(rec);
      return new Response(JSON.stringify(reply(rec) ?? { ok: true, result: { message_id: 1 } }));
    }),
  );
  return sent;
}

const messages = (calls: any[]) => calls.filter((c) => c.method === 'sendMessage');

describe('isAdminCommand', () => {
  it('знает все команды администратора и не принимает обычные', () => {
    for (const c of ADMIN_COMMANDS) expect(isAdminCommand(c)).toBe(true);
    for (const c of ['/start', '/today', '/id', '/notify', '/menu', '/users2', 'users']) expect(isAdminCommand(c)).toBe(false);
  });
});

describe('доступ к командам администратора', () => {
  const ALL = ['/admin', '/users', '/user 111', '/stats', '/health', '/backupall', '/send 111 привет', '/broadcast привет'];

  it('не админ (мастер из ALLOWED_IDS) и посторонний получают тишину, ничего не уходит', async () => {
    for (const text of ALL) {
      expect((await hook(OTHER, text)).status).toBe(200);
      expect((await hook(333, text)).status).toBe(200);
    }
    expect(tg).toHaveLength(0);
  });

  it('без ADMIN_ID никому не доступны', async () => {
    env.ADMIN_ID = undefined;
    for (const text of ALL) await hook(OWNER, text);
    expect(tg).toHaveLength(0);
  });
});

describe('/admin', () => {
  it('присылает список всех команд', async () => {
    await hook(OWNER, '/admin');
    expect(tg).toHaveLength(1);
    for (const c of ADMIN_COMMANDS.filter((x) => x !== '/admin')) expect(tg[0].text).toContain(c);
  });
});

describe('/users', () => {
  it('показывает доступ, записи и клиентов; отмечает чужих и тех, кто ещё не открывал бота', async () => {
    env.ALLOWED_IDS = `${OWNER},${OTHER},333`; // 333 есть в ALLOWED_IDS, но в базе его нет
    await env.DB.prepare('INSERT INTO users (user_id, tz, notify_time) VALUES (?,?,?)').bind(444, 'Europe/Chisinau', '22:00').run(); // в базе, но без доступа
    await hook(OWNER, '/users');
    expect(tg).toHaveLength(1);
    const t = tg[0].text!;
    expect(t).toContain(`✅ <code>${OWNER}</code> — записей 1 (впереди 1), клиентов 1, последняя запись 2026-10-14`);
    expect(t).toContain(`✅ <code>${OTHER}</code> — записей 1`);
    expect(t).toContain('⛔ <code>444</code> — записей 0');
    expect(t).toContain('ещё не открывали бота: <code>333</code>');
  });
});

describe('/user', () => {
  it('карточка: доступ, объёмы данных, доход за месяц и настройки', async () => {
    // состоявшаяся запись с ценой (сегодня 09:00, «сейчас» 12:00) и будущая
    expect((await api(env, OTHER, 'POST', '/api/appointments', { date: '2026-10-14', start_time: '08:00', client_name: 'Инна', service: 'fingers', price: 800 })).status).toBe(201);
    tg.length = 0;
    await hook(OWNER, `/user ${OTHER}`);
    expect(tg).toHaveLength(1);
    const t = tg[0].text!;
    expect(t).toContain(`<code>${OTHER}</code>`);
    expect(t).toContain('Доступ: ✅ есть');
    expect(t).toContain('Записей: 2 (впереди 2)');
    expect(t).toContain('Клиентов: 2');
    expect(t).toContain('Доход за 2026-10: 800');
    expect(t).toContain('Вечернее напоминание: вкл, 22:00');
    expect(t).toContain('Рабочие дни: Пн, Вт, Ср, Чт, Пт, Сб, 09:00–20:00');
    expect(t).toContain('Еженедельная копия: вкл');
  });

  it('без ID, с кривым и неизвестным ID — подсказка или «не найден»', async () => {
    await hook(OWNER, '/user');
    await hook(OWNER, '/user abc');
    await hook(OWNER, '/user 999999');
    expect(tg[0].text).toContain('Использование');
    expect(tg[1].text).toContain('Некорректный ID');
    expect(tg[2].text).toContain('не найден');
  });
});

describe('/stats', () => {
  it('сводка по всей базе', async () => {
    await hook(OWNER, '/stats');
    expect(tg).toHaveLength(1);
    const t = tg[0].text!;
    expect(t).toContain('на 2026-10-14');
    expect(t).toContain('Пользователей в базе: 2 (с доступом: 2)');
    expect(t).toContain('Записей всего: 2');
    expect(t).toContain('сегодня: 2, завтра: 0, впереди всего: 2');
    expect(t).toContain('Клиентов: 2');
    expect(t).toContain('Сообщений в очереди на удаление:');
  });
});

describe('/health', () => {
  it('всё в порядке: база, бот, webhook с ошибкой доставки и конфигурация без секретов', async () => {
    const calls = stubTelegramWith((r) => {
      if (r.method === 'getMe') return { ok: true, result: { username: 'nail_bot' } };
      if (r.method === 'getWebhookInfo') {
        return { ok: true, result: { url: 'https://app.test/webhook', pending_update_count: 3, last_error_message: 'Connection <timed out>', last_error_date: 1760000000 } };
      }
    });
    await hook(OWNER, '/health');
    const out = messages(calls);
    expect(out).toHaveLength(1);
    const t: string = out[0].text;
    expect(t).toMatch(/✅ База: отвечает за \d+ мс, миграций \d+, последняя 00\d\d_/);
    expect(t).toContain('✅ Бот: @nail_bot');
    expect(t).toContain('⚠️ Webhook: установлен, ожидает апдейтов: 3');
    expect(t).toContain('Connection &lt;timed out&gt;');
    expect(t).toContain('ALLOWED_IDS: 2');
    expect(t).not.toContain('123456:TEST-TOKEN'); // токен бота нигде не показывается
    expect(t).not.toContain('app.test/webhook');
  });

  it('проблемы: токен не принят, webhook не установлен', async () => {
    const calls = stubTelegramWith((r) => {
      if (r.method === 'getMe') return { ok: false, error_code: 401, description: 'Unauthorized' };
      if (r.method === 'getWebhookInfo') return { ok: true, result: { url: '', pending_update_count: 0 } };
    });
    await hook(OWNER, '/health');
    const t: string = messages(calls)[0].text;
    expect(t).toContain('❌ Бот: Unauthorized');
    expect(t).toContain('❌ Webhook: не установлен');
  });

  it('база недоступна: сообщение об ошибке, остальные проверки всё равно выполняются', async () => {
    const calls = stubTelegramWith(() => undefined);
    env.DB = { prepare: () => { throw new Error('db down'); } };
    await hook(OWNER, '/health');
    const t: string = messages(calls)[0].text;
    expect(t).toContain('❌ База: Error: db down');
    expect(t).toContain('Бот:');
  });
});

describe('/backupall', () => {
  it('присылает JSON-копию каждого пользователя, и только его данные', async () => {
    await hook(OWNER, '/backupall');
    const docs = tg.filter((c) => c.method === 'sendDocument');
    expect(docs.map((d) => d.filename)).toEqual([`nail-planner-backup-${OWNER}-2026-10-14.json`, `nail-planner-backup-${OTHER}-2026-10-14.json`]);
    expect(docs[0].file).toContain('Админская клиентка');
    expect(docs[0].file).not.toContain('Чужая клиентка');
    expect(docs[1].file).toContain('Чужая клиентка');
    expect(docs[1].file).not.toContain('Админская клиентка');
    expect(tg[tg.length - 1].text).toContain('Копий отправлено: 2 из 2');
  });

  it('если Telegram не принял файл — в итоге указан ID', async () => {
    const calls = stubTelegramWith((r) => (r.method === 'sendDocument' && r.filename?.includes(`-${OTHER}-`) ? { ok: false, error_code: 500, description: 'oops' } : undefined));
    await hook(OWNER, '/backupall');
    const t: string = messages(calls)[0].text;
    expect(t).toContain('Копий отправлено: 1 из 2');
    expect(t).toContain(`Не удалось: <code>${OTHER}</code>`);
  });
});

describe('/send', () => {
  it('доставляет текст пользователю (HTML экранируется) и подтверждает администратору', async () => {
    await hook(OWNER, `/send ${OTHER} Привет, <b>мастер</b>!\nЗавтра обновление.`);
    expect(tg).toHaveLength(2);
    expect(tg[0]).toMatchObject({ chat_id: OTHER });
    expect(tg[0].text).toContain('Сообщение от администратора');
    expect(tg[0].text).toContain('Привет, &lt;b&gt;мастер&lt;/b&gt;!\nЗавтра обновление.');
    expect(tg[1]).toMatchObject({ chat_id: OWNER });
    expect(tg[1].text).toContain(`✅ Доставлено пользователю <code>${OTHER}</code>`);
  });

  it('работает с суффиксом бота и для пользователя из ALLOWED_IDS, которого ещё нет в базе', async () => {
    env.ALLOWED_IDS = `${OWNER},${OTHER},333`;
    await hook(OWNER, '/send@mybot 333 hi');
    expect(tg[0]).toMatchObject({ chat_id: 333 });
  });

  it('бот заблокирован пользователем (403) и прочие сбои — понятный отчёт', async () => {
    let calls = stubTelegramWith((r) => (r.chat_id === OTHER ? { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } : undefined));
    await hook(OWNER, `/send ${OTHER} hi`);
    expect(messages(calls)[1].text).toContain('заблокировал бота');
    calls = stubTelegramWith((r) => (r.chat_id === OTHER ? { ok: false, error_code: 500, description: 'oops' } : undefined));
    await hook(OWNER, `/send ${OTHER} hi`);
    expect(messages(calls)[1].text).toContain('Не удалось отправить');
  });

  it('неправильное использование: сообщения нет ни у кого, кроме подсказки администратору', async () => {
    await hook(OWNER, '/send');
    await hook(OWNER, `/send ${OTHER}`);
    await hook(OWNER, '/send abc привет');
    await hook(OWNER, '/send 999999 привет');
    await hook(OWNER, `/send ${OTHER} ${'я'.repeat(3501)}`);
    expect(tg.map((c) => (c as any).chat_id)).toEqual([OWNER, OWNER, OWNER, OWNER, OWNER]);
    expect(tg[0].text).toContain('Использование');
    expect(tg[1].text).toContain('Использование');
    expect(tg[2].text).toContain('Некорректный ID');
    expect(tg[3].text).toContain('не найден');
    expect(tg[4].text).toContain('Слишком длинный текст');
  });
});

describe('/broadcast', () => {
  it('рассылает всем из ALLOWED_IDS и присылает итог', async () => {
    await hook(OWNER, '/broadcast Завтра в 10:00 обновление <приложения>');
    const sent = messages(tg);
    expect(sent.map((c: any) => c.chat_id)).toEqual([OWNER, OTHER, OWNER]);
    expect(sent[1].text).toContain('Сообщение от администратора');
    expect(sent[1].text).toContain('обновление &lt;приложения&gt;');
    expect(sent[2].text).toContain('Рассылка: доставлено 2 из 2');
  });

  it('в итоге перечислены заблокировавшие бота и те, кому не удалось отправить', async () => {
    env.ALLOWED_IDS = `${OWNER},${OTHER},333`;
    const calls = stubTelegramWith((r) => {
      if (r.chat_id === OTHER) return { ok: false, error_code: 403, description: 'blocked' };
      if (r.chat_id === 333) return { ok: false, error_code: 500, description: 'oops' };
    });
    await hook(OWNER, '/broadcast привет');
    const report: string = messages(calls).at(-1).text;
    expect(report).toContain('доставлено 1 из 3');
    expect(report).toContain(`⛔ Заблокировали бота: <code>${OTHER}</code>`);
    expect(report).toContain('❌ Не удалось: <code>333</code>');
  });

  it('без текста и со слишком длинным текстом никому ничего не уходит', async () => {
    await hook(OWNER, '/broadcast');
    await hook(OWNER, `/broadcast ${'я'.repeat(3501)}`);
    expect(tg.map((c) => (c as any).chat_id)).toEqual([OWNER, OWNER]);
    expect(tg[0].text).toContain('Использование');
    expect(tg[1].text).toContain('Слишком длинный текст');
  });

  it('пустой ALLOWED_IDS: рассылать некому', async () => {
    env.ALLOWED_IDS = '';
    await hook(OWNER, '/broadcast привет');
    expect(tg).toHaveLength(1);
    expect(tg[0].text).toContain('рассылать некому');
  });
});

// ===== Наблюдатель (VIEWER_IDS): только смотреть записи =====

const VIEWER = 777;

describe('isViewer', () => {
  it('список через запятую; пустой или отсутствующий — наблюдателей нет', () => {
    expect(isViewer({ VIEWER_IDS: '352999678' }, 352999678)).toBe(true);
    expect(isViewer({ VIEWER_IDS: '1, 352999678 ,3' }, 352999678)).toBe(true);
    expect(isViewer({ VIEWER_IDS: '352999678' }, 5067848442)).toBe(false);
    expect(isViewer({ VIEWER_IDS: '' }, 0)).toBe(false);
    expect(isViewer({}, 352999678)).toBe(false);
  });
  it('наблюдателю доступны только /admin и /records', () => {
    expect([...VIEWER_COMMANDS]).toEqual(['/admin', '/records']);
  });
});

describe('/records', () => {
  beforeEach(() => {
    env.VIEWER_IDS = String(VIEWER); // наблюдателя нет ни в ALLOWED_IDS, ни в базе
  });

  it('наблюдатель получает один CSV со всеми записями всех мастеров (со столбцом «мастер»)', async () => {
    await hook(VIEWER, '/records');
    const docs = tg.filter((c) => c.method === 'sendDocument');
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe('nail-planner-all-2026-10-14.csv');
    // BOM в сам файл пишется (buildCsv), но File.text() при чтении его отбрасывает, поэтому проверяем начало без него
    expect(docs[0].file!.startsWith('мастер (ID);дата;')).toBe(true);
    expect(docs[0].file).toContain(`${OWNER};2026-10-14;10:00;`);
    expect(docs[0].file).toContain('Админская клиентка');
    expect(docs[0].file).toContain(`${OTHER};2026-10-14;10:00;`);
    expect(docs[0].file).toContain('Чужая клиентка');
    expect(docs[0].caption).toContain('Все записи за всё время (2026-10-14): 2, мастеров: 2');
  });

  it('/records ID — только записи этого мастера, без столбца «мастер»', async () => {
    await hook(VIEWER, `/records ${OTHER}`);
    const docs = tg.filter((c) => c.method === 'sendDocument');
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe(`nail-planner-${OTHER}-2026-10-14.csv`);
    expect(docs[0].file).toContain('Чужая клиентка');
    expect(docs[0].file).not.toContain('Админская клиентка');
    expect(docs[0].file).not.toContain('мастер (ID)');
  });

  it('кривой и неизвестный ID — сообщение, файла нет; суффикс бота работает', async () => {
    await hook(VIEWER, '/records abc');
    await hook(VIEWER, '/records 999999');
    expect(tg.filter((c) => c.method === 'sendDocument')).toHaveLength(0);
    expect(tg[0].text).toContain('Некорректный ID');
    expect(tg[1].text).toContain('не найден');
    tg.length = 0;
    await hook(VIEWER, '/records@mybot');
    expect(tg.filter((c) => c.method === 'sendDocument')).toHaveLength(1);
  });

  it('записей нет вообще — сообщение вместо пустого файла', async () => {
    await env.DB.prepare('DELETE FROM appointments').run();
    await hook(VIEWER, '/records');
    expect(tg).toHaveLength(1);
    expect(tg[0].text).toContain('Записей пока нет');
  });

  it('администратору /records тоже доступен', async () => {
    await hook(OWNER, '/records');
    expect(tg.filter((c) => c.method === 'sendDocument')).toHaveLength(1);
  });

  it('/admin у наблюдателя показывает только его команды', async () => {
    await hook(VIEWER, '/admin');
    expect(tg).toHaveLength(1);
    expect(tg[0].text).toContain('/records');
    for (const c of ['/broadcast', '/send', '/backupall', '/export', '/users']) expect(tg[0].text).not.toContain(c);
  });

  it('все остальные команды администратора наблюдателю недоступны: бот молчит', async () => {
    for (const text of ['/users', '/user 111', '/stats', '/health', '/export', `/export ${OTHER}`, '/backupall', '/send 111 привет', '/broadcast привет']) {
      expect((await hook(VIEWER, text)).status).toBe(200);
    }
    expect(tg).toHaveLength(0);
  });

  it('не наблюдатель и не админ (мастер, посторонний) /records не получает; без VIEWER_IDS наблюдателя нет', async () => {
    await hook(OTHER, '/records');
    await hook(333, '/records');
    env.VIEWER_IDS = undefined;
    await hook(VIEWER, '/records');
    expect(tg).toHaveLength(0);
  });

  it('наблюдатель ничего не меняет: количество записей до и после одинаково', async () => {
    const count = async () => Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n);
    const before = await count();
    for (const text of ['/records', `/records ${OTHER}`, '/broadcast привет', '/send 111 привет']) await hook(VIEWER, text);
    expect(await count()).toBe(before);
  });
});
