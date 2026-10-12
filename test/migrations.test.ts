import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, MIGRATIONS_DIR, migrate, REPO_ROOT } from './helpers/harness';

let cleanup: Array<() => void> = [];
afterEach(() => { cleanup.forEach((f) => f()); cleanup = []; });
const open = async (opts?: { upTo?: string }) => { const t = await createTestDb(opts); cleanup.push(t.close); return t; };

const columns = async (client: any, table: string) =>
  (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r: any) => String(r.name));

describe('миграции', () => {
  it('все применяются на пустой базе, повторный запуск ничего не меняет', async () => {
    const { client } = await open();
    const versions = (await client.execute('SELECT version FROM schema_migrations ORDER BY version')).rows.map((r) => String(r.version));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace('.sql', '')).sort();
    expect(versions).toEqual(files);

    await migrate(client);
    const again = (await client.execute('SELECT COUNT(*) AS n FROM schema_migrations')).rows[0].n;
    expect(Number(again)).toBe(files.length);
  });

  it('итоговая схема содержит всё нужное приложению', async () => {
    const { client } = await open();
    expect(await columns(client, 'appointments')).toEqual(expect.arrayContaining(['price', 'status', 'end_time', 'who']));
    expect(await columns(client, 'users')).toEqual(expect.arrayContaining(['backup_enabled', 'last_backup_date']));
    for (const t of ['expenses', 'service_prices', 'clients', 'day_notes']) expect((await columns(client, t)).length).toBeGreaterThan(0);
  });

  it('0012: данные сохраняются, status = scheduled, CHECK на услугу снят, остальные ограничения целы', async () => {
    const { client } = await open({ upTo: '0011_prices_and_backup' });
    await client.batch([
      { sql: "INSERT INTO appointments (user_id,date,start_time,end_time,client_name,who,service,manicure_coating,pedicure_coating,comment,price) VALUES (1,'2026-10-05','10:00','12:00','Инна','подруга','manicure','gel',NULL,'коммент',800)" },
      { sql: "INSERT INTO appointments (user_id,date,start_time,end_time,client_name,service,manicure_coating,pedicure_coating,price) VALUES (1,'2026-10-06','12:00',NULL,'Мария','both','none','gel',NULL)" },
      { sql: "INSERT INTO appointments (user_id,date,start_time,client_name,service,price) VALUES (2,'2026-10-07','09:00','Чужая','fingers',300)" },
    ], 'write');
    const snapshot = async () => (await client.execute(
      'SELECT id,user_id,date,start_time,end_time,client_name,who,service,manicure_coating,pedicure_coating,comment,price FROM appointments ORDER BY id',
    )).rows.map((r) => ({ ...r }));
    const before = await snapshot();
    expect(before).toHaveLength(3);

    await migrate(client);
    expect(await snapshot()).toEqual(before);
    const statuses = (await client.execute('SELECT DISTINCT status FROM appointments')).rows.map((r) => r.status);
    expect(statuses).toEqual(['scheduled']);

    const insert = (extra: string, vals: string) =>
      client.execute(`INSERT INTO appointments (user_id,date,start_time,client_name,service${extra}) VALUES (1,'2026-10-08','10:00','X','hairdo'${vals})`);
    await insert('', ''); // неизвестная услуга больше не отклоняется
    await expect(client.execute("INSERT INTO appointments (user_id,date,start_time,client_name,service,manicure_coating) VALUES (1,'2026-10-08','10:00','X','manicure','x')")).rejects.toThrow();
    await expect(client.execute("INSERT INTO appointments (user_id,date,start_time,client_name,service,price) VALUES (1,'2026-10-08','10:00','X','manicure',-1)")).rejects.toThrow();
    await expect(client.execute("INSERT INTO appointments (user_id,date,start_time,end_time,client_name,service) VALUES (1,'2026-10-08','10:00','09:00','X','manicure')")).rejects.toThrow();
    const idx = (await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='appointments'")).rows.map((r) => r.name);
    expect(idx).toContain('idx_appt_user_date');
  });

  it('scripts/migrate.js: сломанная миграция откатывается целиком и скрипт завершается с ошибкой', async () => {
    const t = await open({ upTo: '0012_status_free_service' });
    const dir = path.join(t.dir, 'migs');
    mkdirSync(dir);
    for (const f of readdirSync(MIGRATIONS_DIR)) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    writeFileSync(path.join(dir, '9999_broken.sql'), 'ALTER TABLE appointments ADD COLUMN temp_col TEXT;\nINSERT INTO no_such_table VALUES (1);\n');

    const run = spawnSync(process.execPath, ['scripts/migrate.js'], {
      cwd: REPO_ROOT, encoding: 'utf8',
      env: { ...process.env, MIGRATE_DB_URL: t.url, MIGRATIONS_DIR: dir },
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('9999_broken.sql');
    expect(await columns(t.client, 'appointments')).not.toContain('temp_col');
    const broken = (await t.client.execute("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='9999_broken'")).rows[0].n;
    expect(Number(broken)).toBe(0);
  });
});
