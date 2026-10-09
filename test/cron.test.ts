import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  birthdayDecision,
  classifySend,
  formatBirthdayNotification,
  notifyDecision,
  processScheduledDeletes,
  runNotifications,
  shouldForgetDelete,
} from '../src/cron';

describe('notifyDecision', () => {
  it('до времени уведомления не отправляет', () => {
    expect(notifyDecision('2026-10-08', '21:59', '22:00', null).send).toBe(false);
  });

  it('в заданное время отправляет за сегодняшнюю вечернюю дату', () => {
    expect(notifyDecision('2026-10-08', '22:00', '22:00', null)).toEqual({
      send: true,
      eveningDate: '2026-10-08',
    });
  });

  it('не отправляет повторно в тот же вечер', () => {
    expect(notifyDecision('2026-10-08', '22:30', '22:00', '2026-10-08').send).toBe(false);
  });

  it('отправляет на следующий вечер', () => {
    expect(notifyDecision('2026-10-09', '22:00', '22:00', '2026-10-08').send).toBe(true);
  });

  it('после полуночи досылает пропущенное за вчерашний вечер', () => {
    expect(notifyDecision('2026-10-09', '00:30', '22:00', '2026-10-07')).toEqual({
      send: true,
      eveningDate: '2026-10-08',
    });
  });

  it('после полуночи не досылает, если вчера уже отправляли', () => {
    expect(notifyDecision('2026-10-09', '00:30', '22:00', '2026-10-08').send).toBe(false);
  });

  it('граница 03:00: в 02:59 ещё досылает, в 03:00 уже нет', () => {
    expect(notifyDecision('2026-10-09', '02:59', '22:00', null).send).toBe(true);
    expect(notifyDecision('2026-10-09', '03:00', '22:00', null).send).toBe(false);
  });

  it('вечерняя дата на границе месяца', () => {
    expect(notifyDecision('2026-11-01', '00:10', '22:00', null).eveningDate).toBe('2026-10-31');
  });

  it('если время уведомления раньше 03:00, доотправка после полуночи выключена', () => {
    expect(notifyDecision('2026-10-09', '00:30', '01:00', null).send).toBe(false);
    expect(notifyDecision('2026-10-09', '01:00', '01:00', null)).toEqual({
      send: true,
      eveningDate: '2026-10-09',
    });
  });
});

describe('classifySend', () => {
  it('ok → sent', () => {
    expect(classifySend({ ok: true })).toBe('sent');
  });

  it('403 → blocked (повторять не нужно)', () => {
    expect(classifySend({ ok: false, error_code: 403 })).toBe('blocked');
  });

  it('прочие ошибки и сетевой сбой → retry', () => {
    expect(classifySend({ ok: false, error_code: 429 })).toBe('retry');
    expect(classifySend({ ok: false, error_code: 500 })).toBe('retry');
    expect(classifySend({ ok: false })).toBe('retry');
    expect(classifySend(null)).toBe('retry');
  });
});

describe('shouldForgetDelete', () => {
  it('успех и клиентские ошибки: запись об удалении снимается', () => {
    expect(shouldForgetDelete({ ok: true })).toBe(true);
    expect(shouldForgetDelete({ ok: false, error_code: 400 })).toBe(true);
    expect(shouldForgetDelete({ ok: false, error_code: 403 })).toBe(true);
  });

  it('429, 5xx и сетевой сбой: повторим на следующей минуте', () => {
    expect(shouldForgetDelete({ ok: false, error_code: 429 })).toBe(false);
    expect(shouldForgetDelete({ ok: false, error_code: 502 })).toBe(false);
    expect(shouldForgetDelete({ ok: false })).toBe(false);
  });
});

