// ==========================================================================
// Ежедневник мастера: Telegram Mini App Frontend (чистый JS, без сборки)
// ==========================================================================

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try {
    // Предотвращаем случайное закрытие приложения свайпом вниз при прокрутке расписания
    tg.disableVerticalSwipes?.();
  } catch {}

  const syncTgTheme = () => {
    const isDark = tg.colorScheme === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark-theme', isDark);
    const bg = tg.themeParams?.bg_color || (isDark ? '#1a1618' : '#fdf8f9');
    try {
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    } catch {}
  };

  syncTgTheme();
  tg.onEvent?.('themeChanged', syncTgTheme);
}

/** Запрос к API. Подпись Telegram передаётся в заголовке X-Init-Data */
async function api(path, options = {}) {
  const initData = tg?.initData || '';
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Init-Data': initData,
      ...(options.headers || {}),
    },
  });
  if (res.status === 403) {
    showToast('Нет доступа к приложению');
    throw new Error('Нет доступа');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || 'Ошибка ' + res.status;
    showToast(msg);
    throw new Error(msg);
  }
  return res.json();
}

// ===== Утилиты для работы с датами и временем =====
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function mondayOf(d) {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7; // 0 = Пн, 6 = Вс
  x.setDate(x.getDate() - wd);
  return x;
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
const RU_MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const RU_WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const RU_WEEKDAYS_FULL = [
  'Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'
];

function formatFullDateRu(dateStr) {
  const d = parseDate(dateStr);
  const weekday = RU_WEEKDAYS_FULL[d.getDay()];
  return `${weekday}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ===== Состояние приложения =====
const todayStr = fmt(new Date());

const state = {
  currentScreen: 'main',
  selectedDate: todayStr,
  weekStart: fmt(mondayOf(new Date())),
  appointments: [],
  daySummaryMap: new Map(), // date -> { count, has_note }
  currentDayNote: '',
  editingAppointmentId: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0..11
};

// ===== Уведомления (Toast) и тактильный отклик =====
let toastTimer = null;
function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

function haptic(type = 'light') {
  try {
    if (type === 'light' || type === 'medium' || type === 'heavy') {
      tg?.HapticFeedback?.impactOccurred(type);
    } else if (type === 'success' || type === 'warning' || type === 'error') {
      tg?.HapticFeedback?.notificationOccurred(type);
    }
  } catch {}
}

function confirmDialog(message, callback) {
  if (tg?.showConfirm) {
    tg.showConfirm(message, callback);
  } else {
    const ok = window.confirm(message);
    callback(ok);
  }
}

// ===== Управление экранами =====
function goScreen(name) {
  state.currentScreen = name;
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));

  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');

  const backBtn = document.getElementById('btn-back');
  const headerActions = document.getElementById('header-actions');
  const headerTitle = document.getElementById('header-title');

  if (name === 'main') {
    if (backBtn) backBtn.style.display = 'none';
    if (headerActions) headerActions.style.display = 'flex';
    if (headerTitle) headerTitle.textContent = 'Ежедневник';
    tg?.BackButton?.hide();
    tg?.MainButton?.hide();
  } else {
    if (backBtn) backBtn.style.display = 'flex';
    if (headerActions) headerActions.style.display = 'none';
    tg?.BackButton?.show();

    if (name === 'form') {
      if (headerTitle) headerTitle.textContent = state.editingAppointmentId ? 'Редактирование' : 'Новая запись';
      if (tg?.MainButton) {
        tg.MainButton.setParams({
          text: 'Сохранить запись',
          color: '#d86e88',
          text_color: '#ffffff',
          is_visible: true,
        });
      }
    } else if (name === 'calendar') {
      if (headerTitle) headerTitle.textContent = 'Календарь';
      tg?.MainButton?.hide();
    } else if (name === 'search') {
      if (headerTitle) headerTitle.textContent = 'Поиск';
      tg?.MainButton?.hide();
    } else if (name === 'note') {
      if (headerTitle) headerTitle.textContent = 'Заметка дня';
      if (tg?.MainButton) {
        tg.MainButton.setParams({
          text: 'Сохранить заметку',
          color: '#d86e88',
          text_color: '#ffffff',
          is_visible: true,
        });
      }
    } else if (name === 'settings') {
      if (headerTitle) headerTitle.textContent = 'Настройки';
      tg?.MainButton?.hide();
    }
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// Подключаем слушатели навигации Telegram WebApp
if (tg) {
  tg.BackButton?.onClick(() => goScreen('main'));
  tg.MainButton?.onClick(() => {
    if (state.currentScreen === 'form') saveAppointment();
    else if (state.currentScreen === 'note') saveDayNote();
  });
}

// ===== 1. ПОЛОСА НЕДЕЛИ И СПИСОК ДНЯ =====

async function loadWeekSummary() {
  const from = state.weekStart;
  const to = addDays(state.weekStart, 6);
  try {
    const summary = await api(`/days?from=${from}&to=${to}`);
    state.daySummaryMap.clear();
    for (const item of summary) {
      state.daySummaryMap.set(item.date, item);
    }
    renderWeekStrip();
  } catch (err) {
    console.error('Ошибка загрузки сводки дней:', err);
  }
}

function renderWeekStrip() {
  const strip = document.getElementById('week-strip');
  const periodLabel = document.getElementById('week-period-label');
  if (!strip) return;

  const mDate = parseDate(state.weekStart);
  const sundayDate = parseDate(addDays(state.weekStart, 6));

  if (periodLabel) {
    if (mDate.getMonth() === sundayDate.getMonth()) {
      periodLabel.textContent = `${mDate.getDate()} – ${sundayDate.getDate()} ${RU_MONTHS[mDate.getMonth()]} ${mDate.getFullYear()}`;
    } else {
      periodLabel.textContent = `${mDate.getDate()} ${RU_MONTHS[mDate.getMonth()]} – ${sundayDate.getDate()} ${RU_MONTHS[sundayDate.getMonth()]}`;
    }
  }

  strip.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const dateStr = addDays(state.weekStart, i);
    const d = parseDate(dateStr);
    const dayNum = d.getDate();
    const dayShort = RU_WEEKDAYS_SHORT[i];
    const isSelected = dateStr === state.selectedDate;
    const isToday = dateStr === todayStr;

    const summary = state.daySummaryMap.get(dateStr) || { count: 0, has_note: false };

    const col = document.createElement('div');
    col.className = `week-day-col ${isSelected ? 'selected' : ''} ${isToday ? 'is-today' : ''}`;
    col.setAttribute('data-date', dateStr);

    let dotsHtml = '';
    const dotsCount = Math.min(summary.count, 3);
    for (let dot = 0; dot < dotsCount; dot++) {
      dotsHtml += '<span class="appt-dot"></span>';
    }

    const noteBadge = summary.has_note ? '<span class="note-badge-icon">📝</span>' : '';

    col.innerHTML = `
      <span class="day-col-name">${dayShort}</span>
      <span class="day-col-num">${dayNum}</span>
      <div class="day-indicators">
        ${dotsHtml}
        ${noteBadge}
      </div>
    `;

    col.addEventListener('click', () => {
      haptic('light');
      selectDate(dateStr);
    });

    strip.appendChild(col);
  }
}

function selectDate(dateStr) {
  state.selectedDate = dateStr;
  const monday = fmt(mondayOf(parseDate(dateStr)));
  if (monday !== state.weekStart) {
    state.weekStart = monday;
    loadWeekSummary();
  } else {
    renderWeekStrip();
  }
  loadSelectedDay();
}

function shiftWeek(days) {
  haptic('light');
  state.weekStart = addDays(state.weekStart, days);
  // Переносим выбранный день на аналогичный день сдвинутой недели
  const currentOffset = Math.floor((parseDate(state.selectedDate) - parseDate(state.weekStart)) / (86400000));
  if (currentOffset < 0 || currentOffset > 6) {
    state.selectedDate = state.weekStart;
  }
  loadWeekSummary();
  loadSelectedDay();
}

// Свайп по полосе недели
let touchStartX = 0;
let touchStartY = 0;
const stripContainer = document.getElementById('week-strip-container');
if (stripContainer) {
  stripContainer.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  stripContainer.addEventListener('touchend', (e) => {
    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) shiftWeek(7);  // свайп влево -> следующая неделя
      else shiftWeek(-7);          // свайп вправо -> предыдущая неделя
    }
  }, { passive: true });
}

// ===== 2. ЗАПИСИ И ЗАМЕТКА ВЫБРАННОГО ДНЯ =====

async function loadSelectedDay() {
  const heading = document.getElementById('selected-day-heading');
  const sub = document.getElementById('selected-day-sub');
  const listEl = document.getElementById('appointments-list');
  const noteCard = document.getElementById('day-note-card');
  const noteContent = document.getElementById('day-note-content');
  const btnNoteText = document.getElementById('btn-day-note-text');

  if (heading) {
    heading.textContent = state.selectedDate === todayStr ? 'Сегодня' : formatFullDateRu(state.selectedDate);
  }
  if (sub) {
    sub.textContent = state.selectedDate === todayStr ? formatFullDateRu(state.selectedDate) : '';
  }

  // Загружаем записи и заметку дня
  try {
    const [appts, noteRes] = await Promise.all([
      api(`/appointments?from=${state.selectedDate}&to=${state.selectedDate}`),
      api(`/notes/${state.selectedDate}`),
    ]);

    state.appointments = appts;
    state.currentDayNote = noteRes?.text || '';

    // Отображение заметки
    if (state.currentDayNote.trim()) {
      if (noteCard) noteCard.style.display = 'block';
      if (noteContent) noteContent.textContent = state.currentDayNote;
      if (btnNoteText) btnNoteText.textContent = 'Заметка 📝';
    } else {
      if (noteCard) noteCard.style.display = 'none';
      if (btnNoteText) btnNoteText.textContent = 'Заметка';
    }

    // Отображение списка записей
    renderAppointmentsList();
  } catch (err) {
    console.error('Ошибка загрузки дня:', err);
    if (listEl) {
      listEl.innerHTML = '<div class="empty-state"><p>Ошибка загрузки записей</p></div>';
    }
  }
}

function renderAppointmentsList() {
  const listEl = document.getElementById('appointments-list');
  if (!listEl) return;

  if (!state.appointments.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">🌸</div>
        <div class="empty-state-title">Записей нет</div>
        <p>Нажмите «+» внизу экрана, чтобы добавить клиента</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  for (const a of state.appointments) {
    const card = document.createElement('div');
    card.className = 'appointment-card';
    card.setAttribute('data-id', a.id);

    const whoHtml = a.who ? `<span class="appt-card-who">${escapeHtml(a.who)}</span>` : '';

    let serviceRu = 'Маникюр';
    if (a.service === 'pedicure') serviceRu = 'Педикюр';
    else if (a.service === 'both') serviceRu = 'Маникюр + Педикюр';

    let coatingRu = '';
    const coatTxt = (c) => (c === 'gel' ? 'с покрытием' : 'без покрытия');
    if (a.service === 'manicure') {
      coatingRu = ` · ${coatTxt(a.manicure_coating)}`;
    } else if (a.service === 'pedicure') {
      coatingRu = ` · ${coatTxt(a.pedicure_coating)}`;
    } else if (a.service === 'both') {
      coatingRu = ` (ман: ${coatTxt(a.manicure_coating)}, пед: ${coatTxt(a.pedicure_coating)})`;
    }

    const commentHtml = a.comment
      ? `<div class="appt-card-comment">💬 ${escapeHtml(a.comment)}</div>`
      : '';

    card.innerHTML = `
      <div class="appt-card-top">
        <span class="appt-card-time">🕐 ${a.start_time}–${a.end_time}</span>
      </div>
      <div class="appt-card-client">${escapeHtml(a.client_name)}</div>
      ${whoHtml}
      <div class="appt-card-service">💅 <strong>${serviceRu}</strong>${coatingRu}</div>
      ${commentHtml}
    `;

    card.addEventListener('click', () => {
      haptic('light');
      openForm(a);
    });

    listEl.appendChild(card);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== 3. ФОРМА ЗАПИСИ (СОЗДАНИЕ / РЕДАКТИРОВАНИЕ) =====

let selectedService = 'manicure';
let manicureCoating = 'gel';
let pedicureCoating = 'gel';

function openForm(appt = null) {
  state.editingAppointmentId = appt ? appt.id : null;

  const formTitle = document.getElementById('form-screen-title');
  const apptId = document.getElementById('form-appt-id');
  const dateInput = document.getElementById('form-appt-date');
  const startInput = document.getElementById('form-appt-start');
  const endInput = document.getElementById('form-appt-end');
  const clientInput = document.getElementById('form-appt-client');
  const whoInput = document.getElementById('form-appt-who');
  const commentInput = document.getElementById('form-appt-comment');
  const deleteBtn = document.getElementById('btn-delete-appt');
  const quickTomorrowBtn = document.getElementById('btn-quick-tomorrow');
  const conflictAlert = document.getElementById('conflict-alert');

  if (conflictAlert) conflictAlert.style.display = 'none';

  if (appt) {
    if (formTitle) formTitle.textContent = 'Редактирование записи';
    if (apptId) apptId.value = appt.id;
    if (dateInput) dateInput.value = appt.date;
    if (startInput) startInput.value = appt.start_time;
    if (endInput) endInput.value = appt.end_time;
    if (clientInput) clientInput.value = appt.client_name;
    if (whoInput) whoInput.value = appt.who || '';
    if (commentInput) commentInput.value = appt.comment || '';
    selectedService = appt.service || 'manicure';
    manicureCoating = appt.manicure_coating || 'gel';
    pedicureCoating = appt.pedicure_coating || 'gel';
    if (deleteBtn) deleteBtn.style.display = 'block';
    if (quickTomorrowBtn) quickTomorrowBtn.style.display = 'block';
  } else {
    if (formTitle) formTitle.textContent = 'Новая запись';
    if (apptId) apptId.value = '';
    if (dateInput) dateInput.value = state.selectedDate;

    // Автоматическое удобное начальное время
    const now = new Date();
    let defHour = 10;
    if (state.selectedDate === todayStr) {
      defHour = Math.min(Math.max(now.getHours() + 1, 9), 20);
    }
    const defStart = `${pad(defHour)}:00`;
    const defEnd = `${pad(defHour + 2)}:00`;

    if (startInput) startInput.value = defStart;
    if (endInput) endInput.value = defEnd;
    if (clientInput) clientInput.value = '';
    if (whoInput) whoInput.value = '';
    if (commentInput) commentInput.value = '';
    selectedService = 'manicure';
    manicureCoating = 'gel';
    pedicureCoating = 'gel';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (quickTomorrowBtn) quickTomorrowBtn.style.display = 'none';
  }

  updateServiceAndCoatingUI();
  goScreen('form');
  checkConflicts();
}

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

// Нажатия на кнопки переключения услуг и покрытий
document.querySelectorAll('#service-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    selectedService = btn.dataset.service;
    updateServiceAndCoatingUI();
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

// Чипы быстрого выбора длительности (1ч, 1.5ч, 2ч, 2.5ч, 3ч)
document.querySelectorAll('#duration-chips .duration-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const hours = parseFloat(btn.dataset.hours);
    const startInput = document.getElementById('form-appt-start');
    const endInput = document.getElementById('form-appt-end');
    if (!startInput || !endInput || !startInput.value) return;

    const [h, m] = startInput.value.split(':').map(Number);
    const startMins = h * 60 + m;
    const endMins = Math.min(startMins + Math.round(hours * 60), 23 * 60 + 59);

    const endH = Math.floor(endMins / 60);
    const endM = endMins % 60;
    endInput.value = `${pad(endH)}:${pad(endM)}`;

    document.querySelectorAll('#duration-chips .duration-chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    checkConflicts();
  });
});

// Проверка пересечений по времени перед сохранением
let conflictCheckTimer = null;
async function checkConflicts() {
  clearTimeout(conflictCheckTimer);
  conflictCheckTimer = setTimeout(async () => {
    const date = document.getElementById('form-appt-date')?.value;
    const start = document.getElementById('form-appt-start')?.value;
    const end = document.getElementById('form-appt-end')?.value;
    const excludeId = state.editingAppointmentId || 0;
    const alertEl = document.getElementById('conflict-alert');
    const alertText = document.getElementById('conflict-alert-text');

    if (!date || !start || !end || end <= start) {
      if (alertEl) alertEl.style.display = 'none';
      return;
    }

    try {
      const res = await api('/appointments/check', {
        method: 'POST',
        body: JSON.stringify({ date, start_time: start, end_time: end, exclude_id: excludeId }),
      });

      if (res.conflicts && res.conflicts.length > 0) {
        haptic('warning');
        const listStr = res.conflicts
          .map((c) => `• <b>${c.start_time}–${c.end_time}</b>: ${escapeHtml(c.client_name)}`)
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
document.getElementById('form-appt-end')?.addEventListener('change', checkConflicts);

// Сохранение записи
async function saveAppointment() {
  const date = document.getElementById('form-appt-date')?.value;
  const start_time = document.getElementById('form-appt-start')?.value;
  const end_time = document.getElementById('form-appt-end')?.value;
  const client_name = document.getElementById('form-appt-client')?.value?.trim();
  const who = document.getElementById('form-appt-who')?.value?.trim() || null;
  const comment = document.getElementById('form-appt-comment')?.value?.trim() || null;

  if (!date) return showToast('Укажите дату');
  if (!start_time || !end_time) return showToast('Укажите время начала и окончания');
  if (end_time <= start_time) return showToast('Время конца должно быть строго позже начала');
  if (!client_name) return showToast('Укажите имя клиента');

  const payload = {
    date,
    start_time,
    end_time,
    client_name,
    who,
    service: selectedService,
    manicure_coating: selectedService === 'pedicure' ? null : manicureCoating,
    pedicure_coating: selectedService === 'manicure' ? null : pedicureCoating,
    comment,
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

    goScreen('main');
    await loadWeekSummary();
    await loadSelectedDay();
  } catch (err) {
    console.error('Ошибка сохранения записи:', err);
  }
}

// Удаление записи
async function deleteAppointment() {
  if (!state.editingAppointmentId) return;
  confirmDialog('Удалить эту запись безвозвратно?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/appointments/${state.editingAppointmentId}`, { method: 'DELETE' });
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
document.getElementById('btn-delete-appt')?.addEventListener('click', deleteAppointment);
document.getElementById('btn-cancel-appt')?.addEventListener('click', () => goScreen('main'));
document.getElementById('btn-add-appt')?.addEventListener('click', () => {
  haptic('light');
  openForm(null);
});

// ===== 4. МЕСЯЧНЫЙ КАЛЕНДАРЬ =====

const currentYear = new Date().getFullYear();
const minCalDate = new Date(currentYear, 0, 1); // 1 января текущего года
const maxCalDate = new Date(currentYear + 3, 11, 31); // текущий год + 3 года

function openCalendar() {
  const d = parseDate(state.selectedDate);
  state.calendarYear = d.getFullYear();
  state.calendarMonth = d.getMonth();
  renderCalendar();
  goScreen('calendar');
}

async function renderCalendar() {
  const titleEl = document.getElementById('cal-month-title');
  const gridEl = document.getElementById('calendar-grid');
  if (!gridEl) return;

  if (titleEl) {
    titleEl.textContent = `${RU_MONTHS_NOM[state.calendarMonth]} ${state.calendarYear}`;
  }

  // Вычисляем первый день месяца и количество дней
  const firstDay = new Date(state.calendarYear, state.calendarMonth, 1);
  const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0);

  // Сводка по дням за этот месяц
  const fromStr = fmt(firstDay);
  const toStr = fmt(lastDay);

  let monthSummary = new Map();
  try {
    const summary = await api(`/days?from=${fromStr}&to=${toStr}`);
    for (const item of summary) monthSummary.set(item.date, item);
  } catch {}

  gridEl.innerHTML = '';

  // Смещение на понедельник (0 = Пн, 6 = Вс)
  const startDayOffset = (firstDay.getDay() + 6) % 7;

  // Пустые/предыдущие ячейки
  for (let i = 0; i < startDayOffset; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell other-month';
    gridEl.appendChild(emptyCell);
  }

  // Дни месяца
  const daysInMonth = lastDay.getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDateStr = `${state.calendarYear}-${pad(state.calendarMonth + 1)}-${pad(day)}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';

    if (cellDateStr === todayStr) cell.classList.add('is-today');
    if (cellDateStr === state.selectedDate) cell.classList.add('selected');

    const info = monthSummary.get(cellDateStr) || { count: 0, has_note: false };

    let dotsHtml = '';
    const dotsCount = Math.min(info.count, 3);
    for (let dot = 0; dot < dotsCount; dot++) {
      dotsHtml += '<span class="appt-dot"></span>';
    }

    const noteHtml = info.has_note ? '<span class="cal-cell-note">📝</span>' : '';

    cell.innerHTML = `
      <span class="cal-day-num">${day}</span>
      <div class="cal-cell-dots">${dotsHtml}</div>
      ${noteHtml}
    `;

    cell.addEventListener('click', () => {
      haptic('light');
      selectDate(cellDateStr);
      goScreen('main');
    });

    gridEl.appendChild(cell);
  }
}

document.getElementById('btn-cal-prev-month')?.addEventListener('click', () => {
  haptic('light');
  state.calendarMonth--;
  if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear--;
  }
  // Ограничение с 1 января текущего года
  if (state.calendarYear < currentYear) {
    state.calendarYear = currentYear;
    state.calendarMonth = 0;
  }
  renderCalendar();
});

document.getElementById('btn-cal-next-month')?.addEventListener('click', () => {
  haptic('light');
  state.calendarMonth++;
  if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear++;
  }
  // Ограничение текущий год + 3 года
  if (state.calendarYear > currentYear + 3) {
    state.calendarYear = currentYear + 3;
    state.calendarMonth = 11;
  }
  renderCalendar();
});

document.getElementById('btn-cal-goto-today')?.addEventListener('click', () => {
  haptic('light');
  selectDate(todayStr);
  goScreen('main');
});

// ===== 5. ПОИСК КЛИЕНТОВ =====

let searchDebounceTimer = null;

function openSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-search-clear');
  const resultsEl = document.getElementById('search-results-list');
  const hintEl = document.getElementById('search-hint');

  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (resultsEl) resultsEl.innerHTML = '';
  if (hintEl) {
    hintEl.style.display = 'block';
    hintEl.textContent = 'Введите минимум 2 буквы для поиска';
  }

  goScreen('search');
  setTimeout(() => input?.focus(), 100);
}

document.getElementById('search-input')?.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  const clearBtn = document.getElementById('btn-search-clear');
  const hintEl = document.getElementById('search-hint');
  const resultsEl = document.getElementById('search-results-list');

  if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';

  clearTimeout(searchDebounceTimer);
  if (val.length < 2) {
    if (resultsEl) resultsEl.innerHTML = '';
    if (hintEl) {
      hintEl.style.display = 'block';
      hintEl.textContent = 'Введите минимум 2 буквы для поиска';
    }
    return;
  }

  if (hintEl) hintEl.style.display = 'none';

  searchDebounceTimer = setTimeout(async () => {
    try {
      const results = await api(`/search?q=${encodeURIComponent(val)}`);
      renderSearchResults(results);
    } catch (err) {
      console.error('Ошибка поиска:', err);
    }
  }, 250);
});

document.getElementById('btn-search-clear')?.addEventListener('click', () => {
  const input = document.getElementById('search-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clearBtn = document.getElementById('btn-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const resultsEl = document.getElementById('search-results-list');
  if (resultsEl) resultsEl.innerHTML = '';
  const hintEl = document.getElementById('search-hint');
  if (hintEl) {
    hintEl.style.display = 'block';
    hintEl.textContent = 'Введите минимум 2 буквы для поиска';
  }
});

function renderSearchResults(items) {
  const resultsEl = document.getElementById('search-results-list');
  if (!resultsEl) return;

  if (!items || !items.length) {
    resultsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">🔍</div>
        <div class="empty-state-title">Ничего не найдено</div>
        <p>Попробуйте другое имя или часть слова</p>
      </div>
    `;
    return;
  }

  resultsEl.innerHTML = '';
  for (const a of items) {
    const card = document.createElement('div');
    card.className = 'appointment-card';

    let serviceRu = 'Маникюр';
    if (a.service === 'pedicure') serviceRu = 'Педикюр';
    else if (a.service === 'both') serviceRu = 'Маникюр + Педикюр';

    const whoHtml = a.who ? `<span class="appt-card-who">${escapeHtml(a.who)}</span>` : '';

    card.innerHTML = `
      <div class="appt-card-top">
        <span class="appt-card-time">📅 ${formatFullDateRu(a.date)} · ${a.start_time}–${a.end_time}</span>
      </div>
      <div class="appt-card-client">${escapeHtml(a.client_name)}</div>
      ${whoHtml}
      <div class="appt-card-service">💅 <strong>${serviceRu}</strong></div>
      ${a.comment ? `<div class="appt-card-comment">💬 ${escapeHtml(a.comment)}</div>` : ''}
    `;

    card.addEventListener('click', () => {
      haptic('light');
      selectDate(a.date);
      goScreen('main');
    });

    resultsEl.appendChild(card);
  }
}

