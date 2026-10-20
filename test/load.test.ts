// Изолированная нагрузка на настоящий Worker и SQLite. Рабочая база и сеть не используются.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Appointment } from '../src/types';
import { api, createTestDb, makeEnv, stubTelegram } from './helpers/harness';

const masters = Array.from({ length: 10 }, (_, index) => 10001 + index);
let database: Awaited<ReturnType<typeof createTestDb>>;
let env: ReturnType<typeof makeEnv>;
let original: Appointment[];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

beforeAll(async () => {
  database = await createTestDb();
  env = makeEnv(database.db, { ALLOWED_IDS: masters.join(',') });
  stubTelegram();
  for (const user of masters) {
    // Уведомления отключены только у искусственных пользователей тестовой базы.
    await database.client.execute({ sql: 'INSERT INTO users (user_id, tz, notify_enabled, notify_new_appt) VALUES (?, ?, 0, 0)', args: [user, 'UTC'] });
    await database.client.batch(Array.from({ length: 1000 }, (_, index) => ({
      sql: 'INSERT INTO appointments (user_id,date,start_time,end_time,client_name,service,manicure_coating,price,status) VALUES (?,?,?,?,?,?,?,?,?)',
      args: [user, `2026-10-${String(index % 28 + 1).padStart(2, '0')}`, '10:00', '12:00', `Мастер ${user} клиент ${index % 100}`, 'manicure', 'gel', 250, 'scheduled'],
    })), 'write');
    await database.client.batch(Array.from({ length: 100 }, (_, index) => ({
      sql: 'INSERT INTO clients (user_id,name) VALUES (?,?)', args: [user, `Мастер ${user} клиент ${index}`],
    })), 'write');
  }
  original = (await database.db.prepare('SELECT * FROM appointments ORDER BY id').all<Appointment>()).results;
}, 60000);

afterAll(() => { database?.close(); vi.unstubAllGlobals(); });

describe('10 мастеров и 10 000 записей', () => {
  it('100 одновременных запросов возвращают только данные своего мастера', async () => {
    const timings: number[] = [];
    await Promise.all(masters.flatMap(user => Array.from({ length: 10 }, async (_, index) => {
      const start = performance.now();
      const path = index % 3 === 0 ? '/api/appointments?from=2026-10-01&to=2026-10-31'
        : index % 3 === 1 ? '/api/clients' : '/api/stats?period=month&date=2026-10-15';
      const response = await api(env, user, 'GET', path);
      timings.push(performance.now() - start);
      expect(response.status).toBe(200);
      if (path.startsWith('/api/appointments')) {
        expect(response.json).toHaveLength(1000);
        expect(response.json.every((row: Appointment) => row.user_id === user)).toBe(true);
      } else if (path === '/api/clients') {
        expect(response.json).toHaveLength(100);
        expect(response.json.every((row: { user_id: number }) => row.user_id === user)).toBe(true);
      } else expect(response.json.total + response.json.expected).toBe(250000);
    })));
    timings.sort((a, b) => a - b);
    console.info('load-check', JSON.stringify({ environment: 'local SQLite + Worker handlers', masters: 10, appointments: 10000, concurrentRequests: 100, p50Ms: Math.round(timings[49]), p95Ms: Math.round(timings[94]), maxMs: Math.round(timings.at(-1)!) }));
  }, 60000);

  it('20 параллельных сохранений сохраняют все записи, ID и содержимое прежних 10 000 строк', async () => {
    const responses = await Promise.all(masters.flatMap(user => [0, 1].map(index => api(env, user, 'POST', '/api/appointments', {
      date: '2026-11-01', start_time: index ? '14:00' : '10:00', client_name: `Новый клиент ${user}`, service: 'fingers', price: 300,
    }))));
    expect(responses.every(response => response.status === 201)).toBe(true);
    expect(new Set(responses.map(response => response.json.id)).size).toBe(20);
    const after = (await database.db.prepare('SELECT * FROM appointments ORDER BY id').all<Appointment>()).results;
    expect(after).toHaveLength(10020);
    const originalIds = new Set(original.map(row => row.id));
    expect(hash(after.filter(row => originalIds.has(row.id)))).toBe(hash(original));
    for (const user of masters) {
      expect(after.filter(row => row.user_id === user)).toHaveLength(1002);
      const clients = await database.client.execute({ sql: 'SELECT COUNT(*) AS n FROM clients WHERE user_id=? AND name=?', args: [user, `Новый клиент ${user}`] });
      expect(Number(clients.rows[0].n)).toBe(1);
    }
  }, 60000);

  it('одновременные попытки изменить чужие записи отклоняются без изменения данных', async () => {
    const before = await database.client.execute('SELECT * FROM appointments ORDER BY id');
    const responses = await Promise.all(masters.slice(1).map(user => api(env, user, 'DELETE', `/api/appointments/${original[0].id}`)));
    expect(responses.every(response => response.status === 200 && response.json.ok === false)).toBe(true);
    expect(hash((await database.client.execute('SELECT * FROM appointments ORDER BY id')).rows)).toBe(hash(before.rows));
  }, 60000);
});
