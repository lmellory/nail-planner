import { requestGate } from './requests.js';
import { RU_MONTHS_NOM, fmt, formatApptTime, formatFullDateRu, pad, parseDate } from './dates.js';
import { state, todayStr } from './state.js';
import { goScreen } from './navigation.js';
import { api } from './api.js';
import { haptic } from './telegram.js';
import { inactiveClass, selectDate, statusBadgeHtml } from './schedule.js';
import { serviceName } from './labels.js';
import { escapeHtml } from './ui.js';

const calendarRequest = requestGate();
const searchRequest = requestGate();
let searchSequence = 0;
// ===== 4. МЕСЯЧНЫЙ КАЛЕНДАРЬ =====

const currentYear = new Date().getFullYear();
const minCalDate = new Date(currentYear, 0, 1); // 1 января текущего года
const maxCalDate = new Date(currentYear + 3, 11, 31); // текущий год + 3 года

export function openCalendar() {
  const d = parseDate(state.selectedDate);
  state.calendarYear = d.getFullYear();
  state.calendarMonth = d.getMonth();
  renderCalendar();
  goScreen('calendar');
}

export async function renderCalendar() {
  const request = calendarRequest();
  const year = state.calendarYear, month = state.calendarMonth;
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
    const summary = await api(`/days?from=${fromStr}&to=${toStr}`, { signal: request.signal });
    for (const item of summary) monthSummary.set(item.date, item);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Ошибка загрузки календаря', error);
  }
  if (!request.current() || year !== state.calendarYear || month !== state.calendarMonth) return;

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

export function openSearch() {
  clearTimeout(searchDebounceTimer);
  searchSequence++;
  searchRequest();
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
  const sequence = ++searchSequence;
  const request = searchRequest();
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
      const results = await api(`/search?q=${encodeURIComponent(val)}`, { signal: request.signal });
      if (!request.current() || sequence !== searchSequence) return;
      renderSearchResults(results);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Ошибка поиска:', err);
    }
  }, 250);
});

document.getElementById('btn-search-clear')?.addEventListener('click', () => {
  clearTimeout(searchDebounceTimer);
  searchSequence++;
  searchRequest();
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
    card.className = 'appointment-card' + inactiveClass(a);

    const serviceRu = serviceName(a.service);

    const whoHtml = a.who ? `<span class="appt-card-who">${escapeHtml(a.who)}</span>` : '';

    card.innerHTML = `
      <div class="appt-card-top">
        <span class="appt-card-time">📅 ${formatFullDateRu(a.date)} · ${formatApptTime(a)}</span>
        ${statusBadgeHtml(a)}
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
