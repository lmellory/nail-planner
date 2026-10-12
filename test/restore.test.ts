// Восстановление из резервной копии: полный круг «выгрузили → загрузили» на настоящей базе.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreBackup, sanitizeBackup } from '../src/lib/restore';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, seedWeek, stubTelegram } from './helpers/harness';

let env: any;
let db: D1Database;
let closeDb: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  db = t.db;
  env = makeEnv(db);
  stubTelegram();
});
afterEach(() => { closeDb(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const exportOf = async (user: number) => (await api(env, user, 'GET', '/api/export/json')).json;
const strip = (rows: any[], drop = ['id', 'user_id', 'created_at', 'updated_at']) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
const byKey = (rows: any[], ...keys: string[]) => [...rows].sort((a, b) => keys.map((k) => String(a[k] ?? '')).join('|').localeCompare(keys.map((k) => String(b[k] ?? '')).join('|')));

async function fillOwner() {
  await seedWeek(env);
  await api(env, OWNER, 'POST', '/api/clients', { name: 'Анна', phone: '+37379000000', telegram: '@anna', notes: 'любит нюд', birthday: '05.03' });
  await api(env, OWNER, 'PUT', '/api/prices', { manicure: 800, both: 1500 });
  await api(env, OWNER, 'PUT', '/api/notes/2026-10-12', { text: 'заметка дня' });
  const s = (await api(env, OWNER, 'GET', '/api/settings')).json;
  await api(env, OWNER, 'PUT', '/api/settings', { ...s, work_start_time: '10:00', work_end_time: '18:00', backup_enabled: false });
}

describe('восстановление через API', () => {
  it('предпросмотр (без confirm) показывает, что будет восстановлено, и ничего не меняет', async () => {
    await fillOwner();
    const backup = await exportOf(OWNER);
    const r = await api(env, OTHER, 'POST', '/api/import', { backup });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ dry_run: true, report: { appointments: { ok: 9, skipped: 0 }, expenses: { ok: 4 }, prices: 2, settings: true } });
    expect((await exportOf(OTHER)).appointments).toEqual([]);
  });

  it('полный круг: данные мастера переносятся один в один, статусы и цены сохраняются', async () => {
    await fillOwner();
    const backup = await exportOf(OWNER);
    const r = await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true });
    expect(r.json.ok).toBe(true);

    const copy = await exportOf(OTHER);
    expect(byKey(strip(copy.appointments), 'date', 'start_time', 'client_name')).toEqual(byKey(strip(backup.appointments), 'date', 'start_time', 'client_name'));
    expect(byKey(strip(copy.expenses), 'date', 'name', 'amount')).toEqual(byKey(strip(backup.expenses), 'date', 'name', 'amount'));
    expect(byKey(strip(copy.clients), 'name')).toEqual(byKey(strip(backup.clients), 'name'));
    expect(copy.day_notes).toEqual(backup.day_notes);
    expect(copy.prices).toEqual(backup.prices);
    expect(copy.settings).toMatchObject({ work_start_time: '10:00', work_end_time: '18:00', backup_enabled: false });
    expect(copy.appointments.map((a: any) => a.status)).toEqual(expect.arrayContaining(['cancelled', 'no_show']));

    // и доходы у копии те же, что у оригинала
    const stats = async (u: number) => (await api(env, u, 'GET', '/api/stats?period=week')).json;
    const [a, b] = [await stats(OWNER), await stats(OTHER)];
    for (const k of ['total', 'expected', 'no_show', 'cancelled', 'total_expense', 'profit']) expect(b[k]).toBe(a[k]);
  });

  it('заменяет ВСЕ прежние данные получателя и не трогает данные других', async () => {
    await fillOwner();
    await api(env, OTHER, 'POST', '/api/appointments', { date: '2026-10-20', start_time: '10:00', client_name: 'Старая', service: 'fingers' });
    await api(env, OTHER, 'POST', '/api/expenses', { date: '2026-10-20', name: 'Старое', amount: 5 });
    const ownerBefore = await exportOf(OWNER);

    await api(env, OTHER, 'POST', '/api/import', { backup: ownerBefore, confirm: true });
    const other = await exportOf(OTHER);
    expect(other.appointments.map((a: any) => a.client_name)).not.toContain('Старая');
    expect(other.expenses.map((e: any) => e.name)).not.toContain('Старое');
    expect(strip((await exportOf(OWNER)).appointments)).toEqual(strip(ownerBefore.appointments)); // у владельца без изменений
  });

  it('импорт можно повторять: дублей не появляется', async () => {
    await fillOwner();
    const backup = await exportOf(OWNER);
    await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true });
    await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true });
    expect((await exportOf(OTHER)).appointments).toHaveLength(9);
  });

  it('отклоняет чужие и повреждённые файлы (400) и ничего не меняет', async () => {
    await fillOwner();
    const before = await exportOf(OWNER);
    const imp = (backup: unknown) => api(env, OWNER, 'POST', '/api/import', { backup, confirm: true });
    expect((await imp(null)).status).toBe(400);
    expect((await imp([])).status).toBe(400);
    expect((await imp({ hello: 'world' })).json.error).toContain('не похож');
    expect((await imp({ format: 'other-app', appointments: [] })).json.error).toContain('не резервная копия');
    expect((await imp({ format: 'nail-planner-backup', version: 99, appointments: [] })).json.error).toContain('новой версией');
    expect((await imp({ format: 'nail-planner-backup', version: 2, appointments: 'oops' })).status).toBe(400);
    expect((await imp({ format: 'nail-planner-backup', version: 2, appointments: [], clients: [] })).json.error).toContain('нет данных');
    expect((await api(env, OWNER, 'POST', '/api/import', {})).status).toBe(400);
    expect(await exportOf(OWNER)).toMatchObject({ appointments: before.appointments, expenses: before.expenses });
  });

  it('старая копия без поля format и без статусов восстанавливается, статус = scheduled', async () => {
    const legacy = {
      appointments: [{ id: 5, date: '2026-09-01', start_time: '10:00', end_time: '12:00', client_name: 'Давняя', service: 'manicure', manicure_coating: 'gel', price: null, comment: 'x' }],
      day_notes: [{ date: '2026-09-01', text: 'старая заметка' }],
      settings: { notify_enabled: true, notify_time: '21:30', tz: 'Europe/Chisinau' },
    };
    const r = await api(env, OWNER, 'POST', '/api/import', { backup: legacy, confirm: true });
    expect(r.json.ok).toBe(true);
    const copy = await exportOf(OWNER);
    expect(copy.appointments[0]).toMatchObject({ client_name: 'Давняя', status: 'scheduled', end_time: '12:00' });
    expect(copy.day_notes).toEqual([{ date: '2026-09-01', text: 'старая заметка' }]);
    expect(copy.settings.notify_time).toBe('21:30');
  });
});

