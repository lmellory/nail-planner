import { byId, all } from './dom.js';
import { requestGate, singleAction } from './requests.js';
import { state, todayStr } from './state.js';
import { addDays, fmt, formatApptTime, mondayOf, pad, parseDate } from './dates.js';
import { goScreen } from './navigation.js';
import { cachedClients, loadClientsDatalist } from './clients.js';
import { haptic } from './telegram.js';
import { api } from './api.js';
import { isService } from './labels.js';
import { confirmDialog, escapeHtml, showToast } from './ui.js';
import { loadSelectedDay, loadWeekSummary } from './schedule.js';

const conflictsRequest = requestGate();
let conflictSequence = 0;
// ===== 3. ФОРМА ЗАПИСИ (СОЗДАНИЕ / РЕДАКТИРОВАНИЕ) =====

/** @type {import('./contracts').Service} */
let selectedService = 'manicure';
/** @type {import('./contracts').Appointment['status']} */
let selectedStatus = 'scheduled'; // scheduled | no_show | cancelled

function updateStatusUI() {
  all('#status-selector .segment-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.status === selectedStatus);
  });
}
/** @type {import('../../src/types').Coating} */
let manicureCoating = 'gel';
/** @type {import('../../src/types').Coating} */
let pedicureCoating = 'gel';

/** @param {import('./contracts').FormPreset|null} [appt] */
export function openForm(appt = null) {
  clearTimeout(conflictCheckTimer);
  conflictSequence++;
  conflictsRequest();
  state.editingAppointmentId = appt && appt.id ? appt.id : null;

  const formTitle = byId('form-screen-title', 'h2');
  const apptId = byId('form-appt-id', 'input');
  const dateInput = byId('form-appt-date', 'input');
  const startInput = byId('form-appt-start', 'input');
  const clientInput = byId('form-appt-client', 'input');
  const whoInput = byId('form-appt-who', 'input');
  const commentInput = byId('form-appt-comment', 'textarea');
  const priceInput = byId('form-appt-price', 'input');
  const deleteBtn = byId('btn-delete-appt', 'button');
  const quickTomorrowBtn = byId('btn-quick-tomorrow', 'button');
  const conflictAlert = byId('conflict-alert', 'div');

  if (conflictAlert) conflictAlert.style.display = 'none';

  if (appt && appt.id) {
    if (formTitle) formTitle.textContent = 'Редактирование записи';
    if (apptId) apptId.value = String(appt.id);
    if (dateInput) dateInput.value = String(appt.date);
    if (startInput) startInput.value = String(appt.start_time);
    if (clientInput) clientInput.value = String(appt.client_name);
    if (whoInput) whoInput.value = String(appt.who || '');
    if (commentInput) commentInput.value = String(appt.comment || '');
    if (priceInput) priceInput.value = String(appt.price ?? '');
    selectedService = appt.service || 'manicure';
    selectedStatus = appt.status || 'scheduled';
    updateStatusUI();
    manicureCoating = appt.manicure_coating || 'gel';
    pedicureCoating = appt.pedicure_coating || 'gel';
    if (deleteBtn) deleteBtn.style.display = 'block';
    if (quickTomorrowBtn) quickTomorrowBtn.style.display = 'block';
  } else {
    if (formTitle) formTitle.textContent = 'Новая запись';
    if (apptId) apptId.value = '';
    if (dateInput) dateInput.value = String(appt?.date || state.selectedDate);

    // Начальное время
    if (appt?.start_time) {
      if (startInput) startInput.value = String(appt.start_time);
    } else {
      const now = new Date();
      let defHour = 10;
      if (state.selectedDate === todayStr) {
        defHour = Math.min(Math.max(now.getHours() + 1, 9), 20);
      }
      if (startInput) startInput.value = `${pad(defHour)}:00`;
    }

    if (clientInput) clientInput.value = String(appt?.client_name || '');
    if (whoInput) whoInput.value = '';
    if (commentInput) commentInput.value = '';
    if (priceInput) priceInput.value = String(state.prices.manicure ?? '');
    selectedService = 'manicure';
    selectedStatus = 'scheduled';
    updateStatusUI();
    manicureCoating = 'gel';
    pedicureCoating = 'gel';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (quickTomorrowBtn) quickTomorrowBtn.style.display = 'none';
  }

  updateServiceAndCoatingUI();
  updateClientMatchBadge();
  goScreen('form');
  checkConflicts();
}

