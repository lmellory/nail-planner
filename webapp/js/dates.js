// ===== Утилиты для работы с датами и временем =====
/** @param {number|string} n */
export const pad = (n) => String(n).padStart(2, '0');

/** @param {Date} d */
export const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** @param {string|null|undefined} timeStr */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** @param {number} mins */
function minutesToTime(mins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad(h)}:${pad(m)}`;
}

/** @param {Pick<import('./contracts').Appointment,'start_time'> | null | undefined} a */
export function formatApptTime(a) {
  if (!a) return '';
  return a.start_time;
}

/** @param {string} s */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {Date} d */
export function mondayOf(d) {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7; // 0 = Пн, 6 = Вс
  x.setDate(x.getDate() - wd);
  return x;
}

/** @param {string} dateStr @param {number} n */
export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

export const RU_MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

export const RU_WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const RU_WEEKDAYS_FULL = [
  'Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'
];

/** @param {string} dateStr */
export function formatFullDateRu(dateStr) {
  const d = parseDate(dateStr);
  const weekday = RU_WEEKDAYS_FULL[d.getDay()];
  return `${weekday}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
