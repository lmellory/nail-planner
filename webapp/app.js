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
  let res;
  try {
    res = await fetch('/api' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Init-Data': initData,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    showToast('Ошибка сети');
    throw err;
  }
  if (res.status === 403) {
    const overlay = document.getElementById('session-expired-overlay');
    if (overlay) overlay.style.display = 'flex';
    else showToast('Сессия Telegram устарела. Перезапустите приложение');
    throw new Error('Сессия устарела');
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

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad(h)}:${pad(m)}`;
}

function addMinutes(timeStr, minutes) {
  if (!timeStr) return '';
  const total = timeToMinutes(timeStr) + minutes;
  return minutesToTime(total);
}

function formatApptTime(a) {
  if (!a) return '';
  return a.end_time ? `${a.start_time}–${a.end_time}` : a.start_time;
}

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

function updateGreeting() {
  const dateEl = document.getElementById('greeting-date');
  const titleEl = document.getElementById('greeting-title');
  const avatarEl = document.getElementById('greeting-avatar');

  const now = new Date();
  const dStr = fmt(now);

  if (dateEl) {
    const [y, m, dNum] = dStr.split('-').map(Number);
    const wdName = RU_WEEKDAYS_FULL[now.getDay()];
    dateEl.textContent = `${wdName}, ${dNum} ${RU_MONTHS[m - 1]}`;
  }

  // Получаем имя мастера напрямую из Telegram WebApp SDK
  const user = tg?.initDataUnsafe?.user;
  const firstName = user?.first_name ? user.first_name.trim() : '';

  const hour = now.getHours();
  let greet = 'Добрый день';
  if (hour >= 5 && hour < 12) greet = 'Доброе утро';
  else if (hour >= 12 && hour < 18) greet = 'Добрый день';
  else if (hour >= 18 && hour < 23) greet = 'Добрый вечер';
  else greet = 'Доброй ночи';

  if (titleEl) {
    titleEl.textContent = firstName ? `${greet}, ${firstName} ✨` : `${greet} ✨`;
  }

  if (avatarEl) {
    if (user?.photo_url) {
      avatarEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = user.photo_url;
      img.alt = firstName || 'Мастер';
      img.className = 'avatar-img';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = '💅';
    }
  }
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
    updateGreeting();
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
    } else if (name === 'clients') {
      if (headerTitle) headerTitle.textContent = 'Клиенты';
      tg?.MainButton?.hide();
    }
  }
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
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

  // Защита от race condition: отменяем предыдущий запрос и сверяем seq
  const reqId = ++currentDayRequestId;
  if (currentDayAbortCtrl) {
    try { currentDayAbortCtrl.abort(); } catch {}
  }
  currentDayAbortCtrl = new AbortController();
  const dateToLoad = state.selectedDate;

  // Загружаем записи и заметку дня
  try {
    const [appts, noteRes] = await Promise.all([
      api(`/appointments?from=${dateToLoad}&to=${dateToLoad}`, { signal: currentDayAbortCtrl.signal }),
      api(`/notes/${dateToLoad}`, { signal: currentDayAbortCtrl.signal }),
    ]);

    if (reqId !== currentDayRequestId || dateToLoad !== state.selectedDate) return;

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
    await loadFreeSlots(dateToLoad);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Ошибка загрузки дня:', err);
    if (listEl && reqId === currentDayRequestId) {
      listEl.innerHTML = '<div class="empty-state"><p>Ошибка загрузки записей</p></div>';
    }
  }
}

let currentDayRequestId = 0;
let currentDayAbortCtrl = null;

async function loadFreeSlots(dateStr) {
  const card = document.getElementById('free-slots-card');
  const countEl = document.getElementById('free-slots-count');
  const chipsEl = document.getElementById('free-slots-chips');
  if (!card || !chipsEl) return;

  try {
    const res = await api(`/days/slots?date=${dateStr}`);
    if (!res.is_work_day || !res.slots || !res.slots.length) {
      card.style.display = 'none';
      return;
    }

    if (countEl) countEl.textContent = `${res.slots.length}`;
    chipsEl.innerHTML = '';
    for (const slot of res.slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-chip';
      const h = Math.floor(slot.duration_minutes / 60);
      const m = slot.duration_minutes % 60;
      const durText = h > 0 ? (m > 0 ? `${h}ч ${m}м` : `${h}ч`) : `${m}м`;
      btn.textContent = `✨ ${slot.start}–${slot.end} (${durText})`;
      btn.addEventListener('click', () => {
        haptic('light');
        openForm({ date: dateStr, start_time: slot.start });
      });
      chipsEl.appendChild(btn);
    }
    card.style.display = 'block';
  } catch {
    card.style.display = 'none';
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
    else if (a.service === 'fingers') serviceRu = 'Пальцы';

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
        <span class="appt-card-time">🕐 ${formatApptTime(a)}</span>
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
  state.editingAppointmentId = appt && appt.id ? appt.id : null;

  const formTitle = document.getElementById('form-screen-title');
  const apptId = document.getElementById('form-appt-id');
  const dateInput = document.getElementById('form-appt-date');
  const startInput = document.getElementById('form-appt-start');
  const clientInput = document.getElementById('form-appt-client');
  const whoInput = document.getElementById('form-appt-who');
  const commentInput = document.getElementById('form-appt-comment');
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
    selectedService = appt.service || 'manicure';
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
    selectedService = 'manicure';
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
  } else if (selectedService === 'fingers') {
    // «Пальцы» — без выбора покрытия
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

// Нажатия на кнопки переключения услуг и покрытий
document.querySelectorAll('#service-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    selectedService = btn.dataset.service;
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
        body: JSON.stringify({
          date,
          start_time: start,
          service: selectedService,
          exclude_id: excludeId,
        }),
      });

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
async function saveAppointment() {
  const date = document.getElementById('form-appt-date')?.value;
  const start_time = document.getElementById('form-appt-start')?.value;
  const client_name = document.getElementById('form-appt-client')?.value?.trim();
  const who = document.getElementById('form-appt-who')?.value?.trim() || null;
  const comment = document.getElementById('form-appt-comment')?.value?.trim() || null;

  if (!date) return showToast('Укажите дату');
  if (!start_time) return showToast('Укажите время приема');
  if (!client_name) return showToast('Укажите имя клиента');

  const payload = {
    date,
    start_time,
    client_name,
    who,
    service: selectedService,
    manicure_coating: (selectedService === 'manicure' || selectedService === 'both') ? manicureCoating : null,
    pedicure_coating: (selectedService === 'pedicure' || selectedService === 'both') ? pedicureCoating : null,
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

    // Обновляем список клиентов в фоне, чтобы автоподстановка сразу знала нового клиента
    loadClientsDatalist().catch(() => {});

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
document.getElementById('btn-submit-appt')?.addEventListener('click', saveAppointment);
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
    else if (a.service === 'fingers') serviceRu = 'Пальцы';

    const whoHtml = a.who ? `<span class="appt-card-who">${escapeHtml(a.who)}</span>` : '';

    card.innerHTML = `
      <div class="appt-card-top">
        <span class="appt-card-time">📅 ${formatFullDateRu(a.date)} · ${formatApptTime(a)}</span>
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

let selectedWorkDays = [1, 2, 3, 4, 5, 6];

function renderWorkDaysPicker() {
  document.querySelectorAll('#setting-work-days-picker .day-toggle-pill').forEach((btn) => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', selectedWorkDays.includes(day));
  });
}

