// Интеграционные тесты: настоящие обработчики + настоящая SQLite с боевыми миграциями.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, seedWeek, stubTelegram, type TgCall } from './helpers/harness';

let env: any;
let tg: TgCall[];
let closeDb: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  env = makeEnv(t.db);
  tg = stubTelegram();
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const appt = (o: Record<string, unknown> = {}) => ({ date: '2026-10-14', start_time: '10:00', client_name: 'Инна', service: 'fingers', ...o });
const add = async (o: Record<string, unknown> = {}, user = OWNER) => {
  const r = await api(env, user, 'POST', '/api/appointments', appt(o));
  expect(r.status).toBe(201);
  return r.json.id as number;
};
const list = async (user = OWNER, from = '2026-10-01', to = '2026-10-31') =>
  (await api(env, user, 'GET', `/api/appointments?from=${from}&to=${to}`)).json as any[];

describe('авторизация', () => {
  it('без подписи, с мусорной подписью и для чужого ID — 403', async () => {
    expect((await api(env, null, 'GET', '/api/settings')).status).toBe(403);
    const bad = await worker403(env);
    expect(bad).toBe(403);
    expect((await api(env, 333, 'GET', '/api/settings')).status).toBe(403); // подпись верна, но ID не в списке
  });
  it('с верной подписью и ID из списка — 200', async () => {
    expect((await api(env, OWNER, 'GET', '/api/settings')).status).toBe(200);
  });
});

async function worker403(e: any) {
  const { default: worker } = await import('../src/index');
  const res = await worker.fetch(new Request('https://app.test/api/settings', { headers: { 'X-Init-Data': 'hash=deadbeef&user=%7B%22id%22%3A111%7D' } }), e, undefined as any);
  return res.status;
}

describe('записи', () => {
  it('создание → список: поля, цена, статус по умолчанию и конец по длительности услуги', async () => {
    const id = await add({ price: 800 });
    const [a] = await list();
    expect(a).toMatchObject({ id, client_name: 'Инна', service: 'fingers', price: 800, status: 'scheduled', start_time: '10:00', end_time: '11:00' });
  });

  it('новая запись шлёт мастеру уведомление и заводит клиента', async () => {
    await add({ client_name: 'Оля' });
    expect(tg.some((c) => c.method === 'sendMessage' && String(c.text).includes('Новая запись'))).toBe(true);
    const clients = (await api(env, OWNER, 'GET', '/api/clients')).json as any[];
    expect(clients.map((c) => c.name)).toContain('Оля');
  });

  it('плохие данные → 400 с понятным текстом', async () => {
    const bad = (o: object) => api(env, OWNER, 'POST', '/api/appointments', appt(o));
    expect((await bad({ date: '2026-02-31' })).json.error).toContain('дата');
    expect((await bad({ service: 'hairdo' })).json.error).toContain('услуга');
    expect((await bad({ status: 'done' })).json.error).toContain('статус');
    expect((await bad({ price: 12.5 })).json.error).toContain('Цена');
    expect((await bad({ client_name: ' ' })).status).toBe(400);
    expect(await list()).toHaveLength(0);
  });

  it('правка меняет поля и статус; несуществующая запись — 404', async () => {
    const id = await add({ price: 800 });
    const put = await api(env, OWNER, 'PUT', `/api/appointments/${id}`, appt({ price: 900, status: 'no_show', start_time: '12:00' }));
    expect(put.status).toBe(200);
    expect((await list())[0]).toMatchObject({ price: 900, status: 'no_show', start_time: '12:00', end_time: '13:00' });
    expect((await api(env, OWNER, 'PUT', '/api/appointments/9999', appt())).status).toBe(404);
  });

  it('удаление: первый раз ok, повторно — нет', async () => {
    const id = await add();
    expect((await api(env, OWNER, 'DELETE', `/api/appointments/${id}`)).json).toEqual({ ok: true });
    expect((await api(env, OWNER, 'DELETE', `/api/appointments/${id}`)).json).toEqual({ ok: false });
    expect(await list()).toHaveLength(0);
  });
});

