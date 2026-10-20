#!/usr/bin/env node
// Запускаем Vitest отдельно: файлы SQLite удаляются после освобождения нативных дескрипторов.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tempParent = path.resolve(tmpdir());
const testRoot = mkdtempSync(path.join(tempParent, 'nail-planner-tests-'));
const testArgs = process.argv.slice(2);
// Нативный libSQL на Windows нестабилен при параллельном запуске процессов.
const workerArgs = process.platform === 'win32' && !testArgs.some(arg => /^--maxWorkers(?:=|$)/.test(arg))
  ? ['--maxWorkers=1'] : [];
let status = 1;

try {
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules',
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run',
    ...workerArgs,
    ...testArgs,
  ], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-vm-modules`, NAIL_PLANNER_TEST_TMP: testRoot },
  });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  // Удаляем только созданный этим запуском каталог непосредственно внутри системного Temp.
  if (path.dirname(path.resolve(testRoot)) !== tempParent || !path.basename(testRoot).startsWith('nail-planner-tests-')) {
    throw new Error('Некорректный путь временной папки тестов');
  }
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

process.exitCode = status;
