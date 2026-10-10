// Применяет SQL-миграции из папки migrations/ к базе Turso.
// Каждая миграция выполняется ОДНОЙ транзакцией вместе с записью в schema_migrations:
// если любой запрос упал — откатывается вся миграция целиком, база остаётся как была.
//
// Доступ берётся из .dev.vars (TURSO_URL, TURSO_AUTH_TOKEN).
// Для проверки на локальной базе можно задать MIGRATE_DB_URL (например file:/tmp/test.db)
// и MIGRATIONS_DIR (другая папка с миграциями).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getConnection() {
  if (process.env.MIGRATE_DB_URL) {
    return { url: process.env.MIGRATE_DB_URL, authToken: process.env.MIGRATE_DB_TOKEN || undefined };
  }
  const envPath = path.resolve(__dirname, '..', '.dev.vars');
  if (!fs.existsSync(envPath)) {
    throw new Error('.dev.vars file not found');
  }
  const env = fs.readFileSync(envPath, 'utf8');
  const urlMatch = env.match(/TURSO_URL=["']?([^"'\r\n]+)/);
  const tokenMatch = env.match(/TURSO_AUTH_TOKEN=["']?([^"'\r\n]+)/);
  if (!urlMatch || !tokenMatch) {
    throw new Error('TURSO_URL or TURSO_AUTH_TOKEN not found in .dev.vars');
  }
  // https:// вместо libsql:// — обычный HTTP, без WebSocket
  return { url: urlMatch[1].replace('libsql://', 'https://'), authToken: tokenMatch[1] };
}

/** Делит файл на отдельные запросы. BEGIN/COMMIT вырезаются: транзакцию открывает сам скрипт. */
export function parseStatements(sqlContent) {
  const cleanSql = sqlContent
    .split('\n')
    .map((l) => (l.trim().startsWith('--') ? '' : l))
    .join('\n');
  return cleanSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

async function main() {
  const db = createClient(getConnection());
  console.log('Connecting to database...');

  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = await db.execute('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map((r) => String(r.version)));
  console.log('Already applied migrations:', Array.from(appliedVersions).join(', ') || 'none');

  const migrationsDir = process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : path.resolve(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (appliedVersions.has(version)) continue;

    console.log(`\nApplying migration: ${file}...`);
    const stmts = parseStatements(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    for (const stmt of stmts) {
      console.log('  Statement:', stmt.slice(0, 70).replace(/\s+/g, ' ') + '...');
    }

    try {
      await db.batch(
        [
          ...stmts.map((sql) => ({ sql })),
          { sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', args: [version] },
        ],
        'write', // одна транзакция: при ошибке откатывается всё
      );
    } catch (err) {
      throw new Error(`${file}: ${err.message} (изменения этой миграции откатены)`);
    }
    console.log(`Migration ${file} successfully applied!`);
  }

  console.log('\nAll migrations are up to date! ✅');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  });
}
