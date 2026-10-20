import { tg } from './telegram.js';
import { state } from './state.js';
import { showToast } from './ui.js';

/** Запрос к API. Подпись Telegram передаётся в заголовке X-Init-Data */
export async function api(path, options = {}) {
  const write = options.method && options.method !== 'GET' && options.method !== 'HEAD' && path !== '/appointments/check';
  if (write) state.pendingWrites++;
  try {
    return await request(path, options);
  } finally {
    if (write) state.pendingWrites--;
  }
}

async function request(path, options) {
  const initData = tg?.initData || '';
  const context = state.contextVersion;
  let res;
  try {
    res = await fetch('/api' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Init-Data': initData,
        // Админ правит записи выбранного мастера: сервер выполнит запрос над его данными (и только для записей)
        ...(state.actAs ? { 'X-Act-As': String(state.actAs) } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    if (context !== state.contextVersion) throw new DOMException('Контекст изменился', 'AbortError');
    if (err.name === 'AbortError') throw err;
    showToast('Ошибка сети');
    throw err;
  }
  if (context !== state.contextVersion) throw new DOMException('Контекст изменился', 'AbortError');
  if (res.status === 403) {
    const overlay = document.getElementById('session-expired-overlay');
    if (overlay) overlay.style.display = 'flex';
    else showToast('Сессия Telegram устарела. Перезапустите приложение');
    throw new Error('Сессия устарела');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || 'Ошибка ' + res.status;
    showToast(msg);
    throw new Error(msg);
  }
  const data = await res.json();
  if (context !== state.contextVersion) throw new DOMException('Контекст изменился', 'AbortError');
  return data;
}
