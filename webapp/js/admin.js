import { getApi } from './api-contracts.js';
import { byId, all } from './dom.js';
import { api } from './api.js';
import { state, todayStr } from './state.js';
import { escapeHtml, showToast } from './ui.js';
import { goScreen } from './navigation.js';
import { fmt, mondayOf } from './dates.js';
import { loadClientsDatalist, resetClientCache } from './clients.js';
import { loadPrices } from './prices.js';
import { loadSelectedDay, loadWeekSummary, renderAppointmentsList, renderWeekStrip } from './schedule.js';
import { haptic } from './telegram.js';
import { leaveDrafts } from './drafts.js';

// ===== 8. АДМИН-ПАНЕЛЬ =====
// Администратор выбирает мастера и дальше работает с обычным расписанием этого мастера: добавляет, меняет,
// удаляет записи. Каждый запрос уходит с заголовком X-Act-As (см. api()); сервер проверяет права и пускает
// только к записям. Пока режим включён, доходы, клиенты, настройки и заметки скрыты.

export async function loadMe() {
  try {
    const me = await getApi('/me');
    state.isAdmin = !!me.is_admin;
  } catch {
    state.isAdmin = false;
  }
  const btn = byId('btn-open-admin', 'button');
  if (btn) btn.style.display = state.isAdmin ? '' : 'none';
}

/** @param {import('./contracts').MasterRow} m */
function masterLabel(m) {
  return m.name || (m.username ? '@' + m.username : 'ID ' + m.user_id);
}

/** @param {import('./contracts').MasterRow[]} masters */
function renderAdminMasters(masters) {
  const list = byId('admin-masters-list', 'div');
  if (!list) return;
  if (!masters.length) {
    list.innerHTML = '<div class="empty-state">Мастеров пока нет</div>';
    return;
  }
  list.innerHTML = masters
    .map((m) => {
      const badge = m.banned
        ? '<span class="admin-badge is-banned">заблокирован</span>'
        : !m.has_access
          ? '<span class="admin-badge">нет доступа</span>'
          : '';
      const last = m.last_appointment ? ` · последняя запись ${escapeHtml(m.last_appointment)}` : '';
      return `
        <div class="client-card admin-master-card" data-id="${m.user_id}">
          <div class="client-card-top">
            <div class="client-card-name">${escapeHtml(masterLabel(m))} ${badge}</div>
            <div class="client-card-visits">${m.appointments}</div>
          </div>
          <div class="client-card-contacts">${m.username ? '@' + escapeHtml(m.username) + ' · ' : ''}ID ${m.user_id}</div>
          <div class="client-card-note">Записей: ${m.appointments}, впереди: ${m.upcoming}, клиентов: ${m.clients}${last}</div>
        </div>`;
    })
    .join('');
  all('.admin-master-card', list).forEach((el) => {
    el.addEventListener('click', () => {
      const m = masters.find((x) => String(x.user_id) === el.dataset.id);
      if (m) enterActAs(m);
    });
  });
}

async function openAdmin() {
  goScreen('admin');
  const list = byId('admin-masters-list', 'div');
  if (list) list.innerHTML = '<div class="empty-state">Загрузка…</div>';
  try {
    const data = await getApi('/admin/masters');
    renderAdminMasters(data.masters || []);
  } catch {
    if (list) list.innerHTML = '<div class="empty-state">Не удалось загрузить список мастеров</div>';
  }
}

/** Перечитывает всё, что зависит от «чьи данные»: расписание, подсказки клиентов, прайс. */
async function reloadScheduleData() {
  state.appointments = [];
  state.currentDayNote = '';
  state.editingAppointmentId = null;
  resetClientCache();
  for (const id of ['day-note-card', 'free-slots-card']) {
    const card = document.getElementById(id);
    if (card) card.style.display = 'none';
  }
  state.daySummaryMap = new Map();
  state.prices = {};
  state.selectedDate = todayStr;
  state.weekStart = fmt(mondayOf(new Date()));
  renderAppointmentsList();
  renderWeekStrip();
  loadClientsDatalist().catch(() => {});
  loadPrices().catch(() => {});
  await loadWeekSummary();
  await loadSelectedDay();
}

/** @param {boolean} on */
function setActAsUI(on) {
  document.body.classList.toggle('acting-as', on);
  const banner = byId('act-as-banner', 'div');
  const label = byId('act-as-label', 'b');
  if (label) label.textContent = on ? state.actAsLabel : '';
  if (banner) banner.style.display = on ? 'flex' : 'none';
}

/** @param {import('./contracts').MasterRow} master */
async function enterActAs(master) {
  if (state.pendingWrites) return showToast('Дождитесь завершения сохранения');
  haptic('medium');
  state.contextVersion++;
  state.actAs = master.user_id;
  state.actAsLabel = masterLabel(master);
  setActAsUI(true);
  goScreen('main');
  await reloadScheduleData();
}

async function exitActAs() {
  if (state.pendingWrites) return showToast('Дождитесь завершения сохранения');
  leaveDrafts(async () => {
    haptic('light');
    state.contextVersion++;
    state.actAs = null;
    state.actAsLabel = '';
    setActAsUI(false);
    goScreen('main');
    await reloadScheduleData();
  });
}

byId('btn-open-admin', 'button')?.addEventListener('click', () => {
  haptic('light');
  openAdmin();
});
byId('btn-act-as-exit', 'button')?.addEventListener('click', exitActAs);