describe('изоляция: чужие данные недоступны', () => {
  it('записи', async () => {
    const id = await add({ price: 800 });
    expect(await list(OTHER)).toEqual([]);
    expect((await api(env, OTHER, 'PUT', `/api/appointments/${id}`, appt({ client_name: 'Взлом' }))).status).toBe(404);
    expect((await api(env, OTHER, 'DELETE', `/api/appointments/${id}`)).json).toEqual({ ok: false });
    expect((await list())[0]).toMatchObject({ id, client_name: 'Инна' });
  });

  it('траты, клиенты, заметки, прайс и статистика', async () => {
    await add({ price: 800, date: '2026-10-12' });
    const exp = (await api(env, OWNER, 'POST', '/api/expenses', { date: '2026-10-12', name: 'Гель', amount: 500 })).json.id;
    await api(env, OWNER, 'PUT', '/api/notes/2026-10-12', { text: 'секрет' });
    await api(env, OWNER, 'PUT', '/api/prices', { manicure: 777 });

    expect((await api(env, OTHER, 'PUT', `/api/expenses/${exp}`, { date: '2026-10-12', name: 'Взлом', amount: 1 })).status).toBe(404);
    expect((await api(env, OTHER, 'DELETE', `/api/expenses/${exp}`)).json).toEqual({ ok: false });
    expect((await api(env, OTHER, 'GET', '/api/expenses?from=2026-10-01&to=2026-10-31')).json).toEqual([]);
    expect(((await api(env, OTHER, 'GET', '/api/clients')).json as any[]).map((c) => c.name)).not.toContain('Инна');
    expect((await api(env, OTHER, 'GET', '/api/notes/2026-10-12')).json.text).toBe('');
    expect((await api(env, OTHER, 'GET', '/api/prices')).json.manicure).toBeNull();
    const st = (await api(env, OTHER, 'GET', '/api/stats?period=week')).json;
    expect(st).toMatchObject({ total: 0, total_expense: 0, expected: 0 });
    expect((await api(env, OWNER, 'GET', '/api/stats?period=week')).json.total).toBe(800);
  });
});

describe('конфликты, окна и сводка дней с учётом статуса', () => {
  it('отменённая запись не конфликтует и освобождает окно', async () => {
    const id = await add({ date: '2026-10-15', start_time: '10:00' });
    const check = async () => (await api(env, OWNER, 'POST', '/api/appointments/check', appt({ date: '2026-10-15', start_time: '10:30' }))).json.conflicts.length;
    const freeAt10 = async () => {
      const r = (await api(env, OWNER, 'GET', '/api/days/slots?date=2026-10-15')).json;
      return (r.slots as any[]).some((s) => s.start <= '10:00' && s.end >= '11:00');
    };

    expect(await check()).toBe(1);
    expect(await freeAt10()).toBe(false);
    const days = async () => ((await api(env, OWNER, 'GET', '/api/days?from=2026-10-15&to=2026-10-15')).json as any[])[0]?.count ?? 0;
    expect(await days()).toBe(1);

    await api(env, OWNER, 'PUT', `/api/appointments/${id}`, appt({ date: '2026-10-15', start_time: '10:00', status: 'cancelled' }));
    expect(await check()).toBe(0);
    expect(await freeAt10()).toBe(true);
    expect(await days()).toBe(0);
  });
});

