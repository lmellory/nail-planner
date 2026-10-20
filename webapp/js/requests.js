import { state } from './state.js';

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
  buttons.forEach(button => { button.disabled = true; });
  state.pendingWrites++;
  const task = Promise.resolve().then(action).finally(() => {
    actions.delete(key);
    state.pendingWrites--;
    buttons.forEach((button, index) => { button.disabled = disabled[index]; });
  });
  actions.set(key, task);
  return task;
}

/** @param {unknown} error */
export function isAbortError(error) { return error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError'; }
