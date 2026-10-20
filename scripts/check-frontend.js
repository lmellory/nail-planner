// Проверка синтаксиса, свободных имён и связей ES modules без браузерных глобальных переменных проекта.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [path.join(root, 'webapp/app.js'), ...fs.readdirSync(path.join(root, 'webapp/js')).filter(name => /\.(js|d\.ts)$/.test(name)).map(name => path.join(root, 'webapp/js', name))];
// Остальные экраны пока проверяются на синтаксис и импорты. Этот список расширяем по мере типизации.
const fullyChecked = new Set(['state.js', 'api.js', 'api-contracts.js', 'dom.js', 'settings.js', 'prices.js']);
const typeContracts = path.join(root, 'test/types/frontend.ts');
files.push(typeContracts);
const program = ts.createProgram(files, {
  allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], skipLibCheck: true,
  strict: true,
});
// Для ещё не типизированных экранов оставляем проверку имён и границ модулей.
const moduleErrors = new Set([2304, 2305, 2307, 2459, 2552, 2614, 2724]);
const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics().filter(d => {
  if (!d.file) return true;
  const relative = path.relative(root, d.file.fileName).split(path.sep).join('/');
  return relative === 'test/types/frontend.ts' ||
    relative.startsWith('webapp/js/') && fullyChecked.has(path.basename(d.file.fileName)) ||
    relative.startsWith('webapp/') && moduleErrors.has(d.code);
})];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else {
  console.log(`Проверены синтаксис и импорты интерфейса; полная строгая проверка типов ${fullyChecked.size} модулей.`);
}