describe('доходы и статистика', () => {
  beforeEach(async () => { await seedWeek(env); });

  it('в доход идут только состоявшиеся записи; будущие — «ожидается»; срывы считаются отдельно', async () => {
    const r = (await api(env, OWNER, 'GET', '/api/stats?period=week')).json;
    expect(r).toMatchObject({
      from: '2026-10-12', to: '2026-10-18',
      total: 2500, paid: 3, unpaid: 1, avg: 833,       // 800 + 1200 + 500, без цены — 1
      expected: 1600, expected_count: 2,                 // 700 (сегодня позже) + 900 (завтра)
      no_show: 1, cancelled: 1,
      prev_total: 1000, prev_expense: 200,
    });
  });

  it('траты, прибыль и материалы (регистр названия не важен)', async () => {
    const r = (await api(env, OWNER, 'GET', '/api/stats?period=week')).json;
    expect(r).toMatchObject({ total_expense: 900, profit: 1600, expense_count: 3 });
    expect(r.materials).toEqual([{ name: 'Гель-лак', sum: 750, count: 2 }, { name: 'Пилки', sum: 150, count: 1 }]);
    expect(r.buckets).toHaveLength(7);
    expect(r.buckets[0]).toMatchObject({ key: '2026-10-12', sum: 800, expense: 450 });
  });

  it('месяц и год согласованы с неделей; плохие параметры → 400', async () => {
    const m = (await api(env, OWNER, 'GET', '/api/stats?period=month')).json;
    expect(m).toMatchObject({ from: '2026-10-01', to: '2026-10-31', total: 3500 }); // + 1000 с прошлой недели
    expect(m.buckets).toHaveLength(31);
    const y = (await api(env, OWNER, 'GET', '/api/stats?period=year')).json;
    expect(y.buckets).toHaveLength(12);
    expect(y.buckets[9].sum).toBe(3500);
    expect((await api(env, OWNER, 'GET', '/api/stats?period=day')).status).toBe(400);
    expect((await api(env, OWNER, 'GET', '/api/stats?period=week&date=2026-02-31')).status).toBe(400);
  });

  it('смена статуса пересчитывает доход', async () => {
    const week = async () => (await api(env, OWNER, 'GET', '/api/stats?period=week')).json;
    const ids = (await list(OWNER, '2026-10-12', '2026-10-12')).filter((a) => a.price === 800).map((a) => a.id);
    await api(env, OWNER, 'PUT', `/api/appointments/${ids[0]}`, appt({ date: '2026-10-12', price: 800, status: 'cancelled' }));
    const r = await week();
    expect(r.total).toBe(1700);
    expect(r.cancelled).toBe(2);
  });
});

describe('траты', () => {
  it('создание, нормализация названия, правка, список по периоду, подсказки, удаление', async () => {
    const id = (await api(env, OWNER, 'POST', '/api/expenses', { date: '2026-10-10', name: '  гель   лак ', amount: '1 200' })).json.id;
    await api(env, OWNER, 'POST', '/api/expenses', { date: '2026-10-11', name: 'Пилки', amount: 100 });
    await api(env, OWNER, 'POST', '/api/expenses', { date: '2026-10-12', name: 'Пилки', amount: 100 });
    await api(env, OWNER, 'POST', '/api/expenses', { date: '2026-11-01', name: 'Другой месяц', amount: 5 });

    const oct = (await api(env, OWNER, 'GET', '/api/expenses?from=2026-10-01&to=2026-10-31')).json as any[];
    expect(oct.map((e) => e.name)).toEqual(['Пилки', 'Пилки', 'Гель лак']); // новые сверху
    expect(oct[2].amount).toBe(1200);
    expect((await api(env, OWNER, 'GET', '/api/expenses/names')).json[0]).toBe('Пилки'); // самое частое

    expect((await api(env, OWNER, 'PUT', `/api/expenses/${id}`, { date: '2026-10-10', name: 'Гель-лак', amount: 1300 })).status).toBe(200);
    expect(((await api(env, OWNER, 'GET', '/api/expenses?from=2026-10-10&to=2026-10-10')).json as any[])[0]).toMatchObject({ name: 'Гель-лак', amount: 1300 });
    expect((await api(env, OWNER, 'DELETE', `/api/expenses/${id}`)).json).toEqual({ ok: true });
  });

  it('некорректные данные → 400', async () => {
    const post = (b: object) => api(env, OWNER, 'POST', '/api/expenses', b);
    expect((await post({ date: '2026-10-10', name: '', amount: 5 })).status).toBe(400);
    expect((await post({ date: '2026-10-10', name: 'X', amount: 0 })).status).toBe(400);
    expect((await post({ date: '2026-10-10', name: 'X', amount: 1.5 })).status).toBe(400);
    expect((await post({ date: 'вчера', name: 'X', amount: 5 })).status).toBe(400);
  });
});