describe('sanitizeBackup: «строго по форме, лениво по мелочам»', () => {
  const base = { format: 'nail-planner-backup', version: 2 };

  it('битые строки пропускаются и считаются, остальное восстанавливается', () => {
    const r = sanitizeBackup({
      ...base,
      appointments: [
        { date: '2026-10-10', start_time: '10:00', client_name: 'Ок', service: 'fingers' },
        { date: 'вчера', start_time: '10:00', client_name: 'Плохая дата', service: 'fingers' },
        { date: '2026-10-10', start_time: '25:00', client_name: 'Плохое время', service: 'fingers' },
        { date: '2026-10-10', start_time: '10:00', client_name: ' ', service: 'fingers' },
        { date: '2026-10-11', start_time: '10:00', client_name: 'Странная услуга', service: 'hairdo', status: 'weird', price: 12.5, end_time: '09:00' },
      ],
      clients: [{ name: 'Анна' }, { name: 'Анна' }, { name: '' }],
      expenses: [{ date: '2026-10-10', name: 'гель', amount: 100 }, { date: '2026-10-10', name: 'Нулевая', amount: 0 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report).toMatchObject({ appointments: { ok: 2, skipped: 3 }, clients: { ok: 1, skipped: 2 }, expenses: { ok: 1, skipped: 1 } });
    // «странная» запись чинится, а не теряется
    expect(r.data.appointments[1]).toMatchObject({ service: 'manicure', status: 'scheduled', price: null, end_time: null });
    expect(r.data.expenses[0].name).toBe('Гель');
  });

  it('настройки: применяются только корректные поля', () => {
    const r = sanitizeBackup({ ...base, prices: { manicure: 500 }, settings: { notify_time: '99:99', tz: 'Mars/Base', work_days: '1,2,x', backup_enabled: false, notify_enabled: 'yes' } });
    expect(r.ok && r.data.settings).toEqual({ backup_enabled: false });
  });

  it('цены: только известные услуги и верные суммы', () => {
    const r = sanitizeBackup({ ...base, prices: { manicure: 500, pedicure: -1, both: 'abc', hairdo: 5, fingers: '300' } });
    expect(r.ok && r.data.prices).toEqual({ manicure: 500, fingers: 300 });
  });

  it('слишком большой файл отклоняется', () => {
    const rows = Array.from({ length: 20001 }, () => ({ date: '2026-10-10', start_time: '10:00', client_name: 'A', service: 'fingers' }));
    expect(sanitizeBackup({ ...base, appointments: rows })).toMatchObject({ ok: false });
  });
});

describe('атомарность', () => {
  it('сбой посреди восстановления откатывает всё: прежние данные остаются', async () => {
    await api(env, OWNER, 'POST', '/api/appointments', { date: '2026-10-20', start_time: '10:00', client_name: 'Прежняя', service: 'fingers' });
    await api(env, OWNER, 'POST', '/api/expenses', { date: '2026-10-20', name: 'Прежняя трата', amount: 7 });

    const broken = {
      appointments: [{ date: '2026-10-21', start_time: '10:00', end_time: null, client_name: 'Новая', who: null, service: 'fingers', manicure_coating: null, pedicure_coating: null, comment: null, price: null, status: 'scheduled' }],
      clients: [
        { name: 'Дубль', phone: null, telegram: null, notes: null, birthday: null },
        { name: 'Дубль', phone: null, telegram: null, notes: null, birthday: null }, // нарушит UNIQUE уже внутри транзакции
      ],
      expenses: [], day_notes: [], prices: {}, settings: {},
    };
    await expect(restoreBackup(db, OWNER, 'Europe/Chisinau', broken)).rejects.toThrow();

    const after = await exportOf(OWNER);
    expect(after.appointments.map((a: any) => a.client_name)).toEqual(['Прежняя']);
    expect(after.expenses.map((e: any) => e.name)).toEqual(['Прежняя трата']);
  });
});
