import { isAbortError } from './requests.js';
import { getApi } from './api-contracts.js';
import { byId } from './dom.js';
import { requestGate, singleAction } from './requests.js';
import { api } from './api.js';
import { confirmDialog, escapeHtml, showToast } from './ui.js';
import { haptic } from './telegram.js';
import { serviceName } from './labels.js';
import { formatApptTime } from './dates.js';
import { goScreen } from './navigation.js';
import { openForm } from './appointment-form.js';

const clientsRequest = requestGate();
const datalistRequest = requestGate();
const clientViewRequest = requestGate();
// ===== 8. БАЗА КЛИЕНТОВ =====

/** @type {import('./contracts').Client[]} */
export let cachedClients = [];
/** @type {number|null} */
let currentViewingClientId = null;

export async function loadClientsDatalist() {
  const request = datalistRequest();
  try {
    const clients = await getApi('/clients', { signal: request.signal });
    if (!request.current()) return;
    cachedClients = clients;
    const dl = byId('clients-datalist', 'datalist');
    if (!dl) return;
    dl.innerHTML = '';
    for (const c of cachedClients) {
      const opt = document.createElement('option');
      opt.value = String(c.name);
      if (c.phone) opt.label = c.phone;
      dl.appendChild(opt);
    }
  } catch (e) {
    if (isAbortError(e)) return;
    console.error('Ошибка обновления подсказок клиентов', e);
  }
}

async function loadClients(search = '') {
  const request = clientsRequest();
  const listEl = byId('clients-list', 'div');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-spinner">Загрузка клиентов…</div>';

  try {
    const clients = await getApi(`/clients?q=${encodeURIComponent(search)}`, { signal: request.signal });
    if (!request.current()) return;
    cachedClients = clients;
    renderClientsList(cachedClients);
  } catch (err) {
    if (isAbortError(err) || !request.current()) return;
    console.error('Ошибка загрузки клиентов:', err);
    listEl.innerHTML = '<div class="empty-state"><p>Ошибка загрузки клиентов</p></div>';
  }
}

const MONTH_NAMES_RU = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

/** @param {string|null|undefined} ddmm */
function formatBirthdayRu(ddmm) {
  if (!ddmm) return '';
  const [d, m] = ddmm.split('.');
  const day = Number(d);
  const month = Number(m);
  if (!day || !month || !MONTH_NAMES_RU[month]) return ddmm;
  return `${day} ${MONTH_NAMES_RU[month]}`;
}

/** @param {string|null|undefined} ddmm */
function isBirthdayToday(ddmm) {
  if (!ddmm) return false;
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return ddmm === `${d}.${m}`;
}

function initBirthdaySelectors() {
  const daySelect = byId('edit-client-bday-day', 'select');
  if (!daySelect || daySelect.options.length > 1) return;
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement('option');
    const val = String(i).padStart(2, '0');
    opt.value = String(val);
    opt.textContent = String(i);
    daySelect.appendChild(opt);
  }
}

byId('btn-clear-bday', 'button')?.addEventListener('click', () => {
  const d = byId('edit-client-bday-day', 'select');
  const m = byId('edit-client-bday-month', 'select');
  if (d) d.value = '';
  if (m) m.value = '';
});

