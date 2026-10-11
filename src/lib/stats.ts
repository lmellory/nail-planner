// Расчёт периодов и корзин для раздела «Доходы». Чистые функции — без обращения к БД.
import { addDays } from './time';

export type Period = 'week' | 'month' | 'year';
export const isPeriod = (s: unknown): s is Period => s === 'week' || s === 'month' || s === 'year';

/** Строка из БД: сумма цен и число записей за один день. */
export interface DayRow {
  date: string;
  sum: number;
  paid: number;   // записей с ценой
  unpaid: number; // записей без цены
}

/** Строка из БД: траты за один день. */
export interface ExpenseDayRow {
  date: string;
  sum: number;
  count: number;
}

/** Траты по одному материалу за период. */
export interface MaterialRow {
  name: string;
  sum: number;
  count: number;
}

export interface Bucket {
  key: string;    // YYYY-MM-DD (неделя, месяц) или YYYY-MM (год)
  from: string;
  to: string;
  sum: number;    // доход
  paid: number;
  unpaid: number;
  expense: number; // траты на материалы
  expense_count: number;
}

export interface IncomeReport {
  period: Period;
  from: string;
  to: string;
  buckets: Bucket[];
  total: number;
  paid: number;
  unpaid: number;
  avg: number;        // средний чек (по записям с ценой), округлён
  prev_total: number; // доход за предыдущий такой же период
  total_expense: number;
  expense_count: number;
  prev_expense: number;
  profit: number;     // доход минус траты
  materials: MaterialRow[]; // траты по материалам, самые большие сверху
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12

/** Границы периода, в который попадает дата anchor. Неделя — с понедельника по воскресенье. */
export function periodRange(period: Period, anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (period === 'month') {
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
  }
  const weekday = new Date(anchor + 'T00:00:00Z').getUTCDay(); // 0 = воскресенье
  const from = addDays(anchor, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** Предыдущий такой же период (прошлая неделя / месяц / год). */
export function previousRange(period: Period, anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'year') return periodRange('year', `${y - 1}-01-01`);
  if (period === 'month') {
    return periodRange('month', m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`);
  }
  return periodRange('week', addDays(anchor, -7));
}

/** Раскладывает дни по корзинам: дни для недели и месяца, месяцы для года. */
export function buildBuckets(
  period: Period,
  from: string,
  to: string,
  rows: DayRow[],
  expenseRows: ExpenseDayRow[] = [],
): Bucket[] {
  const buckets: Bucket[] = [];
  if (period === 'year') {
    const y = Number(from.slice(0, 4));
    for (let m = 1; m <= 12; m++) {
      buckets.push({
        key: `${y}-${pad(m)}`,
        from: `${y}-${pad(m)}-01`,
        to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`,
        sum: 0, paid: 0, unpaid: 0, expense: 0, expense_count: 0,
      });
    }
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      buckets.push({ key: d, from: d, to: d, sum: 0, paid: 0, unpaid: 0, expense: 0, expense_count: 0 });
    }
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const r of rows) {
    const b = byKey.get(period === 'year' ? r.date.slice(0, 7) : r.date);
    if (!b) continue; // строка вне периода — игнорируем
    b.sum += Number(r.sum) || 0;
    b.paid += Number(r.paid) || 0;
    b.unpaid += Number(r.unpaid) || 0;
  }
  for (const r of expenseRows) {
    const b = byKey.get(period === 'year' ? r.date.slice(0, 7) : r.date);
    if (!b) continue;
    b.expense += Number(r.sum) || 0;
    b.expense_count += Number(r.count) || 0;
  }
  return buckets;
}

export function buildIncomeReport(
  period: Period,
  from: string,
  to: string,
  rows: DayRow[],
  prevRows: DayRow[],
  expenseRows: ExpenseDayRow[] = [],
  prevExpenseRows: ExpenseDayRow[] = [],
  materials: MaterialRow[] = [],
): IncomeReport {
  const buckets = buildBuckets(period, from, to, rows, expenseRows);
  const total = buckets.reduce((s, b) => s + b.sum, 0);
  const paid = buckets.reduce((s, b) => s + b.paid, 0);
  const unpaid = buckets.reduce((s, b) => s + b.unpaid, 0);
  const prev_total = prevRows.reduce((s, r) => s + (Number(r.sum) || 0), 0);
  const total_expense = buckets.reduce((s, b) => s + b.expense, 0);
  const expense_count = buckets.reduce((s, b) => s + b.expense_count, 0);
  const prev_expense = prevExpenseRows.reduce((s, r) => s + (Number(r.sum) || 0), 0);
  return {
    period, from, to, buckets, total, paid, unpaid,
    avg: paid ? Math.round(total / paid) : 0,
    prev_total,
    total_expense, expense_count, prev_expense,
    profit: total - total_expense,
    materials: materials.map((m) => ({ name: m.name, sum: Number(m.sum) || 0, count: Number(m.count) || 0 })),
  };
}
