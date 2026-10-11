import { describe, expect, it } from 'vitest';
import { normalizeName, validateExpense } from '../src/api/expenses';
import { parseAmount } from '../src/lib/money';

describe('parseAmount', () => {
  it('пусто → null, число/строка → число', () => {
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(800)).toBe(800);
    expect(parseAmount('1 500')).toBe(1500);
    expect(parseAmount('0')).toBe(0);
  });
  it('некорректное → undefined', () => {
    for (const v of [12.5, -1, 10_000_001, 'abc', NaN]) expect(parseAmount(v)).toBeUndefined();
  });
});

describe('normalizeName', () => {
  it('схлопывает пробелы, делает первую букву заглавной', () => {
    expect(normalizeName('  гель   лак  ')).toBe('Гель лак');
    expect(normalizeName('Пилки')).toBe('Пилки');
  });
  it('пустое и пробелы → пустая строка, длинное обрезается до 100', () => {
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('а'.repeat(300))).toHaveLength(100);
  });
  it('не ломает эмодзи в начале', () => {
    expect(normalizeName('💅 база')).toBe('💅 база');
  });
});

describe('validateExpense', () => {
  const ok = { date: '2026-10-10', name: 'гель-лак', amount: 450 };

  it('валидная трата нормализуется', () => {
    const [d, err] = validateExpense(ok);
    expect(err).toBeNull();
    expect(d).toEqual({ date: '2026-10-10', name: 'Гель-лак', amount: 450 });
  });
  it('сумма строкой с пробелами', () => {
    expect(validateExpense({ ...ok, amount: '1 200' })[0]?.amount).toBe(1200);
  });
  it('плохая дата / пустое название', () => {
    expect(validateExpense({ ...ok, date: '2026-02-31' })[1]).toContain('дата');
    expect(validateExpense({ ...ok, name: '  ' })[1]).toContain('потрачено');
  });
  it('сумма обязательна и должна быть больше нуля', () => {
    for (const amount of [undefined, null, '', 0, -5, 12.5, 'abc', 10_000_001]) {
      const [d, err] = validateExpense({ ...ok, amount });
      expect(d).toBeNull();
      expect(err).toContain('Сумма');
    }
  });
});
