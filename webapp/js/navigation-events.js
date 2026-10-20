import { byId } from './dom.js';
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
byId('btn-reload-app', 'button')?.addEventListener('click', () => {
  window.location.reload();
});

// Навигационные кнопки в шапке
byId('btn-tab-main', 'button')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});

byId('btn-open-calendar', 'button')?.addEventListener('click', () => {
  haptic('light');
  openCalendar();
});

byId('btn-open-search', 'button')?.addEventListener('click', () => {
  haptic('light');
  openSearch();
});

byId('btn-open-settings', 'button')?.addEventListener('click', () => {
  haptic('light');
  openSettings();
});

byId('btn-back', 'button')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});

byId('btn-prev-week', 'button')?.addEventListener('click', () => shiftWeek(-7));

byId('btn-next-week', 'button')?.addEventListener('click', () => shiftWeek(7));

byId('btn-today', 'button')?.addEventListener('click', () => {
  haptic('light');
  selectDate(todayStr);
});
