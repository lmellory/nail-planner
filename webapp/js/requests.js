import { state } from './state.js';
import { tg } from './telegram.js';

/** Последний запрос побеждает; смена мастера делает прежний ответ неактуальным. */
export function requestGate() {
  let sequence = 0;
  /** @type {AbortController | undefined} */
  let controller;
  return () => {
    const id = ++sequence;
    const context = state.contextVersion;
    controller?.abort();
    controller = new AbortController();
    return { signal: controller.signal, current: () => id === sequence && context === state.contextVersion };
  };
}

/** @type {Map<string, Promise<unknown>>} */
const actions = new Map();
/** Одна операция сохранения, даже если нажаты и кнопка формы, и кнопка Telegram. */
/** @template T @param {string} key @param {string[]} buttonIds @param {()=>T|Promise<T>} action @returns {Promise<T>} */
export function singleAction(key, buttonIds, action) {
  if (actions.has(key)) return /** @type {Promise<T>} */ (actions.get(key));
  const buttons = buttonIds.map(id => document.getElementById(id)).filter(button => button instanceof HTMLButtonElement);
  const disabled = buttons.map(button => button.disabled);
  const labels = buttons.map(button => button.innerHTML);
  const controls = [...new Set(buttons.flatMap(button => [...(button.closest('[data-draft]')?.querySelectorAll('input, textarea, select, button') || [])]))]
    .filter(el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement);
  const controlStates = controls.map(el => el.disabled);
  buttons.forEach(button => {
    button.closest('[data-draft]')?.querySelector('.save-error')?.remove();
    button.disabled = true;
    button.textContent = 'Сохраняем…';
    button.setAttribute('aria-busy', 'true');
  });
  controls.forEach(el => { el.disabled = true; });
  if (key === 'saveDayNote') tg?.MainButton?.showProgress?.();
  state.pendingWrites++;
  const task = Promise.resolve().then(action).finally(() => {
    actions.delete(key);
    state.pendingWrites--;
    if (key === 'saveDayNote') tg?.MainButton?.hideProgress?.();
    controls.forEach((el, index) => { el.disabled = controlStates[index]; });
    buttons.forEach((button, index) => {
      button.disabled = disabled[index];
      button.innerHTML = labels[index];
      button.removeAttribute('aria-busy');
    });
  });
  actions.set(key, task);
  return task;
}

/** @param {unknown} error */
export function isAbortError(error) { return error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError'; }
