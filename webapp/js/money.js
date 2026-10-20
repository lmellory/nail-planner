// Подпись валюты у сумм. Поменяй под себя ('лей', '₽', '$') или оставь '' — тогда только число.
const CURRENCY = 'руб.';

/** @param {number|string|null|undefined} n */
export function formatMoney(n) {
  const num = new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
  return CURRENCY ? `${num}\u00A0${CURRENCY}` : num;
}