// ===== 6. ЗАМЕТКА ДНЯ =====

function openNote() {
  const titleDate = document.getElementById('note-screen-date');
  const textarea = document.getElementById('note-text-input');

  if (titleDate) titleDate.textContent = formatFullDateRu(state.selectedDate);
  if (textarea) textarea.value = state.currentDayNote || '';

  goScreen('note');
  setTimeout(() => textarea?.focus(), 100);
}

async function saveDayNote() {
  const textarea = document.getElementById('note-text-input');
  const text = textarea?.value?.trim() || '';

  try {
    await api(`/notes/${state.selectedDate}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    });

    haptic('success');
    showToast(text ? 'Заметка сохранена 📝' : 'Заметка удалена');
    state.currentDayNote = text;

    goScreen('main');
    await loadWeekSummary();
    await loadSelectedDay();
  } catch (err) {
    console.error('Ошибка сохранения заметки:', err);
  }
}

function deleteDayNote() {
  confirmDialog('Очистить заметку на этот день?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/notes/${state.selectedDate}`, {
        method: 'PUT',
        body: JSON.stringify({ text: '' }),
      });
      haptic('success');
      showToast('Заметка очищена');
      state.currentDayNote = '';
      goScreen('main');
      await loadWeekSummary();
      await loadSelectedDay();
    } catch (err) {
      console.error('Ошибка удаления заметки:', err);
    }
  });
}