describe('прайс и настройки', () => {
  it('прайс: по умолчанию пусто, частичное обновление, null удаляет, ошибка ничего не меняет', async () => {
    expect((await api(env, OWNER, 'GET', '/api/prices')).json).toEqual({ manicure: null, pedicure: null, both: null, fingers: null });
    expect((await api(env, OWNER, 'PUT', '/api/prices', { manicure: 800, fingers: '300' })).json).toMatchObject({ manicure: 800, fingers: 300, pedicure: null });
    expect((await api(env, OWNER, 'PUT', '/api/prices', { manicure: 850 })).json).toMatchObject({ manicure: 850, fingers: 300 });
    expect((await api(env, OWNER, 'PUT', '/api/prices', { fingers: null })).json.fingers).toBeNull();
    expect((await api(env, OWNER, 'PUT', '/api/prices', { manicure: 1, pedicure: -5 })).status).toBe(400);
    expect((await api(env, OWNER, 'GET', '/api/prices')).json.manicure).toBe(850); // не изменилось
  });

  it('настройки: бэкап включён по умолчанию, выключается и сохраняется; не-булево → 400', async () => {
    const s = (await api(env, OWNER, 'GET', '/api/settings')).json;
    expect(s.backup_enabled).toBe(true);
    const put = await api(env, OWNER, 'PUT', '/api/settings', { ...s, backup_enabled: false });
    expect(put.status).toBe(200);
    expect((await api(env, OWNER, 'GET', '/api/settings')).json.backup_enabled).toBe(false);
    expect((await api(env, OWNER, 'PUT', '/api/settings', { ...s, backup_enabled: 'yes' })).status).toBe(400);
  });
});

describe('выгрузки', () => {
  it('CSV записей: колонки «цена» и «статус»', async () => {
    await add({ price: 800 });
    await add({ start_time: '12:00', status: 'cancelled' });
    expect((await api(env, OWNER, 'POST', '/api/export/send', { format: 'csv' })).json.ok).toBe(true);
    const doc = tg.find((c) => c.method === 'sendDocument')!;
    expect(doc.filename).toMatch(/\.csv$/);
    expect(doc.file).toContain('покрытие;цена;статус;комментарий');
    expect(doc.file).toContain('запланирована');
    expect(doc.file).toContain('отменена');
  });

  it('CSV доходов и трат: только состоявшиеся записи, итоги и материалы', async () => {
    await seedWeek(env);
    const r = await api(env, OWNER, 'POST', '/api/export/finance', { period: 'week' });
    expect(r.json.filename).toBe('nail-planner-finance-2026-10-12_2026-10-18.csv');
    const csv = tg.find((c) => c.method === 'sendDocument')!.file!;
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines).toContain('доход;2026-10-12;Инна;пальцы;800');
    expect(lines).toContain('трата;2026-10-12;Гель-лак;материалы;450');
    expect(lines).toContain('итого доход;;;;2500');
    expect(lines).toContain('итого траты;;;;900');
    expect(lines).toContain('прибыль;;;;1600');
    expect(lines).toContain('записей без цены (не учтены);;;;1');
    expect(lines).toContain('материал;;Гель-лак;2;750');
    expect(csv).not.toContain(';600'); // отменённая
    expect(csv).not.toContain(';400'); // не пришла
    expect(csv).not.toContain(';900\r\n' + 'доход'); // будущая запись (900) не в доходе
    expect(lines.filter((l) => l.startsWith('доход;'))).toHaveLength(3);
  });

  it('выгрузка доходов: плохой период → 400', async () => {
    expect((await api(env, OWNER, 'POST', '/api/export/finance', { period: 'decade' })).status).toBe(400);
  });

  it('JSON-копия содержит все разделы вместе со статусами', async () => {
    await seedWeek(env);
    await api(env, OWNER, 'PUT', '/api/prices', { manicure: 800 });
    await api(env, OWNER, 'PUT', '/api/notes/2026-10-12', { text: 'заметка' });
    const b = (await api(env, OWNER, 'GET', '/api/export/json')).json;
    expect(b).toMatchObject({ format: 'nail-planner-backup', version: 2, prices: { manicure: 800 } });
    expect(b.appointments).toHaveLength(9);
    expect(b.appointments.map((a: any) => a.status)).toEqual(expect.arrayContaining(['cancelled', 'no_show', 'scheduled']));
    expect(b.expenses).toHaveLength(4);
    expect(b.clients.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Инна', 'Мария']));
    expect(b.day_notes).toEqual([{ date: '2026-10-12', text: 'заметка' }]);
  });
});
