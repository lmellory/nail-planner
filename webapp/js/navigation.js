import { byId, all } from './dom.js';
import { state } from './state.js';
import { updateGreeting } from './greeting.js';
import { tg } from './telegram.js';

// ===== Управление экранами =====
/** @param {import('./contracts').Screen} name */
export function goScreen(name) {
  state.currentScreen = name;
  const showTabs = ['main', 'clients', 'income', 'settings'].includes(name);
  const bottomNav = byId('bottom-nav', 'nav');
  if (bottomNav) bottomNav.hidden = !showTabs;
  document.body.classList.toggle('has-bottom-nav', showTabs);
  all('#bottom-nav .nav-tab').forEach(tab => {
    const active = tab.dataset.screen === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  all('.screen').forEach((el) => el.classList.remove('active'));

  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');

  const backBtn = byId('btn-back', 'button');
  const headerActions = byId('header-actions', 'div');
  const headerTitle = byId('header-title', 'h1');

  if (name === 'main') {
    updateGreeting();
    if (backBtn) backBtn.style.display = 'none';
    if (headerActions) headerActions.style.display = 'flex';
    if (headerTitle) headerTitle.textContent = state.actAs ? '🛠 ' + state.actAsLabel : 'Ежедневник';
    tg?.BackButton?.hide();
    tg?.MainButton?.hide();
  } else {
    if (backBtn) backBtn.style.display = 'flex';
    if (headerActions) headerActions.style.display = 'none';
    tg?.BackButton?.show();

    if (name === 'form') {
      if (headerTitle) headerTitle.textContent = state.editingAppointmentId ? 'Редактирование' : 'Новая запись';
      // Сохранение находится в форме: нативная кнопка Telegram дублировала его.
      tg?.MainButton?.hide();
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
    } else if (name === 'income') {
      if (headerTitle) headerTitle.textContent = 'Доходы';
      tg?.MainButton?.hide();
    } else if (name === 'expenses') {
      if (headerTitle) headerTitle.textContent = 'Траты';
      tg?.MainButton?.hide();
    } else if (name === 'admin') {
      if (headerTitle) headerTitle.textContent = 'Админ-панель';
      tg?.MainButton?.hide();
    }
  }
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}
