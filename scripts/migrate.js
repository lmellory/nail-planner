import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getTursoCredentials() {
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
  return {
    url: urlMatch[1].replace('libsql://', 'https://') + '/v2/pipeline',
    token: tokenMatch[1],
  };
}

async function executeSqls(httpUrl, token, sqls) {
  const requests = sqls.map((sql) => ({ type: 'execute', stmt: { sql } }));
  requests.push({ type: 'close' });

  const res = await fetch(httpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

function parseStatements(sqlContent) {
  const lines = sqlContent.split('\n');
  const cleanLines = lines.map((l) => {
    const trimmed = l.trim();
    if (trimmed.startsWith('--')) return '';
    return l;
  });
  const cleanSql = cleanLines.join('\n');
  return cleanSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'BEGIN' && s !== 'COMMIT');
}

async function main() {
  const { url, token } = getTursoCredentials();
  console.log('Connecting to Turso...');

  await executeSqls(url, token, [
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ]);

  const res = await executeSqls(url, token, ['SELECT version FROM schema_migrations ORDER BY version']);
  const rows = res.results?.[0]?.response?.result?.rows || [];
  const appliedVersions = new Set(rows.map((r) => r[0]?.value));

  console.log('Already applied migrations:', Array.from(appliedVersions).join(', ') || 'none');

  const migrationsDir = path.resolve(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (appliedVersions.has(version)) {
      continue;
    }

    console.log(`\nApplying migration: ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    const stmts = parseStatements(sqlContent);

    for (const stmt of stmts) {
      console.log('  Executing:', stmt.slice(0, 70).replace(/\s+/g, ' ') + '...');
      const execRes = await executeSqls(url, token, [stmt]);
      const result = execRes.results?.[0];
      if (result?.type === 'error') {
        console.error('ERROR executing statement:', stmt, result.error);
        throw new Error(result.error?.message || 'SQL Error');
      }
    }

    await executeSqls(url, token, [
      `INSERT OR IGNORE INTO schema_migrations (version) VALUES ('${version}')`,
    ]);
    console.log(`Migration ${file} successfully applied!`);
  }

  console.log('\nAll migrations are up to date! ✅');
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
