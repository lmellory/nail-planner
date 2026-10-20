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

export let cachedClients = [];
let currentViewingClientId = null;

export async function loadClientsDatalist() {
  const request = datalistRequest();
  try {
    const clients = await api('/clients', { signal: request.signal });
    if (!request.current()) return;
    cachedClients = clients;
    const dl = document.getElementById('clients-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    for (const c of cachedClients) {
      const opt = document.createElement('option');
      opt.value = c.name;
      if (c.phone) opt.label = c.phone;
      dl.appendChild(opt);
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('Ошибка обновления подсказок клиентов', e);
  }
}

async function loadClients(search = '') {
  const request = clientsRequest();
  const listEl = document.getElementById('clients-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-spinner">Загрузка клиентов…</div>';

  try {
    const clients = await api(`/clients?q=${encodeURIComponent(search)}`, { signal: request.signal });
    if (!request.current()) return;
    cachedClients = clients;
    renderClientsList(cachedClients);
  } catch (err) {
    if (err.name === 'AbortError' || !request.current()) return;
    console.error('Ошибка загрузки клиентов:', err);
    listEl.innerHTML = '<div class="empty-state"><p>Ошибка загрузки клиентов</p></div>';
  }
}

const MONTH_NAMES_RU = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

function formatBirthdayRu(ddmm) {
  if (!ddmm) return '';
  const [d, m] = ddmm.split('.');
  const day = Number(d);
  const month = Number(m);
  if (!day || !month || !MONTH_NAMES_RU[month]) return ddmm;
  return `${day} ${MONTH_NAMES_RU[month]}`;
}

function isBirthdayToday(ddmm) {
  if (!ddmm) return false;
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return ddmm === `${d}.${m}`;
}

function initBirthdaySelectors() {
  const daySelect = document.getElementById('edit-client-bday-day');
  if (!daySelect || daySelect.options.length > 1) return;
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement('option');
    const val = String(i).padStart(2, '0');
    opt.value = val;
    opt.textContent = i;
    daySelect.appendChild(opt);
  }
}

document.getElementById('btn-clear-bday')?.addEventListener('click', () => {
  const d = document.getElementById('edit-client-bday-day');
  const m = document.getElementById('edit-client-bday-month');
  if (d) d.value = '';
  if (m) m.value = '';
});

function renderClientsList(items) {
  const listEl = document.getElementById('clients-list');
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

async function openClientView(id) {
  const request = clientViewRequest();
  currentViewingClientId = id;
  const modal = document.getElementById('modal-client-view');
  const nameEl = document.getElementById('modal-client-name');
  const bdayRow = document.getElementById('client-view-bday-row');
  const bdayText = document.getElementById('client-view-bday-text');
  const phoneRow = document.getElementById('client-view-phone-row');
  const phoneLink = document.getElementById('client-view-phone-link');
  const tgRow = document.getElementById('client-view-tg-row');
  const tgLink = document.getElementById('client-view-tg-link');
  const notesBox = document.getElementById('client-view-notes-box');
  const notesText = document.getElementById('client-view-notes-text');
  const historyCount = document.getElementById('client-history-count');
  const historyList = document.getElementById('client-history-list');

  try {
    const data = await api(`/clients/${id}`, { signal: request.signal });
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
    if (err.name === 'AbortError') return;
    console.error('Ошибка загрузки карточки клиента:', err);
  }
}

function closeClientView() {
  clientViewRequest();
  const modal = document.getElementById('modal-client-view');
  if (modal) modal.style.display = 'none';
}

function openClientEdit(client = null) {
  closeClientView();
  initBirthdaySelectors();

  const modal = document.getElementById('modal-client-edit');
  const title = document.getElementById('modal-client-edit-title');
  const idInput = document.getElementById('edit-client-id');
  const nameInput = document.getElementById('edit-client-name');
  const bdayDay = document.getElementById('edit-client-bday-day');
  const bdayMonth = document.getElementById('edit-client-bday-month');
  const phoneInput = document.getElementById('edit-client-phone');
  const tgInput = document.getElementById('edit-client-tg');
  const notesInput = document.getElementById('edit-client-notes');

  if (client) {
    if (title) title.textContent = 'Редактировать клиента';
    if (idInput) idInput.value = client.id;
    if (nameInput) nameInput.value = client.name;
    if (phoneInput) phoneInput.value = client.phone || '';
    if (tgInput) tgInput.value = client.telegram || '';
    if (notesInput) notesInput.value = client.notes || '';

    if (client.birthday) {
      const [d, m] = client.birthday.split('.');
      if (bdayDay) bdayDay.value = d || '';
      if (bdayMonth) bdayMonth.value = m || '';
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
  setTimeout(() => nameInput?.focus(), 100);
}

function closeClientEdit() {
  const modal = document.getElementById('modal-client-edit');
  if (modal) modal.style.display = 'none';
}

function saveClientModal() {
  return singleAction('saveClientModal', ["btn-save-client"], performSaveClientModal);
}

async function performSaveClientModal() {
  const id = document.getElementById('edit-client-id')?.value;
  const name = document.getElementById('edit-client-name')?.value?.trim();
  const phone = document.getElementById('edit-client-phone')?.value?.trim() || null;
  const telegram = document.getElementById('edit-client-tg')?.value?.trim() || null;
  const notes = document.getElementById('edit-client-notes')?.value?.trim() || null;

  const bdayDay = document.getElementById('edit-client-bday-day')?.value;
  const bdayMonth = document.getElementById('edit-client-bday-month')?.value;
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
let clientSearchDebounce = null;
document.getElementById('input-clients-search')?.addEventListener('input', (e) => {
  clearTimeout(clientSearchDebounce);
  const q = e.target.value;
  clientSearchDebounce = setTimeout(() => {
    loadClients(q);
  }, 250);
});

// События кнопок модуля клиентов
document.getElementById('btn-open-clients')?.addEventListener('click', () => {
  haptic('light');
  goScreen('clients');
  loadClients();
});
document.getElementById('btn-back-from-clients')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});
document.getElementById('btn-add-client')?.addEventListener('click', () => {
  haptic('light');
  openClientEdit(null);
});
document.getElementById('btn-close-client-view')?.addEventListener('click', closeClientView);
document.getElementById('btn-close-client-edit')?.addEventListener('click', closeClientEdit);
document.getElementById('btn-cancel-client-edit')?.addEventListener('click', closeClientEdit);
document.getElementById('btn-save-client')?.addEventListener('click', saveClientModal);

document.getElementById('btn-client-edit')?.addEventListener('click', () => {
  const client = cachedClients.find((c) => c.id === currentViewingClientId);
  if (client) openClientEdit(client);
});
document.getElementById('btn-client-delete')?.addEventListener('click', deleteClientModal);
document.getElementById('btn-client-book')?.addEventListener('click', () => {
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
