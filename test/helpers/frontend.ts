import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';
import type { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../../webapp/', import.meta.url));

/** Настоящий граф ES modules в контексте jsdom, включая циклические импорты. */
export async function loadFrontend(dom: JSDOM, entry = 'app.js') {
  const modules = new Map<string, SourceTextModule>();
  const get = (file: string): SourceTextModule => {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root)) throw new Error('Module outside webapp');
    if (modules.has(absolute)) return modules.get(absolute)!;
    const module = new SourceTextModule(readFileSync(absolute, 'utf8'), {
      context: dom.getInternalVMContext(), identifier: absolute,
    });
    modules.set(absolute, module);
    return module;
  };
  const module = get(entry);
  await module.link((specifier, parent) => get(path.resolve(path.dirname(parent.identifier), specifier)));
  await module.evaluate();
  return (file: string) => get(file).namespace as Record<string, any>;
}
