import { state, todayStr } from './state.js';
import { updateGreeting } from './greeting.js';
import { haptic, tg } from './telegram.js';
import { openSettings } from './settings.js';
import { saveDayNote } from './notes.js';
import { openCalendar, openSearch } from './calendar-search.js';
import { selectDate, shiftWeek } from './schedule.js';
import { goScreen } from './navigation.js';

// Подключаем слушатели навигации Telegram WebApp
if (tg) {
  tg.BackButton?.onClick(() => goScreen('main'));
  tg.MainButton?.onClick(() => {
    if (state.currentScreen === 'note') saveDayNote();
  });
}

// Кнопка перезапуска при истекшей сессии
document.getElementById('btn-reload-app')?.addEventListener('click', () => {
  window.location.reload();
});

// Навигационные кнопки в шапке
document.getElementById('btn-tab-main')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});

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