document.getElementById('btn-day-note-action')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
document.getElementById('btn-edit-note-card')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
document.getElementById('btn-delete-note')?.addEventListener('click', deleteDayNote);
document.getElementById('btn-cancel-note')?.addEventListener('click', () => goScreen('main'));

// ===== 7. НАСТРОЙКИ И ЭКСПОРТ =====

async function openSettings() {
  try {
    const s = await api('/settings');
    const enabledCheck = document.getElementById('setting-notify-enabled');
    const newApptCheck = document.getElementById('setting-notify-new-appt');
    const timeInput = document.getElementById('setting-notify-time');
    const tzSelect = document.getElementById('setting-tz');

    if (enabledCheck) enabledCheck.checked = !!s.notify_enabled;
    if (newApptCheck) newApptCheck.checked = s.notify_new_appt !== false;
    if (timeInput) timeInput.value = s.notify_time || '22:00';
    if (tzSelect && s.tz) {
      // Если такого часового пояса нет в списке, добавляем опцию
      if (![...tzSelect.options].some((o) => o.value === s.tz)) {
        const opt = document.createElement('option');
        opt.value = s.tz;
        opt.textContent = s.tz;
        tzSelect.appendChild(opt);
      }
      tzSelect.value = s.tz;
    }
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
  goScreen('settings');
}

async function saveSettings() {
  const notify_enabled = !!document.getElementById('setting-notify-enabled')?.checked;
  const notify_new_appt = !!document.getElementById('setting-notify-new-appt')?.checked;
  const notify_time = document.getElementById('setting-notify-time')?.value || '22:00';
  const tz = document.getElementById('setting-tz')?.value || 'Europe/Chisinau';

  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ notify_enabled, notify_time, tz, notify_new_appt }),
    });
    haptic('success');
    showToast('Настройки сохранены ✅');
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
  }
}

