import { state } from './state.js';

/** Последний запрос побеждает; смена мастера делает прежний ответ неактуальным. */
export function requestGate() {
  let sequence = 0;
  let controller;
  return () => {
    const id = ++sequence;
    const context = state.contextVersion;
    controller?.abort();
    controller = new AbortController();
    return { signal: controller.signal, current: () => id === sequence && context === state.contextVersion };
  };
}

const actions = new Map();
/** Одна операция сохранения, даже если нажаты и кнопка формы, и кнопка Telegram. */
export function singleAction(key, buttonIds, action) {
  if (actions.has(key)) return actions.get(key);
  const buttons = buttonIds.map(id => document.getElementById(id)).filter(Boolean);
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
