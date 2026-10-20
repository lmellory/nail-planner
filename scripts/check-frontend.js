// Проверка синтаксиса, свободных имён и связей ES modules без браузерных глобальных переменных проекта.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [path.join(root, 'webapp/app.js'), ...fs.readdirSync(path.join(root, 'webapp/js')).filter(name => /\.(js|d\.ts)$/.test(name)).map(name => path.join(root, 'webapp/js', name))];
const typeContracts = path.join(root, 'test/types/frontend.ts');
files.push(typeContracts);
const program = ts.createProgram(files, {
  allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], skipLibCheck: true,
  strict: true,
});
// Сервер проверяется отдельно с типами Cloudflare; здесь — весь интерфейс без исключений по коду ошибки.
const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics().filter(d => {
  if (!d.file) return true;
  const relative = path.relative(root, d.file.fileName).split(path.sep).join('/');
  return relative === 'test/types/frontend.ts' || relative.startsWith('webapp/');
})];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else {
  console.log(`Строго проверены все ${files.filter(file => file.endsWith('.js')).length} модулей интерфейса и контракты API.`);
}