/** @param {import('./contracts').Client[]} items */
function renderClientsList(items) {
  const listEl = byId('clients-list', 'div');
  if (!listEl) return;

  if (!items || !items.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">👥</div>
        <div class="empty-state-title">Клиентов пока нет</div>
        <p>Нажмите «+ Новый», чтобы добавить клиента в базу</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  for (const c of items) {
    const card = document.createElement('div');
    card.className = 'client-card';

    const contacts = [];
    if (c.phone) contacts.push(`📞 ${escapeHtml(c.phone)}`);
    if (c.telegram) contacts.push(`💬 @${escapeHtml(c.telegram.replace(/^@/, ''))}`);
    if (c.last_visit) contacts.push(`Посл. визит: ${c.last_visit}`);

    let bdayHtml = '';
    if (c.birthday) {
      if (isBirthdayToday(c.birthday)) {
        bdayHtml = `<span class="client-card-bday today">🎉 Сегодня ДР!</span>`;
      } else {
        bdayHtml = `<span class="client-card-bday">🎂 ${formatBirthdayRu(c.birthday)}</span>`;
      }
    }

    const noteHtml = c.notes ? `<div class="client-card-note">💡 ${escapeHtml(c.notes)}</div>` : '';

    card.innerHTML = `
      <div class="client-card-top">
        <span class="client-card-name">${escapeHtml(c.name)} ${bdayHtml}</span>
        <span class="client-card-visits">${c.appointments_count || 0} виз.</span>
      </div>
      <div class="client-card-contacts">${contacts.join(' · ') || 'Контакты не указаны'}</div>
      ${noteHtml}
    `;

    card.addEventListener('click', () => {
      haptic('light');
      openClientView(c.id);
    });

    listEl.appendChild(card);
  }
}

/** @param {number} id */
async function openClientView(id) {
  const request = clientViewRequest();
  currentViewingClientId = id;
  const modal = byId('modal-client-view', 'div');
  const nameEl = byId('modal-client-name', 'h3');
  const bdayRow = byId('client-view-bday-row', 'div');
  const bdayText = byId('client-view-bday-text', 'span');
  const phoneRow = byId('client-view-phone-row', 'div');
  const phoneLink = byId('client-view-phone-link', 'a');
  const tgRow = byId('client-view-tg-row', 'div');
  const tgLink = byId('client-view-tg-link', 'a');
  const notesBox = byId('client-view-notes-box', 'div');
  const notesText = byId('client-view-notes-text', 'p');
  const historyCount = byId('client-history-count', 'span');
  const historyList = byId('client-history-list', 'div');

  try {
    const data = await getApi(`/clients/${id}`, { signal: request.signal });
    if (!request.current() || currentViewingClientId !== id) return;
    const client = data.client;
    const history = data.history || [];

    if (nameEl) nameEl.textContent = client.name;

    if (client.birthday && bdayRow && bdayText) {
      bdayRow.style.display = 'flex';
      if (isBirthdayToday(client.birthday)) {
        bdayText.className = 'client-view-bday-badge today';
        bdayText.textContent = `🎉 Сегодня день рождения! (${formatBirthdayRu(client.birthday)})`;
      } else {
        bdayText.className = 'client-view-bday-badge';
        bdayText.textContent = `День рождения: ${formatBirthdayRu(client.birthday)}`;
      }
    } else if (bdayRow) {
      bdayRow.style.display = 'none';
    }

    if (client.phone && phoneRow && phoneLink) {
      phoneRow.style.display = 'flex';
      phoneLink.textContent = client.phone;
      phoneLink.href = `tel:${client.phone}`;
    } else if (phoneRow) {
      phoneRow.style.display = 'none';
    }

    if (client.telegram && tgRow && tgLink) {
      const cleanTg = client.telegram.replace(/^@/, '');
      tgRow.style.display = 'flex';
      tgLink.textContent = `@${cleanTg}`;
      tgLink.href = `https://t.me/${cleanTg}`;
    } else if (tgRow) {
      tgRow.style.display = 'none';
    }

    if (client.notes && notesBox && notesText) {
      notesBox.style.display = 'block';
      notesText.textContent = client.notes;
    } else if (notesBox) {
      notesBox.style.display = 'none';
    }

    if (historyCount) historyCount.textContent = `${history.length}`;
    if (historyList) {
      if (!history.length) {
        historyList.innerHTML = '<div style="color: var(--hint-color); font-size: 13px;">Записей пока нет</div>';
      } else {
        historyList.innerHTML = '';
        for (const a of history) {
          const item = document.createElement('div');
          item.className = 'history-item';
          const sRu = serviceName(a.service);
          item.innerHTML = `
            <span><b>${a.date}</b> (${formatApptTime(a)}) · ${sRu}</span>
            ${a.comment ? `<span style="color: var(--hint-color);">💬</span>` : ''}
          `;
          historyList.appendChild(item);
        }
      }
    }

    if (modal) modal.style.display = 'flex';
  } catch (err) {
    if (isAbortError(err)) return;
    console.error('Ошибка загрузки карточки клиента:', err);
  }
}

function closeClientView() {
  clientViewRequest();
  const modal = byId('modal-client-view', 'div');
  if (modal) modal.style.display = 'none';
}

/** @param {import('./contracts').Client|null} [client] */
function openClientEdit(client = null) {
  closeClientView();
  initBirthdaySelectors();

  const modal = byId('modal-client-edit', 'div');
  const title = byId('modal-client-edit-title', 'h3');
  const idInput = byId('edit-client-id', 'input');
  const nameInput = byId('edit-client-name', 'input');
  const bdayDay = byId('edit-client-bday-day', 'select');
  const bdayMonth = byId('edit-client-bday-month', 'select');
  const phoneInput = byId('edit-client-phone', 'input');
  const tgInput = byId('edit-client-tg', 'input');
  const notesInput = byId('edit-client-notes', 'textarea');

  if (client) {
    if (title) title.textContent = 'Редактировать клиента';
    if (idInput) idInput.value = String(client.id);
    if (nameInput) nameInput.value = String(client.name);
    if (phoneInput) phoneInput.value = String(client.phone || '');
    if (tgInput) tgInput.value = String(client.telegram || '');
    if (notesInput) notesInput.value = String(client.notes || '');

    if (client.birthday) {
      const [d, m] = client.birthday.split('.');
      if (bdayDay) bdayDay.value = String(d || '');
      if (bdayMonth) bdayMonth.value = String(m || '');
    } else {
      if (bdayDay) bdayDay.value = '';
      if (bdayMonth) bdayMonth.value = '';
    }
  } else {
    if (title) title.textContent = 'Новый клиент';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (tgInput) tgInput.value = '';
    if (notesInput) notesInput.value = '';
    if (bdayDay) bdayDay.value = '';
    if (bdayMonth) bdayMonth.value = '';
  }

  if (modal) modal.style.display = 'flex';
  setTimeout(() => {
    if (modal?.style.display !== 'flex' || modal.contains(document.activeElement)) return;
    nameInput?.focus();
  }, 100);
}

function closeClientEdit() {
  const modal = byId('modal-client-edit', 'div');
  if (modal) modal.style.display = 'none';
}

function saveClientModal() {
  return singleAction('saveClientModal', ["btn-save-client"], performSaveClientModal);
}

async function performSaveClientModal() {
  const id = byId('edit-client-id', 'input')?.value;
  const name = byId('edit-client-name', 'input')?.value?.trim();
  const phone = byId('edit-client-phone', 'input')?.value?.trim() || null;
  const telegram = byId('edit-client-tg', 'input')?.value?.trim() || null;
  const notes = byId('edit-client-notes', 'textarea')?.value?.trim() || null;

  const bdayDay = byId('edit-client-bday-day', 'select')?.value;
  const bdayMonth = byId('edit-client-bday-month', 'select')?.value;
  let birthday = null;
  if (bdayDay && bdayMonth) {
    birthday = `${bdayDay}.${bdayMonth}`;
  } else if (bdayDay || bdayMonth) {
    return showToast('Укажите и день, и месяц рождения');
  }

  if (!name) return showToast('Укажите имя клиента');

  try {
    if (id) {
      await api(`/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, phone, telegram, notes, birthday }),
      });
      showToast('Клиент обновлён ✅');
    } else {
      await api('/clients', {
        method: 'POST',
        body: JSON.stringify({ name, phone, telegram, notes, birthday }),
      });
      showToast('Клиент добавлен ✅');
    }

    haptic('success');
    closeClientEdit();
    await loadClients();
    await loadClientsDatalist();
  } catch (err) {
    console.error('Ошибка сохранения клиента:', err);
  }
}

async function deleteClientModal() {
  if (!currentViewingClientId) return;
  const id = currentViewingClientId;
  confirmDialog('Удалить этого клиента из базы?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/clients/${id}`, { method: 'DELETE' });
      haptic('success');
      showToast('Клиент удалён');
      closeClientView();
      await loadClients();
      await loadClientsDatalist();
    } catch (err) {
      console.error('Ошибка удаления клиента:', err);
    }
  });
}

