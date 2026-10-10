import { describe, expect, it } from 'vitest';
import { buildBuckets, buildIncomeReport, isPeriod, periodRange, previousRange } from '../src/lib/stats';

describe('periodRange', () => {
  it('неделя: с понедельника по воскресенье для любого дня недели', () => {
    // 2026-10-10 — суббота
    expect(periodRange('week', '2026-10-10')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(periodRange('week', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-11' }); // понедельник
    expect(periodRange('week', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' }); // воскресенье
  });

  it('неделя на стыке месяцев и годов', () => {
    expect(periodRange('week', '2026-12-31')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  it('месяц: учитывает длину месяца и високосный год', () => {
    expect(periodRange('month', '2026-10-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('month', '2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('month', '2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('год: с 1 января по 31 декабря', () => {
    expect(periodRange('year', '2026-06-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('previousRange', () => {
  it('прошлая неделя / месяц / год', () => {
    expect(previousRange('week', '2026-10-10')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(previousRange('month', '2026-10-10')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousRange('year', '2026-10-10')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('январь → декабрь прошлого года', () => {
    expect(previousRange('month', '2026-01-20')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('buildBuckets', () => {
  it('неделя: 7 корзин по дням, пустые дни = 0', () => {
    const b = buildBuckets('week', '2026-10-05', '2026-10-11', [
      { date: '2026-10-07', sum: 1500, paid: 2, unpaid: 1 },
    ]);
    expect(b).toHaveLength(7);
    expect(b[2]).toMatchObject({ key: '2026-10-07', sum: 1500, paid: 2, unpaid: 1 });
    expect(b[0].sum).toBe(0);
  });

  it('месяц: столько корзин, сколько дней в месяце', () => {
    expect(buildBuckets('month', '2026-02-01', '2026-02-28', [])).toHaveLength(28);
    expect(buildBuckets('month', '2028-02-01', '2028-02-29', [])).toHaveLength(29);
  });

  it('год: 12 корзин, дни складываются в свой месяц', () => {
    const b = buildBuckets('year', '2026-01-01', '2026-12-31', [
      { date: '2026-03-01', sum: 1000, paid: 1, unpaid: 0 },
      { date: '2026-03-31', sum: 500, paid: 1, unpaid: 0 },
      { date: '2026-12-31', sum: 700, paid: 1, unpaid: 0 },
    ]);
    expect(b).toHaveLength(12);
    expect(b[2]).toMatchObject({ key: '2026-03', sum: 1500, paid: 2 });
    expect(b[11].sum).toBe(700);
  });

  it('строки вне периода игнорируются, строковые числа из БД приводятся', () => {
    const b = buildBuckets('week', '2026-10-05', '2026-10-11', [
      { date: '2026-09-01', sum: 999, paid: 1, unpaid: 0 },
      { date: '2026-10-06', sum: '800' as any, paid: '1' as any, unpaid: '0' as any },
    ]);
    expect(b.reduce((s, x) => s + x.sum, 0)).toBe(800);
  });
});

describe('buildIncomeReport', () => {
  it('считает итог, средний чек и сумму прошлого периода', () => {
    const r = buildIncomeReport(
      'week', '2026-10-05', '2026-10-11',
      [
        { date: '2026-10-05', sum: 1000, paid: 1, unpaid: 0 },
        { date: '2026-10-08', sum: 2000, paid: 2, unpaid: 1 },
      ],
      [{ date: '2026-09-30', sum: 1500, paid: 1, unpaid: 0 }],
    );
    expect(r).toMatchObject({ total: 3000, paid: 3, unpaid: 1, avg: 1000, prev_total: 1500 });
  });

  it('без записей с ценой средний чек = 0, без деления на ноль', () => {
    const r = buildIncomeReport('month', '2026-10-01', '2026-10-31', [], []);
    expect(r).toMatchObject({ total: 0, paid: 0, avg: 0, prev_total: 0 });
  });
});

describe('isPeriod', () => {
  it('принимает только week / month / year', () => {
    expect(isPeriod('week') && isPeriod('month') && isPeriod('year')).toBe(true);
    expect(isPeriod('day')).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });
});
