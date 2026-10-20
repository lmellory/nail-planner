import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanBirthday } from '../src/lib/clients';
import { runBirthdayNotifications } from '../src/cron';
import { api, createTestDb, makeEnv, NOW, OWNER, OTHER, stubTelegram } from './helpers/harness';

let t: Awaited<ReturnType<typeof createTestDb>>;
let env: ReturnType<typeof makeEnv>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  t = await createTestDb();
  env = makeEnv(t.db);
  stubTelegram();
});
afterEach(() => { t.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const add = (user = OWNER, changes = {}) => api(env, user, 'POST', '/api/appointments', {
  date: '2026-10-14', start_time: '10:00', service: 'fingers', client_name: 'Анна', price: 900, comment: 'Сохранить', ...changes,
});
const appointments = async (user = OWNER) => (await api(env, user, 'GET', '/api/appointments?from=2026-01-01&to=2026-12-31')).json;
const clients = async () => (await api(env, OWNER, 'GET', '/api/clients')).json;

it('переименование сохраняет ID, поля и историю записей и не меняет другого мастера', async () => {
  await add(); await add(OTHER);
  await add(OWNER, { start_time: '14:00', status: 'cancelled' });
  const before = await appointments();
  const other = await appointments(OTHER);
  const client = (await clients())[0];
  expect((await api(env, OWNER, 'PUT', `/api/clients/${client.id}`, { name: 'Анна Новая' })).status).toBe(200);
  const renamed = await appointments();
  expect(renamed.map(({ updated_at, ...a }: any) => a)).toEqual(before.map(({ updated_at, ...a }: any) => ({ ...a, client_name: 'Анна Новая' })));
  expect(await appointments(OTHER)).toEqual(other);
  const detail = (await api(env, OWNER, 'GET', `/api/clients/${client.id}`)).json;
  expect(detail.history).toHaveLength(2);
  expect(detail.client.id).toBe(client.id);
});

it('конфликт имён не объединяет клиентов и не меняет ни одной записи', async () => {
  await add(); await add(OWNER, { client_name: 'Мария', start_time: '15:00' });
  const before = await appointments();
  const client = (await clients()).find((c: any) => c.name === 'Анна');
  expect((await api(env, OWNER, 'PUT', `/api/clients/${client.id}`, { name: 'Мария' })).status).toBe(409);
  expect(await appointments()).toEqual(before);
  expect((await clients()).map((c: any) => c.name)).toEqual(['Анна', 'Мария']);
});

it('одновременные переименования оставляют все записи у окончательного имени клиента', async () => {
  await add();
  const client = (await clients())[0];
  const id = (await appointments())[0].id;
  const results = await Promise.all(['Анна Первая', 'Анна Вторая'].map(name => api(env, OWNER, 'PUT', `/api/clients/${client.id}`, { name })));
  expect(results.map(result => result.status)).toEqual([200, 200]);
  const current = (await clients())[0];
  expect(await appointments()).toMatchObject([{ id, client_name: current.name }]);
  expect((await api(env, OWNER, 'GET', `/api/clients/${client.id}`)).json.history).toHaveLength(1);
});

it('чтение старых записей не меняет их ID, NULL-поля, статусы и владельцев', async () => {
  for (const user of [OWNER, OTHER]) {
    await t.db.prepare("INSERT INTO users (user_id, tz, notify_time) VALUES (?, 'UTC', '22:00')").bind(user).run();
    await t.db.prepare("INSERT INTO appointments (id, user_id, date, start_time, client_name, service, status, comment) VALUES (?, ?, '2025-01-15', '10:00', 'Старая запись', 'fingers', 'no_show', 'Не менять')").bind(user + 1000, user).run();
  }
  const before = (await t.db.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  for (const user of [OWNER, OTHER]) {
    expect((await api(env, user, 'GET', '/api/appointments?from=2025-01-01&to=2025-12-31')).json).toHaveLength(1);
    await api(env, user, 'GET', '/api/settings');
    await api(env, user, 'GET', '/api/stats?period=year&date=2025-01-15');
  }
  expect((await t.db.prepare('SELECT * FROM appointments ORDER BY id').all()).results).toEqual(before);
});

it('адаптер raw возвращает массивы значений вместе с заголовком колонок', async () => {
  expect(await t.db.prepare('SELECT 7 AS id, NULL AS phone').raw({ columnNames: true })).toEqual([['id', 'phone'], [7, null]]);
});

it('ошибка обновления связанной записи откатывает переименование клиента', async () => {
  await add();
  const client = (await clients())[0];
  const before = await appointments();
  await t.client.execute("CREATE TRIGGER reject_rename BEFORE UPDATE OF client_name ON appointments BEGIN SELECT RAISE(ABORT, 'rename failure'); END");
  expect((await api(env, OWNER, 'PUT', `/api/clients/${client.id}`, { name: 'Новое имя' })).status).toBe(500);
  expect((await clients())[0].name).toBe('Анна');
  expect(await appointments()).toEqual(before);
});

it('ошибка настроек при импорте откатывает все данные и сохраняет данные другого мастера', async () => {
  await add(); await add(OTHER);
  const before = await appointments();
  const other = await appointments(OTHER);
  const beforeClients = await clients();
  const settings = (await api(env, OWNER, 'GET', '/api/settings')).json;
  const backup = (await api(env, OWNER, 'GET', '/api/export/json')).json;
  backup.appointments[0].client_name = 'Из копии';
  await t.client.execute("CREATE TRIGGER reject_settings BEFORE UPDATE OF tz ON users BEGIN SELECT RAISE(ABORT, 'settings failure'); END");
  expect((await api(env, OWNER, 'POST', '/api/import', { backup, confirm: true })).status).toBe(500);
  expect(await appointments()).toEqual(before);
  expect(await appointments(OTHER)).toEqual(other);
  expect(await clients()).toEqual(beforeClients);
  expect((await api(env, OWNER, 'GET', '/api/settings')).json).toEqual(settings);
});

it('неудачное создание клиента не оставляет частично сохранённую запись', async () => {
  await add(OTHER);
  const other = await appointments(OTHER);
  await t.client.execute("CREATE TRIGGER reject_client BEFORE INSERT ON clients WHEN NEW.user_id=111 BEGIN SELECT RAISE(ABORT, 'client failure'); END");
  expect((await add()).status).toBe(500);
  expect(await appointments()).toEqual([]);
  expect(await appointments(OTHER)).toEqual(other);
});

it('весь прайс откатывается при ошибке одной услуги', async () => {
  await api(env, OWNER, 'PUT', '/api/prices', { manicure: 500 });
  await t.client.execute("CREATE TRIGGER reject_price BEFORE INSERT ON service_prices WHEN NEW.service='pedicure' BEGIN SELECT RAISE(ABORT, 'price failure'); END");
  expect((await api(env, OWNER, 'PUT', '/api/prices', { manicure: 900, pedicure: 1200 })).status).toBe(500);
  expect((await api(env, OWNER, 'GET', '/api/prices')).json).toMatchObject({ manicure: 500, pedicure: null });
});

it('ошибочный график отвергается без изменения прежних настроек', async () => {
  const before = (await api(env, OWNER, 'GET', '/api/settings')).json;
  for (const changes of [{ work_start_time: '20:00', work_end_time: '09:00' }, { work_days: 'banana' }, { work_days: '1,1' }]) {
    expect((await api(env, OWNER, 'PUT', '/api/settings', { ...before, ...changes })).status).toBe(400);
    expect((await api(env, OWNER, 'GET', '/api/settings')).json).toEqual(before);
  }
  expect((await api(env, OWNER, 'PUT', '/api/settings', { ...before, work_days: '' })).status).toBe(200);
  expect((await api(env, OWNER, 'GET', '/api/settings')).json.work_days).toBe('');
  expect((await api(env, OWNER, 'GET', '/api/days/slots?date=2026-10-14')).json.is_work_day).toBe(false);
});

it('список и карточка одинаково считают активные записи и различают прошлый и следующий визит', async () => {
  await add(); await add(OWNER, { date: '2026-10-15' });
  await add(OWNER, { date: '2026-10-16', status: 'cancelled' });
  const client = (await clients())[0];
  const detail = (await api(env, OWNER, 'GET', `/api/clients/${client.id}`)).json.client;
  expect(client).toMatchObject({ appointments_count: 2, last_visit: '2026-10-14', next_visit: '2026-10-15' });
  expect(detail).toMatchObject({ appointments_count: client.appointments_count, last_visit: client.last_visit, next_visit: client.next_visit });
});

it('проверяет календарные дни рождения и сохраняет старые контакты при редактировании', async () => {
  for (const date of ['31.02', '31.04', '00.01', '01.13']) expect(cleanBirthday(date)).toBeNull();
  expect(cleanBirthday('29.02')).toBe('29.02');
  await add();
  await t.db.prepare("UPDATE clients SET telegram='старый контакт' WHERE user_id=?").bind(OWNER).run();
  const client = (await clients())[0];
  expect((await api(env, OWNER, 'PUT', `/api/clients/${client.id}`, { name: client.name, telegram: client.telegram, notes: 'Новая заметка' })).status).toBe(200);
  expect((await clients())[0]).toMatchObject({ telegram: 'старый контакт', notes: 'Новая заметка' });
  expect((await api(env, OWNER, 'POST', '/api/clients', { name: 'Новый', telegram: 'невалидный контакт' })).status).toBe(400);
});

it('после ошибки чтения именинников cron снимает бронь и повторяет отправку', async () => {
  await add();
  await api(env, OWNER, 'PUT', `/api/clients/${(await clients())[0].id}`, { name: 'Анна', birthday: '14.10' });
  let fail = true;
  const db = { ...t.db, prepare(sql: string) {
    if (fail && sql.includes('birthday = ?')) { fail = false; throw new Error('read failure'); }
    return t.db.prepare(sql);
  } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await runBirthdayNotifications({ ...env, DB: db }, 'https://app.test/');
  expect((await t.db.prepare('SELECT last_birthday_notify_date FROM users WHERE user_id=?').bind(OWNER).first<any>()).last_birthday_notify_date).toBeNull();
  const sent = stubTelegram();
  await runBirthdayNotifications(env, 'https://app.test/');
  expect(sent.some(c => c.text?.includes('день рождения'))).toBe(true);
});