function updateClientMatchBadge() {
  const clientInput = byId('form-appt-client', 'input');
  const badge = byId('client-match-badge', 'div');
  if (!clientInput || !badge) return;

  const val = clientInput.value.trim().toLowerCase();
  if (!val) {
    badge.style.display = 'none';
    return;
  }

  const match = cachedClients.find((c) => c.name.toLowerCase() === val);
  if (match) {
    const parts = [];
    if (match.phone) parts.push(`📞 ${match.phone}`);
    if (match.notes) parts.push(`💬 ${match.notes}`);
    badge.innerHTML = `✨ <b>Клиент из базы:</b> ${parts.join(' · ') || 'Контакты не указаны'}`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

byId('form-appt-client', 'input')?.addEventListener('input', updateClientMatchBadge);

function updateServiceAndCoatingUI() {
  // Селектор услуги
  all('#service-selector .segment-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.service === selectedService);
  });

  const manGroup = byId('group-manicure-coating', 'div');
  const pedGroup = byId('group-pedicure-coating', 'div');

  if (selectedService === 'manicure') {
    if (manGroup) manGroup.style.display = 'block';
    if (pedGroup) pedGroup.style.display = 'none';
  } else if (selectedService === 'pedicure') {
    if (manGroup) manGroup.style.display = 'none';
    if (pedGroup) pedGroup.style.display = 'block';
  } else if (selectedService === 'both') {
    if (manGroup) manGroup.style.display = 'block';
    if (pedGroup) pedGroup.style.display = 'block';
  } else if (selectedService === 'manicure_fingers' || selectedService === 'fingers') {
    // «Маникюр + пальцы» (и старая услуга «пальцы») — без выбора покрытия
    if (manGroup) manGroup.style.display = 'none';
    if (pedGroup) pedGroup.style.display = 'none';
  }

  // Чипы покрытия маникюра
  all('#manicure-coating-selector .coating-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coating === manicureCoating);
  });
  // Чипы покрытия педикюра
  all('#pedicure-coating-selector .coating-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coating === pedicureCoating);
  });
}

// Подстановка цены из прайса при смене услуги. Цену, которую мастер вписал вручную, не трогаем:
// заменяем значение, только если поле пустое или там цена прежней услуги из прайса.
/** @param {import('./contracts').Service} prevService */
function autofillPrice(prevService) {
  const el = byId('form-appt-price', 'input');
  if (!el) return;
  const cur = el.value.trim();
  const prevAuto = state.prices[prevService] != null ? String(state.prices[prevService]) : '';
  if (cur === '' || cur === prevAuto) el.value = String(state.prices[selectedService] ?? '');
}

// Выбор статуса записи
all('#status-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const status = btn.dataset.status;
    if (status !== 'scheduled' && status !== 'no_show' && status !== 'cancelled') return;
    selectedStatus = status;
    updateStatusUI();
    checkConflicts();
  });
});

// Нажатия на кнопки переключения услуг и покрытий
all('#service-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const prevService = selectedService;
    const service = btn.dataset.service;
    if (!isService(service)) return;
    selectedService = service;
    autofillPrice(prevService);
    updateServiceAndCoatingUI();
    checkConflicts();
  });
});

all('#manicure-coating-selector .coating-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const coating = btn.dataset.coating;
    if (coating !== 'gel' && coating !== 'none') return;
    manicureCoating = coating;
    updateServiceAndCoatingUI();
  });
});

all('#pedicure-coating-selector .coating-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const coating = btn.dataset.coating;
    if (coating !== 'gel' && coating !== 'none') return;
    pedicureCoating = coating;
    updateServiceAndCoatingUI();
  });
});