// Поиск клиентов в реальном времени
/** @type {ReturnType<typeof setTimeout> | undefined} */
let clientSearchDebounce;
byId('input-clients-search', 'input')?.addEventListener('input', (e) => {
  clearTimeout(clientSearchDebounce);
  const q = byId('input-clients-search', 'input').value;
  clientSearchDebounce = setTimeout(() => {
    loadClients(q);
  }, 250);
});

// События кнопок модуля клиентов
byId('btn-open-clients', 'button')?.addEventListener('click', () => {
  haptic('light');
  goScreen('clients');
  loadClients();
});
byId('btn-back-from-clients', 'button')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});
byId('btn-add-client', 'button')?.addEventListener('click', () => {
  haptic('light');
  openClientEdit(null);
});
byId('btn-close-client-view', 'button')?.addEventListener('click', closeClientView);
byId('btn-close-client-edit', 'button')?.addEventListener('click', closeClientEdit);
byId('btn-cancel-client-edit', 'button')?.addEventListener('click', closeClientEdit);
byId('btn-save-client', 'button')?.addEventListener('click', saveClientModal);

byId('btn-client-edit', 'button')?.addEventListener('click', () => {
  const client = cachedClients.find((c) => c.id === currentViewingClientId);
  if (client) openClientEdit(client);
});
byId('btn-client-delete', 'button')?.addEventListener('click', deleteClientModal);
byId('btn-client-book', 'button')?.addEventListener('click', () => {
  const client = cachedClients.find((c) => c.id === currentViewingClientId);
  closeClientView();
  haptic('light');
  openForm({ client_name: client?.name || '' });
});

export function resetClientCache() {
  cachedClients = [];
  currentViewingClientId = null;
  clientViewRequest();
  for (const id of ['clients-datalist', 'clients-list']) document.getElementById(id)?.replaceChildren();
  closeClientView();
  closeClientEdit();
}
