import './js/navigation-events.js';
import './js/finance.js';
import { updateGreeting } from './js/greeting.js';
import { goScreen } from './js/navigation.js';
import { loadMe } from './js/admin.js';
import { loadClientsDatalist } from './js/clients.js';
import { loadPrices } from './js/notes-settings.js';
import { loadSelectedDay, loadWeekSummary } from './js/schedule.js';

// ===== 9. ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====

async function init() {
  updateGreeting();
  goScreen('main');
  loadMe().catch(() => {});
  loadClientsDatalist().catch(() => {});
  loadPrices().catch(() => {});
  await loadWeekSummary();
  await loadSelectedDay();
}

init().catch(error => console.error('Ошибка запуска приложения', error));

