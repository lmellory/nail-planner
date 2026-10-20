import { state } from './state.js';
import { tg } from './telegram.js';
import { confirmDialog, showToast } from './ui.js';

/** @type {Map<string, {root: HTMLElement, baseline: string}>} */
const drafts = new Map();
let confirming = false;
/** @type {boolean | undefined} */
let closingProtected;

/** @param {HTMLElement} root */
function snapshot(root) {
  return JSON.stringify([...root.querySelectorAll('input, textarea, select, button[data-service], button[data-status], button[data-coating], button[data-day]')].map(el => {
    if (el instanceof HTMLInputElement) return [el.id, el.value, el.checked];
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return [el.id, el.value];
    return el.classList.contains('active');
  }));
}

function activeDrafts() {
  return [...drafts.entries()].filter(([, { root }]) => {
    const screen = root.closest('.screen');
    if (screen) return screen.classList.contains('active');
    return root.style.display === 'flex';
  });
}

export function hasUnsavedChanges() {
  return activeDrafts().some(([, draft]) => snapshot(draft.root) !== draft.baseline);
}

export function syncClosingProtection() {
  const dirty = hasUnsavedChanges();
  if (closingProtected === dirty) return;
  if (dirty) tg?.enableClosingConfirmation?.();
  else tg?.disableClosingConfirmation?.();
  closingProtected = dirty;
}

/** Отмечаем значения после загрузки или успешного сохранения, а не после ошибки.
 * @param {string} id */
export function rememberDraft(id) {
  const root = document.getElementById(id);
  if (root) {
    root.querySelector('.save-error')?.remove();
    drafts.set(id, { root, baseline: snapshot(root) });
  }
  syncClosingProtection();
}

/** @param {()=>void} action */
export function leaveDrafts(action) {
  if (!hasUnsavedChanges()) { action(); syncClosingProtection(); return; }
  if (state.pendingWrites) { showToast('Дождитесь завершения сохранения'); return; }
  if (confirming) return;
  confirming = true;
  const current = activeDrafts();
  confirmDialog('Есть несохранённые изменения. Выйти и не сохранять их?', confirmed => {
    confirming = false;
    if (!confirmed) return;
    for (const [id] of current) drafts.delete(id);
    action();
    syncClosingProtection();
  });
}

/** @param {string} id */
export function showSaveError(id) {
  const root = document.getElementById(id);
  if (!root) return;
  let message = root.querySelector('.save-error');
  if (!message) {
    message = document.createElement('p');
    message.className = 'save-error';
    message.setAttribute('role', 'alert');
    root.querySelector('.form-actions, .modal-footer')?.prepend(message);
    if (!message.parentElement) root.append(message);
  }
  message.textContent = 'Сохранение не подтверждено. Введённые данные остались в форме. Проверьте соединение и результат сохранения перед повторной попыткой.';
}

for (const event of ['input', 'change', 'click']) document.addEventListener(event, syncClosingProtection);
window.addEventListener('beforeunload', event => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
});