document.querySelectorAll('#setting-work-days-picker .day-toggle-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const day = Number(btn.dataset.day);
    if (selectedWorkDays.includes(day)) {
      if (selectedWorkDays.length > 1) {
        selectedWorkDays = selectedWorkDays.filter((d) => d !== day);
      }
    } else {
      selectedWorkDays.push(day);
      selectedWorkDays.sort((a, b) => a - b);
    }
    renderWorkDaysPicker();
  });
});

async function openSettings() {
  try {
    const s = await api('/settings');
    const enabledCheck = document.getElementById('setting-notify-enabled');
    const newApptCheck = document.getElementById('setting-notify-new-appt');
    const timeInput = document.getElementById('setting-notify-time');
    const tzSelect = document.getElementById('setting-tz');
    const workStart = document.getElementById('setting-work-start');
    const workEnd = document.getElementById('setting-work-end');

    if (enabledCheck) enabledCheck.checked = !!s.notify_enabled;
    if (newApptCheck) newApptCheck.checked = s.notify_new_appt !== false;
    if (timeInput) timeInput.value = s.notify_time || '22:00';
    if (workStart) workStart.value = s.work_start_time || '09:00';
    if (workEnd) workEnd.value = s.work_end_time || '20:00';

    if (s.work_days) {
      selectedWorkDays = s.work_days.split(',').map((x) => Number(x.trim())).filter(Boolean);
    } else {
      selectedWorkDays = [1, 2, 3, 4, 5, 6];
    }
    renderWorkDaysPicker();

    if (tzSelect && s.tz) {
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
  const work_start_time = document.getElementById('setting-work-start')?.value || '09:00';
  const work_end_time = document.getElementById('setting-work-end')?.value || '20:00';
  const work_days = selectedWorkDays.join(',');

  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        notify_enabled,
        notify_time,
        tz,
        notify_new_appt,
        work_start_time,
        work_end_time,
        work_days,
      }),
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

// ===== 8. БАЗА КЛИЕНТОВ =====

let cachedClients = [];
let currentViewingClientId = null;

async function loadClientsDatalist() {
  try {
    cachedClients = await api('/clients');
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
    console.error('Ошибка обновления подсказок клиентов', e);
  }
}

async function loadClients(search = '') {
  const listEl = document.getElementById('clients-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-spinner">Загрузка клиентов…</div>';

  try {
    cachedClients = await api(`/clients?q=${encodeURIComponent(search)}`);
    renderClientsList(cachedClients);
  } catch (err) {
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
    const data = await api(`/clients/${id}`);
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
          let sRu = a.service === 'manicure' ? 'Маникюр' : a.service === 'pedicure' ? 'Педикюр' : 'Маникюр + Педикюр';
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
    console.error('Ошибка загрузки карточки клиента:', err);
  }
}

function closeClientView() {
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

async function saveClientModal() {
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
  confirmDialog('Удалить этого клиента из базы?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/clients/${currentViewingClientId}`, { method: 'DELETE' });
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

// Кнопка перезапуска при истекшей сессии
document.getElementById('btn-reload-app')?.addEventListener('click', () => {
  window.location.reload();
});

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

// ===== 9. ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====

async function init() {
  updateGreeting();
  goScreen('main');
  loadClientsDatalist().catch(() => {});
  await loadWeekSummary();
  await loadSelectedDay();
}

init();

