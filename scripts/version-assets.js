#!/usr/bin/env node
// Одна версия всех скриптов и стилей меняется при изменении любого из них.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function versionAssets(webappDir = fileURLToPath(new URL('../webapp/', import.meta.url))) {
  const indexPath = path.join(webappDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const pattern = /(src|href)="(\/(?!\/)[^"?]+\.(?:css|js))(?:\?[^"\s]*)?"/g;
  const assets = [...new Set([...html.matchAll(pattern)].map((m) => m[2]))].sort();
  if (!assets.length) throw new Error('В index.html не найдены локальные скрипты и стили');

  const hash = createHash('sha256');
  const visited = new Set();
  function visit(asset) {
    if (visited.has(asset)) return;
    const file = path.resolve(webappDir, asset.slice(1));
    if (!file.startsWith(path.resolve(webappDir) + path.sep)) throw new Error('Файл за пределами webapp');
    visited.add(asset);
    const source = readFileSync(file, 'utf8');
    if (asset.endsWith('.js')) {
      for (const match of source.matchAll(/(?:import\s+(?:[^;'"()]*?\s+from\s*)?|export\s+[^;'"()]*?\s+from\s*)['"](\.[^'"]+)['"]/g)) {
        const dependency = '/' + path.posix.normalize(path.posix.join(path.posix.dirname(asset), match[1])).replace(/^\//, '');
        visit(dependency);
      }
    }
  }
  assets.forEach(visit);
  for (const asset of [...visited].sort()) {
    hash.update(asset + '\0').update(readFileSync(path.join(webappDir, asset.slice(1))));
  }
  const version = hash.digest('hex').slice(0, 12);
  const updated = html.replace(pattern, (_match, attr, asset) => `${attr}="${asset}?v=${version}"`);
  if (updated !== html) writeFileSync(indexPath, updated);
  return { version, changed: updated !== html, assets: assets.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = versionAssets();
  console.log(`Версия статики: ${result.version} (${result.assets} файлов${result.changed ? ', index.html обновлён' : ''})`);
}
