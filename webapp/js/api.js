import { tg } from './telegram.js';
import { state } from './state.js';
import { showToast } from './ui.js';

/**
 * Запрос к API. Подпись Telegram передаётся в заголовке X-Init-Data.
 * @template [T=unknown]
 * @param {string} path
 * @param {Omit<RequestInit, 'headers'> & {headers?: Record<string, string>}} [options]
 * @returns {Promise<T>}
 */
export async function api(path, options = {}) {
  const write = options.method && options.method !== 'GET' && options.method !== 'HEAD' && path !== '/appointments/check';
  if (write) state.pendingWrites++;
  try {
    return /** @type {T} */ (await request(path, options));
  } finally {
    if (write) state.pendingWrites--;
  }
}

/** @param {string} path @param {Omit<RequestInit, 'headers'> & {headers?: Record<string, string>}} options @returns {Promise<unknown>} */
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
        ...(state.actAs ? { 'X-Act-As': String(state.actAs) } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    if (context !== state.contextVersion) throw new DOMException('Контекст изменился', 'AbortError');
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') throw err;
    showToast('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз');
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
    const err = /** @type {unknown} */ (await res.json().catch(() => null));
    const msg = res.status >= 500 ? 'Сервис временно недоступен. Попробуйте ещё раз чуть позже' : err && typeof err === 'object' && 'error' in err && typeof err.error === 'string'
      ? err.error : 'Ошибка ' + res.status;
    showToast(msg);
    throw new Error(msg);
  }
  const data = await res.json();
  if (context !== state.contextVersion) throw new DOMException('Контекст изменился', 'AbortError');
  return data;
}
