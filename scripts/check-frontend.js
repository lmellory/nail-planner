// Проверка синтаксиса, свободных имён и связей ES modules без браузерных глобальных переменных проекта.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [path.join(root, 'webapp/app.js'), ...fs.readdirSync(path.join(root, 'webapp/js')).filter(name => name.endsWith('.js')).map(name => path.join(root, 'webapp/js', name))];
const program = ts.createProgram(files, {
  allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true,
});
// Полная проверка типов DOM требует отдельной типизации форм. Здесь проверяем именно границы модулей.
const moduleErrors = new Set([2304, 2305, 2307, 2459, 2552, 2614, 2724]);
const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics().filter(d => moduleErrors.has(d.code))];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else {
  console.log(`Проверены синтаксис, имена и импорты ${files.length} модулей интерфейса.`);
}
