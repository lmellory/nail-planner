import { tg } from './telegram.js';
import { state } from './state.js';

// ===== Уведомления (Toast) и тактильный отклик =====
let toastTimer = null;

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

export function confirmDialog(message, callback) {
  const context = state.contextVersion;
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

export function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
