import { requestGate } from './requests.js';
import { state, todayStr } from './state.js';
import { RU_MONTHS, RU_WEEKDAYS_SHORT, addDays, fmt, formatApptTime, formatFullDateRu, mondayOf, parseDate } from './dates.js';
import { api } from './api.js';
import { haptic } from './telegram.js';
import { openForm } from './appointment-form.js';
import { escapeHtml } from './ui.js';
import { serviceName } from './labels.js';
import { formatMoney } from './money.js';

const weekRequest = requestGate();
const slotsRequest = requestGate();
// ===== 1. ПОЛОСА НЕДЕЛИ И СПИСОК ДНЯ =====

export async function loadWeekSummary() {
  const request = weekRequest();
  const from = state.weekStart;
  const to = addDays(state.weekStart, 6);
  try {
    const summary = await api(`/days?from=${from}&to=${to}`, { signal: request.signal });
    if (!request.current() || from !== state.weekStart) return;
    state.daySummaryMap.clear();
    for (const item of summary) {
      state.daySummaryMap.set(item.date, item);
    }
    renderWeekStrip();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Ошибка загрузки сводки дней:', err);
  }
}

export function renderWeekStrip() {
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

export function selectDate(dateStr) {
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

export function shiftWeek(days) {
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

export async function loadSelectedDay() {
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

export async function loadFreeSlots(dateStr) {
  const request = slotsRequest();
  const card = document.getElementById('free-slots-card');
  const countEl = document.getElementById('free-slots-count');
  const chipsEl = document.getElementById('free-slots-chips');
  if (!card || !chipsEl) return;

  try {
    const res = await api(`/days/slots?date=${dateStr}`, { signal: request.signal });
    if (!request.current() || dateStr !== state.selectedDate) return;
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
    if (request.current()) card.style.display = 'none';
  }
}

const STATUS_RU = { no_show: 'Не пришла', cancelled: 'Отменена' };
export const statusBadgeHtml = (a) => (STATUS_RU[a.status] ? `<span class="appt-status-badge is-${a.status}">${STATUS_RU[a.status]}</span>` : '');
export const inactiveClass = (a) => (STATUS_RU[a.status] ? ' is-inactive' : '');

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}

export function renderAppointmentsList() {
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
    card.className = 'appointment-card' + inactiveClass(a);
    card.setAttribute('data-id', a.id);

    const whoHtml = a.who ? `<span class="appt-card-who">${escapeHtml(a.who)}</span>` : '';

    const serviceRu = serviceName(a.service);

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
        ${statusBadgeHtml(a)}
        ${a.price != null ? `<span class="appt-card-price">${formatMoney(a.price)}</span>` : ''}
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
