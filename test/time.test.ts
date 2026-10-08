import { describe, expect, it } from 'vitest';
import { addDays, isDate, isTime, nowInTz, weekdayRu } from '../src/lib/time';

describe('addDays', () => {
  it('сдвигает внутри месяца', () => {
    expect(addDays('2026-10-08', 1)).toBe('2026-10-09');
    expect(addDays('2026-10-08', -7)).toBe('2026-10-01');
  });

  it('переходит через границу месяца и года', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('учитывает високосный год', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('ноль дней не меняет дату', () => {
    expect(addDays('2026-10-08', 0)).toBe('2026-10-08');
  });
});

describe('isDate', () => {
  it('принимает существующие даты', () => {
    expect(isDate('2026-10-08')).toBe(true);
    expect(isDate('2028-02-29')).toBe(true);
  });

  it('отклоняет несуществующие и неверный формат', () => {
    expect(isDate('2026-02-31')).toBe(false);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2026-1-1')).toBe(false);
    expect(isDate('08.10.2026')).toBe(false);
    expect(isDate('')).toBe(false);
    expect(isDate(null)).toBe(false);
    expect(isDate(20261008)).toBe(false);
  });
});

describe('isTime', () => {
  it('принимает HH:MM', () => {
    expect(isTime('00:00')).toBe(true);
    expect(isTime('09:30')).toBe(true);
    expect(isTime('23:59')).toBe(true);
  });

  it('отклоняет некорректное время', () => {
    expect(isTime('24:00')).toBe(false);
    expect(isTime('12:60')).toBe(false);
    expect(isTime('9:30')).toBe(false);
    expect(isTime('12:30:00')).toBe(false);
    expect(isTime(undefined)).toBe(false);
  });
});

describe('nowInTz', () => {
  it('переводит UTC в часовой пояс', () => {
    const d = new Date('2026-10-08T20:30:00Z');
    expect(nowInTz('UTC', d)).toEqual({ date: '2026-10-08', time: '20:30' });
    expect(nowInTz('Europe/Moscow', d)).toEqual({ date: '2026-10-08', time: '23:30' });
  });

  it('меняет дату при переходе через полночь', () => {
    const d = new Date('2026-10-08T20:30:00Z');
    expect(nowInTz('Asia/Tbilisi', d)).toEqual({ date: '2026-10-09', time: '00:30' });
  });

  it('полночь выводится как 00:00, а не 24:00', () => {
    const d = new Date('2026-10-08T21:00:00Z'); // Москва UTC+3
    expect(nowInTz('Europe/Moscow', d)).toEqual({ date: '2026-10-09', time: '00:00' });
  });

  it('некорректный часовой пояс бросает RangeError', () => {
    expect(() => nowInTz('Mars/Olympus')).toThrow(RangeError);
  });
});

describe('weekdayRu', () => {
  it('возвращает день недели по-русски', () => {
    expect(weekdayRu('2026-10-08')).toBe('четверг');
    expect(weekdayRu('2026-10-11')).toBe('воскресенье');
    expect(weekdayRu('2026-10-12')).toBe('понедельник');
  });
});
