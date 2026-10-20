import { todayStr } from './state.js';
import { RU_MONTHS, RU_MONTHS_NOM, parseDate } from './dates.js';

/** @type {import('./contracts').FinanceState} */
export const income = {
  period: 'week',      // week | month | year
  anchor: todayStr,    // любая дата внутри показываемого периода
  data: null,          // ответ GET /api/stats
  selectedKey: null,   // выбранный столбик диаграммы
  metric: 'income',    // что рисует диаграмма: income | expense
  requestId: 0,        // защита от «устаревших» ответов при быстром переключении
};

/** @param {import('./contracts').IncomeReport} d */
export function incomePeriodLabel(d) {
  const from = parseDate(d.from);
  const to = parseDate(d.to);
  if (d.period === 'year') return String(from.getFullYear());
  if (d.period === 'month') return `${RU_MONTHS_NOM[from.getMonth()]} ${from.getFullYear()}`;
  if (from.getMonth() === to.getMonth()) {
    return `${from.getDate()}–${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
  }
  return `${from.getDate()} ${RU_MONTHS[from.getMonth()]} – ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}
