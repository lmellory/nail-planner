// Команда администратора /export: только для ADMIN_ID, остальным бот молчит.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { isAdmin } from '../src/bot/admin';
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
