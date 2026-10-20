import { byId } from './dom.js';
import { RU_MONTHS, RU_WEEKDAYS_FULL, fmt } from './dates.js';
import { tg } from './telegram.js';

export function updateGreeting() {
  const dateEl = byId('greeting-date', 'span');
  const titleEl = byId('greeting-title', 'h2');
  const avatarEl = byId('greeting-avatar', 'div');

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