// Проверка пересечений по времени перед сохранением
/** @type {ReturnType<typeof setTimeout> | undefined} */
let conflictCheckTimer;
async function checkConflicts() {
  clearTimeout(conflictCheckTimer);
  const sequence = ++conflictSequence;
  const request = conflictsRequest();
  conflictCheckTimer = setTimeout(async () => {
    const date = byId('form-appt-date', 'input')?.value;
    const start = byId('form-appt-start', 'input')?.value;
    const excludeId = state.editingAppointmentId || 0;
    const alertEl = byId('conflict-alert', 'div');
    const alertText = byId('conflict-alert-text', 'div');

    if (!date || !start) {
      if (alertEl) alertEl.style.display = 'none';
      return;
    }

    try {
/** @type {{conflicts: import('./contracts').Appointment[]}} */
      const res = await api('/appointments/check', {
        method: 'POST',
        signal: request.signal,
        body: JSON.stringify({
          date,
          start_time: start,
          service: selectedService,
          exclude_id: excludeId,
        }),
      });

      if (!request.current() || sequence !== conflictSequence || state.currentScreen !== 'form') return;
      if (res.conflicts && res.conflicts.length > 0) {
        haptic('warning');
        const listStr = res.conflicts
          .map((c) => `• <b>${formatApptTime(c)}</b>: ${escapeHtml(c.client_name)}`)
          .join('<br>');
        if (alertText) alertText.innerHTML = listStr;
        if (alertEl) alertEl.style.display = 'flex';
      } else {
        if (alertEl) alertEl.style.display = 'none';
      }
    } catch {}
  }, 350);
}

byId('form-appt-date', 'input')?.addEventListener('change', checkConflicts);
byId('form-appt-start', 'input')?.addEventListener('change', checkConflicts);

// Сохранение записи
export function saveAppointment() {
  return singleAction('saveAppointment', ["btn-submit-appt"], performSaveAppointment);
}

async function performSaveAppointment() {
  const date = byId('form-appt-date', 'input')?.value;
  const start_time = byId('form-appt-start', 'input')?.value;
  const client_name = byId('form-appt-client', 'input')?.value?.trim();
  const who = byId('form-appt-who', 'input')?.value?.trim() || null;
  const comment = byId('form-appt-comment', 'textarea')?.value?.trim() || null;

  if (!date) return showToast('Укажите дату');
  if (!start_time) return showToast('Укажите время приема');
  if (!client_name) return showToast('Укажите имя клиента');

  const priceEl = byId('form-appt-price', 'input');
  // Браузер стирает value у нечислового ввода («1e», «--»): ловим это, чтобы не сохранить запись молча без цены
  if (priceEl?.validity?.badInput) return showToast('Цена — целое число, например 800');
  const priceRaw = priceEl?.value?.trim() ?? '';
  let price = null;
  if (priceRaw !== '') {
    price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0) return showToast('Цена — целое число, например 800');
  }

  const payload = {
    date,
    start_time,
    client_name,
    who,
    service: selectedService,
    manicure_coating: (selectedService === 'manicure' || selectedService === 'both') ? manicureCoating : null,
    pedicure_coating: (selectedService === 'pedicure' || selectedService === 'both') ? pedicureCoating : null,
    comment,
    price,
    status: selectedStatus,
  };

  try {
    if (state.editingAppointmentId) {
      await api(`/appointments/${state.editingAppointmentId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Запись обновлена ✅');
    } else {
      await api('/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Запись добавлена ✅');
    }

    haptic('success');
    state.selectedDate = date;
    state.weekStart = fmt(mondayOf(parseDate(date)));

    // Обновляем список клиентов в фоне, чтобы автоподстановка сразу знала нового клиента
    loadClientsDatalist().catch(() => {});

    await loadWeekSummary();
    await loadSelectedDay();
    // Показываем расписание после обновления данных: следующая форма уже сможет сохраняться.
    goScreen('main');
  } catch (err) {
    console.error('Ошибка сохранения записи:', err);
  }
}

// Удаление записи
async function deleteAppointment() {
  if (!state.editingAppointmentId) return;
  const id = state.editingAppointmentId;
  confirmDialog('Удалить эту запись безвозвратно?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/appointments/${id}`, { method: 'DELETE' });
      haptic('success');
      showToast('Запись удалена');
      goScreen('main');
      await loadWeekSummary();
      await loadSelectedDay();
    } catch (err) {
      console.error('Ошибка удаления записи:', err);
    }
  });
}

byId('btn-quick-tomorrow', 'button')?.addEventListener('click', () => {
  const dateInput = byId('form-appt-date', 'input');
  if (!dateInput || !dateInput.value) return;
  haptic('medium');
  dateInput.value = String(addDays(dateInput.value, 1));
  showToast('Дата сдвинута на +1 день ⏩');
  checkConflicts();
});
byId('btn-submit-appt', 'button')?.addEventListener('click', saveAppointment);
byId('btn-delete-appt', 'button')?.addEventListener('click', deleteAppointment);
byId('btn-cancel-appt', 'button')?.addEventListener('click', () => goScreen('main'));
byId('btn-add-appt', 'button')?.addEventListener('click', () => {
  haptic('light');
  openForm(null);
});
