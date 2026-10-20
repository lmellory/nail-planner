import { requestGate, singleAction } from './requests.js';
import { state, todayStr } from './state.js';
import { addDays, fmt, formatApptTime, mondayOf, pad, parseDate } from './dates.js';
import { goScreen } from './navigation.js';
import { cachedClients, loadClientsDatalist } from './clients.js';
import { haptic } from './telegram.js';
import { api } from './api.js';
import { confirmDialog, escapeHtml, showToast } from './ui.js';
import { loadSelectedDay, loadWeekSummary } from './schedule.js';

const conflictsRequest = requestGate();
let conflictSequence = 0;
// ===== 3. ФОРМА ЗАПИСИ (СОЗДАНИЕ / РЕДАКТИРОВАНИЕ) =====

let selectedService = 'manicure';
let selectedStatus = 'scheduled'; // scheduled | no_show | cancelled

function updateStatusUI() {
  document.querySelectorAll('#status-selector .segment-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.status === selectedStatus);
  });
}
let manicureCoating = 'gel';
let pedicureCoating = 'gel';

export function openForm(appt = null) {
  clearTimeout(conflictCheckTimer);
  conflictSequence++;
  conflictsRequest();
  state.editingAppointmentId = appt && appt.id ? appt.id : null;

  const formTitle = document.getElementById('form-screen-title');
  const apptId = document.getElementById('form-appt-id');
  const dateInput = document.getElementById('form-appt-date');
  const startInput = document.getElementById('form-appt-start');
  const clientInput = document.getElementById('form-appt-client');
  const whoInput = document.getElementById('form-appt-who');
  const commentInput = document.getElementById('form-appt-comment');
  const priceInput = document.getElementById('form-appt-price');
  const deleteBtn = document.getElementById('btn-delete-appt');
  const quickTomorrowBtn = document.getElementById('btn-quick-tomorrow');
  const conflictAlert = document.getElementById('conflict-alert');

  if (conflictAlert) conflictAlert.style.display = 'none';

  if (appt && appt.id) {
    if (formTitle) formTitle.textContent = 'Редактирование записи';
    if (apptId) apptId.value = appt.id;
    if (dateInput) dateInput.value = appt.date;
    if (startInput) startInput.value = appt.start_time;
    if (clientInput) clientInput.value = appt.client_name;
    if (whoInput) whoInput.value = appt.who || '';
    if (commentInput) commentInput.value = appt.comment || '';
    if (priceInput) priceInput.value = appt.price ?? '';
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
    if (dateInput) dateInput.value = appt?.date || state.selectedDate;

    // Начальное время
    if (appt?.start_time) {
      if (startInput) startInput.value = appt.start_time;
    } else {
      const now = new Date();
      let defHour = 10;
      if (state.selectedDate === todayStr) {
        defHour = Math.min(Math.max(now.getHours() + 1, 9), 20);
      }
      if (startInput) startInput.value = `${pad(defHour)}:00`;
    }

    if (clientInput) clientInput.value = appt?.client_name || '';
    if (whoInput) whoInput.value = '';
    if (commentInput) commentInput.value = '';
    if (priceInput) priceInput.value = state.prices.manicure ?? '';
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
  const clientInput = document.getElementById('form-appt-client');
  const badge = document.getElementById('client-match-badge');
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

document.getElementById('form-appt-client')?.addEventListener('input', updateClientMatchBadge);

function updateServiceAndCoatingUI() {
  // Селектор услуги
  document.querySelectorAll('#service-selector .segment-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.service === selectedService);
  });

  const manGroup = document.getElementById('group-manicure-coating');
  const pedGroup = document.getElementById('group-pedicure-coating');

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
  document.querySelectorAll('#manicure-coating-selector .coating-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coating === manicureCoating);
  });
  // Чипы покрытия педикюра
  document.querySelectorAll('#pedicure-coating-selector .coating-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coating === pedicureCoating);
  });
}

// Подстановка цены из прайса при смене услуги. Цену, которую мастер вписал вручную, не трогаем:
// заменяем значение, только если поле пустое или там цена прежней услуги из прайса.
function autofillPrice(prevService) {
  const el = document.getElementById('form-appt-price');
  if (!el) return;
  const cur = el.value.trim();
  const prevAuto = state.prices[prevService] != null ? String(state.prices[prevService]) : '';
  if (cur === '' || cur === prevAuto) el.value = state.prices[selectedService] ?? '';
}

// Выбор статуса записи
document.querySelectorAll('#status-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    selectedStatus = btn.dataset.status;
    updateStatusUI();
    checkConflicts();
  });
});

// Нажатия на кнопки переключения услуг и покрытий
document.querySelectorAll('#service-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const prevService = selectedService;
    selectedService = btn.dataset.service;
    autofillPrice(prevService);
    updateServiceAndCoatingUI();
    checkConflicts();
  });
});

document.querySelectorAll('#manicure-coating-selector .coating-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    manicureCoating = btn.dataset.coating;
    updateServiceAndCoatingUI();
  });
});

document.querySelectorAll('#pedicure-coating-selector .coating-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    pedicureCoating = btn.dataset.coating;
    updateServiceAndCoatingUI();
  });
});

// Проверка пересечений по времени перед сохранением
let conflictCheckTimer = null;
async function checkConflicts() {
  clearTimeout(conflictCheckTimer);
  const sequence = ++conflictSequence;
  const request = conflictsRequest();
  conflictCheckTimer = setTimeout(async () => {
    const date = document.getElementById('form-appt-date')?.value;
    const start = document.getElementById('form-appt-start')?.value;
    const excludeId = state.editingAppointmentId || 0;
    const alertEl = document.getElementById('conflict-alert');
    const alertText = document.getElementById('conflict-alert-text');

    if (!date || !start) {
      if (alertEl) alertEl.style.display = 'none';
      return;
    }

    try {
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

document.getElementById('form-appt-date')?.addEventListener('change', checkConflicts);
document.getElementById('form-appt-start')?.addEventListener('change', checkConflicts);

// Сохранение записи
export function saveAppointment() {
  return singleAction('saveAppointment', ["btn-submit-appt"], performSaveAppointment);
}

async function performSaveAppointment() {
  const date = document.getElementById('form-appt-date')?.value;
  const start_time = document.getElementById('form-appt-start')?.value;
  const client_name = document.getElementById('form-appt-client')?.value?.trim();
  const who = document.getElementById('form-appt-who')?.value?.trim() || null;
  const comment = document.getElementById('form-appt-comment')?.value?.trim() || null;

  if (!date) return showToast('Укажите дату');
  if (!start_time) return showToast('Укажите время приема');
  if (!client_name) return showToast('Укажите имя клиента');

  const priceEl = document.getElementById('form-appt-price');
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

document.getElementById('btn-quick-tomorrow')?.addEventListener('click', () => {
  const dateInput = document.getElementById('form-appt-date');
  if (!dateInput || !dateInput.value) return;
  haptic('medium');
  dateInput.value = addDays(dateInput.value, 1);
  showToast('Дата сдвинута на +1 день ⏩');
  checkConflicts();
});
document.getElementById('btn-submit-appt')?.addEventListener('click', saveAppointment);
document.getElementById('btn-delete-appt')?.addEventListener('click', deleteAppointment);
document.getElementById('btn-cancel-appt')?.addEventListener('click', () => goScreen('main'));
document.getElementById('btn-add-appt')?.addEventListener('click', () => {
  haptic('light');
  openForm(null);
});
