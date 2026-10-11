import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupDecision, runWeeklyBackups } from '../src/cron';
import { buildJsonBackup } from '../src/lib/backup';

// 2026-10-11 — воскресенье, 2026-10-04 — предыдущее, 2026-10-13 — вторник
describe('backupDecision', () => {
  it('воскресенье до 21:00: слот — прошлое воскресенье', () => {
    expect(backupDecision('2026-10-11', '20:59', null)).toEqual({ send: true, slot: '2026-10-04' });
    expect(backupDecision('2026-10-11', '20:59', '2026-10-04').send).toBe(false);
  });

  it('воскресенье с 21:00: слот — сегодня', () => {
    expect(backupDecision('2026-10-11', '21:00', '2026-10-04')).toEqual({ send: true, slot: '2026-10-11' });
    expect(backupDecision('2026-10-11', '23:59', '2026-10-11').send).toBe(false);
  });

  it('в будние дни слот — последнее воскресенье, повторно не шлём', () => {
    expect(backupDecision('2026-10-12', '09:00', '2026-10-11').send).toBe(false); // понедельник
    expect(backupDecision('2026-10-17', '23:00', '2026-10-11')).toEqual({ send: false, slot: '2026-10-11' }); // суббота
  });

  it('пропущенную копию досылает в любой следующий день', () => {
    expect(backupDecision('2026-10-13', '10:00', '2026-10-04')).toEqual({ send: true, slot: '2026-10-11' });
  });

  it('первая копия (last = null) уходит сразу', () => {
    expect(backupDecision('2026-10-14', '12:00', null)).toEqual({ send: true, slot: '2026-10-11' });
  });

  it('слот на границе месяца и года', () => {
    expect(backupDecision('2027-01-01', '12:00', null).slot).toBe('2026-12-27'); // пятница → воскресенье 27.12
    expect(backupDecision('2026-11-02', '08:00', null).slot).toBe('2026-11-01');
  });
});

// ---- подделки БД/Telegram ----
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function makeDb(user: any) {
  const mk = (sql: string, args: any[]): any => ({
    bind: (...a: any[]) => mk(sql, a),
    async first() {
      return sql.includes('FROM users') ? { ...user } : null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      if (sql.includes('last_backup_date IS NULL OR')) {
        if (user.last_backup_date === args[0]) return { meta: { changes: 0 } };
        user.last_backup_date = args[0];
        return { meta: { changes: 1 } };
      }
      if (sql.includes('AND last_backup_date=?')) {
        if (user.last_backup_date !== args[2]) return { meta: { changes: 0 } };
        user.last_backup_date = args[0];
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    },
  });
  return { prepare: (sql: string) => mk(sql, []) } as any;
}

const baseUser = () => ({
  user_id: 1, tz: 'Europe/Chisinau', notify_enabled: 1, notify_time: '22:00', notify_new_appt: 1,
  last_notified_date: null, backup_enabled: 1, last_backup_date: null as string | null,
});
const envWith = (DB: any) => ({ DB, ALLOWED_IDS: '1', TZ: 'Europe/Chisinau', BOT_TOKEN: 't' }) as any;

describe('runWeeklyBackups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T18:30:00Z')); // воскресенье 21:30 по Кишинёву (UTC+3)
    for (const m of ['error', 'warn', 'log'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('в воскресенье вечером отправляет файл и бронирует слот; повторно не шлёт', async () => {
    const user = baseUser();
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, result: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWith(makeDb(user));

    await runWeeklyBackups(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sendDocument');
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect((form.get('document') as File).name).toBe('nail-planner-backup-2026-10-11.json');
    expect(user.last_backup_date).toBe('2026-10-11');

    await runWeeklyBackups(env);
    await runWeeklyBackups(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('до воскресных 21:00 ничего не шлёт, если прошлая копия уже была', async () => {
    vi.setSystemTime(new Date('2026-10-11T17:00:00Z')); // 20:00 по Кишинёву
    const user = { ...baseUser(), last_backup_date: '2026-10-04' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runWeeklyBackups(envWith(makeDb(user)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('пропущенную неделю досылает во вторник', async () => {
    vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
    const user = { ...baseUser(), last_backup_date: '2026-10-04' };
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await runWeeklyBackups(envWith(makeDb(user)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(user.last_backup_date).toBe('2026-10-11');
  });

  it('сетевой сбой откатывает бронь, на следующей минуте повтор', async () => {
    const user = baseUser();
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('network down')).mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWith(makeDb(user));

    await runWeeklyBackups(env);
    expect(user.last_backup_date).toBeNull();

    await runWeeklyBackups(env);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(user.last_backup_date).toBe('2026-10-11');
  });

  it('ответ 500 откатывает бронь', async () => {
    const user = { ...baseUser(), last_backup_date: '2026-10-04' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, error_code: 500 }, 500)));

    await runWeeklyBackups(envWith(makeDb(user)));
    expect(user.last_backup_date).toBe('2026-10-04'); // вернули прежнее значение
  });

  it('403 оставляет бронь: до следующей недели не повторяет', async () => {
    const user = baseUser();
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: false, error_code: 403 }, 403));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWith(makeDb(user));

    await runWeeklyBackups(env);
    await runWeeklyBackups(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(user.last_backup_date).toBe('2026-10-11');
  });

  it('выключенный бэкап ничего не шлёт', async () => {
    const user = { ...baseUser(), backup_enabled: 0 };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runWeeklyBackups(envWith(makeDb(user)));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildJsonBackup', () => {
  it('содержит записи, клиентов, траты, прайс, заметки и настройки', async () => {
    const parsed = JSON.parse(await buildJsonBackup(makeDb(baseUser()), 1, 'Europe/Chisinau'));
    expect(parsed).toMatchObject({ format: 'nail-planner-backup', version: 2 });
    for (const key of ['appointments', 'clients', 'expenses', 'day_notes']) expect(parsed[key]).toEqual([]);
    expect(parsed.prices).toEqual({});
    expect(parsed.settings).toMatchObject({ tz: 'Europe/Chisinau', backup_enabled: true, work_days: '1,2,3,4,5,6' });
    expect(typeof parsed.exported_at).toBe('string');
  });
});