async function exportData(format = 'csv') {
  haptic('light');
  showToast('Формируем и отправляем файл в чат…');
  try {
    const res = await api('/export/send', {
      method: 'POST',
      body: JSON.stringify({ format }),
    });
    if (res.ok) {
      haptic('success');
      showToast(format === 'csv' ? '📊 CSV-файл отправлен ботом в чат!' : '💾 Резервная копия JSON отправлена в чат!');
    }
  } catch (err) {
    console.error('Ошибка экспорта:', err);
  }
}

document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
document.getElementById('btn-export-csv')?.addEventListener('click', () => exportData('csv'));
document.getElementById('btn-export-json')?.addEventListener('click', () => exportData('json'));

// Навигационные кнопки в шапке
document.getElementById('btn-open-calendar')?.addEventListener('click', () => {
  haptic('light');
  openCalendar();
});
document.getElementById('btn-open-search')?.addEventListener('click', () => {
  haptic('light');
  openSearch();
});
document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  haptic('light');
  openSettings();
});
document.getElementById('btn-back')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});
document.getElementById('btn-prev-week')?.addEventListener('click', () => shiftWeek(-7));
document.getElementById('btn-next-week')?.addEventListener('click', () => shiftWeek(7));
document.getElementById('btn-today')?.addEventListener('click', () => {
  haptic('light');
  selectDate(todayStr);
});

// ===== 8. ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====

async function init() {
  goScreen('main');
  await loadWeekSummary();
  await loadSelectedDay();
}

init();
