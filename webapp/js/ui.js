import { tg } from './telegram.js';
import { state } from './state.js';

// ===== Уведомления (Toast) и тактильный отклик =====
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/** @param {string} text */
export function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

/** @param {string} message @param {(confirmed:boolean)=>unknown} callback */
export function confirmDialog(message, callback) {
  const context = state.contextVersion;
  /** @param {boolean} confirmed */
  const complete = confirmed => {
    if (context !== state.contextVersion) return showToast('Мастер изменён. Повторите действие');
    return callback(confirmed);
  };
  if (tg?.showConfirm) {
    tg.showConfirm(message, complete);
  } else {
    const ok = window.confirm(message);
    complete(ok);
  }
}

/** @param {unknown} s */
export function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
