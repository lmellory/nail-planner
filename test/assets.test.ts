import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { versionAssets } from '../scripts/version-assets.js';

const dirs: string[] = [];
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'np-assets-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'js'));
  writeFileSync(path.join(dir, 'index.html'), '<script src="https://telegram.org/js/telegram-web-app.js"></script>\n<link href="/style.css" rel="stylesheet">\n<script src="/js/core.js"></script>\n<script src="/app.js"></script>');
  writeFileSync(path.join(dir, 'style.css'), 'body {}');
  writeFileSync(path.join(dir, 'js/core.js'), 'const state = {};');
  writeFileSync(path.join(dir, 'app.js'), 'init();');
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('np-assets-')) {
      throw new Error('Некорректный путь временной папки');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('версии статики', () => {
  it('учитывает CSS imports: изменение вложенного стиля обновляет версию, отсутствующий файл останавливает выкладку', () => {
    const dir = fixture();
    mkdirSync(path.join(dir, 'css'));
    writeFileSync(path.join(dir, 'style.css'), "@import url('./css/forms.css');");
    writeFileSync(path.join(dir, 'css/forms.css'), '.form-input { width: 100%; }');
    const first = versionAssets(dir);
    writeFileSync(path.join(dir, 'css/forms.css'), '.form-input { width: 90%; }');
    expect(versionAssets(dir).version).not.toBe(first.version);
    rmSync(path.join(dir, 'css/forms.css'));
    expect(() => versionAssets(dir)).toThrow();
  });
  it('учитывает вложенные ES imports, включая циклы, и отвергает отсутствующую зависимость', () => {
    const dir = fixture();
    writeFileSync(path.join(dir, 'app.js'), "import './js/core.js';");
    writeFileSync(path.join(dir, 'js/core.js'), "import { value } from './nested.js';");
    writeFileSync(path.join(dir, 'js/nested.js'), "import './core.js'; export const value = 1;");
    const first = versionAssets(dir);
    writeFileSync(path.join(dir, 'js/nested.js'), "import './core.js'; export const value = 2;");
    expect(versionAssets(dir).version).not.toBe(first.version);
    writeFileSync(path.join(dir, 'js/nested.js'), "import './missing.js';");
    expect(() => versionAssets(dir)).toThrow();
  });
  it('обновляет все локальные ссылки при изменении вложенного модуля; повторный запуск стабилен', () => {
    const dir = fixture();
    const first = versionAssets(dir);
    const initialHtml = readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(first.assets).toBe(3);
    expect(initialHtml.match(new RegExp(`\\?v=${first.version}`, 'g'))).toHaveLength(3);
    expect(initialHtml).toContain('src="https://telegram.org/js/telegram-web-app.js"');
    expect(versionAssets(dir)).toMatchObject({ version: first.version, changed: false });

    writeFileSync(path.join(dir, 'js/core.js'), 'const state = { updated: true };');
    const next = versionAssets(dir);
    expect(next.version).not.toBe(first.version);
    const updatedHtml = readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(updatedHtml).not.toContain(first.version);
    expect(updatedHtml.match(new RegExp(`\\?v=${next.version}`, 'g'))).toHaveLength(3);
  });

  it('останавливает подготовку выкладки при отсутствии подключённого файла', () => {
    const dir = fixture();
    const missing = path.join(dir, 'js/core.js');
    rmSync(missing);
    expect(() => versionAssets(dir)).toThrow();
    expect(readFileSync(path.join(dir, 'index.html'), 'utf8')).not.toContain('?v=');
  });
});