// ---- Вспомогательные подделки для проверки runNotifications / processScheduledDeletes ----

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function makeDb(state: { user: any; deletes?: { id: number; chat_id: number; message_id: number; delete_at: number }[] }) {
  const deletes = state.deletes ?? [];
  const mk = (sql: string, args: any[]): any => ({
    bind: (...a: any[]) => mk(sql, a),
    async first() {
      if (sql.includes('FROM users')) return { ...state.user };
      return null;
    },
    async all() {
      if (sql.includes('FROM scheduled_deletes')) {
        return { results: deletes.filter((r) => r.delete_at <= args[0]).slice(0, args[1]) };
      }
      return { results: [] };
    },
    async run() {
      if (sql.startsWith('DELETE FROM scheduled_deletes')) {
        const i = deletes.findIndex((r) => r.id === args[0]);
        if (i >= 0) deletes.splice(i, 1);
        return { meta: { changes: i >= 0 ? 1 : 0 } };
      }
      if (sql.includes('last_notified_date IS NULL OR')) {
        // бронь
        if (state.user.last_notified_date === args[0]) return { meta: { changes: 0 } };
        state.user.last_notified_date = args[0];
        return { meta: { changes: 1 } };
      }
      if (sql.includes('AND last_notified_date=?')) {
        // откат брони
        if (state.user.last_notified_date !== args[2]) return { meta: { changes: 0 } };
        state.user.last_notified_date = args[0];
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    },
  });
  return { prepare: (sql: string) => mk(sql, []), _deletes: deletes } as any;
}

const baseUser = () => ({
  user_id: 1,
  tz: 'UTC',
  notify_enabled: 1,
  notify_time: '22:00',
  last_notified_date: null as string | null,
  notify_new_appt: 1,
});

const envWith = (db: any) => ({ DB: db, ALLOWED_IDS: '1', BOT_TOKEN: 'x', TZ: 'UTC' }) as any;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T22:30:00Z')); // 22:30 UTC, вечер 2026-10-08
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runNotifications: откат и остановка после 403', () => {
  it('успешная отправка оставляет бронь', async () => {
    const user = baseUser();
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, result: { message_id: 5 } }));
    vi.stubGlobal('fetch', fetchMock);

    await runNotifications(envWith(makeDb({ user })), 'https://x/');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(user.last_notified_date).toBe('2026-10-08');
  });

  it('сетевое исключение откатывает бронь (на следующей минуте повтор)', async () => {
    const user = baseUser();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWith(makeDb({ user }));

    await runNotifications(env, 'https://x/');
    expect(user.last_notified_date).toBeNull();

    await runNotifications(env, 'https://x/'); // следующая минута
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ответ 500 откатывает бронь', async () => {
    const user = baseUser();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, error_code: 500, description: 'oops' }, 500)));

    await runNotifications(envWith(makeDb({ user })), 'https://x/');

    expect(user.last_notified_date).toBeNull();
  });

  it('403 оставляет бронь и больше не повторяет в этот вечер', async () => {
    const user = baseUser();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWith(makeDb({ user }));

    await runNotifications(env, 'https://x/');
    expect(user.last_notified_date).toBe('2026-10-08');

    await runNotifications(env, 'https://x/');
    await runNotifications(env, 'https://x/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('на следующий вечер после 403 попытка возобновляется', async () => {
    const user = baseUser();
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: false, error_code: 403 }, 403));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWith(makeDb({ user }));

    await runNotifications(env, 'https://x/');
    vi.setSystemTime(new Date('2026-10-09T22:30:00Z'));
    await runNotifications(env, 'https://x/');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('выключенные уведомления ничего не отправляют', async () => {
    const user = { ...baseUser(), notify_enabled: 0 };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runNotifications(envWith(makeDb({ user })), 'https://x/');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('processScheduledDeletes: удаление сообщений бота из чата', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('удаляет просроченное сообщение и снимает запись', async () => {
    const deletes = [{ id: 1, chat_id: 1, message_id: 77, delete_at: now() - 10 }];
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, result: true }));
    vi.stubGlobal('fetch', fetchMock);
    const db = makeDb({ user: baseUser(), deletes });

    await processScheduledDeletes(envWith(db));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/deleteMessage');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ chat_id: 1, message_id: 77 });
    expect(deletes).toHaveLength(0);
  });

  it('не трогает сообщения, срок которых ещё не вышел', async () => {
    const deletes = [{ id: 1, chat_id: 1, message_id: 77, delete_at: now() + 3600 }];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await processScheduledDeletes(envWith(makeDb({ user: baseUser(), deletes })));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(deletes).toHaveLength(1);
  });

  it('400 (сообщения уже нет): запись снимается', async () => {
    const deletes = [{ id: 1, chat_id: 1, message_id: 77, delete_at: now() - 10 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, error_code: 400, description: 'message to delete not found' }, 400)));

    await processScheduledDeletes(envWith(makeDb({ user: baseUser(), deletes })));

    expect(deletes).toHaveLength(0);
  });

  it('сетевая ошибка: запись остаётся для повтора', async () => {
    const deletes = [{ id: 1, chat_id: 1, message_id: 77, delete_at: now() - 10 }];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    await processScheduledDeletes(envWith(makeDb({ user: baseUser(), deletes })));

    expect(deletes).toHaveLength(1);
  });
});

describe('birthdayDecision', () => {
  it('до 10:00 утра не отправляет', () => {
    expect(birthdayDecision('2026-10-09', '09:59', null)).toBe(false);
  });

  it('ровно в 10:00 отправляет, если сегодня ещё не отправляли', () => {
    expect(birthdayDecision('2026-10-09', '10:00', null)).toBe(true);
    expect(birthdayDecision('2026-10-09', '10:00', '2026-10-08')).toBe(true);
  });

  it('не отправляет повторно в тот же день', () => {
    expect(birthdayDecision('2026-10-09', '10:30', '2026-10-09')).toBe(false);
  });

  it('отправляет на следующий день в 10:00', () => {
    expect(birthdayDecision('2026-10-10', '10:00', '2026-10-09')).toBe(true);
  });
});

describe('formatBirthdayNotification', () => {
  it('форматирует поздравление для одной клиентки с контактами', () => {
    const clients = [
      {
        name: 'Светлана',
        phone: '+373 69 123456',
        telegram: '@sveta',
        notes: 'Аллергия на липкий слой',
      },
    ];
    const text = formatBirthdayNotification(clients);
    expect(text).toContain('У клиентки <b>Светлана</b> сегодня день рождения!');
    expect(text).toContain('📞 +373 69 123456');
    expect(text).toContain('https://t.me/sveta');
    expect(text).toContain('Аллергия на липкий слой');
  });

  it('форматирует поздравление для нескольких именинниц', () => {
    const clients = [
      { name: 'Анна', phone: '+79991234567' },
      { name: 'Елена', telegram: 'elena' },
    ];
    const text = formatBirthdayNotification(clients);
    expect(text).toContain('Сегодня день рождения у ваших клиентов:');
    expect(text).toContain('<b>Анна</b>');
    expect(text).toContain('<b>Елена</b>');
  });

  it('возвращает пустую строку для пустого списка', () => {
    expect(formatBirthdayNotification([])).toBe('');
  });
});
