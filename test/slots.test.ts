import { describe, expect, it } from 'vitest';
import { addMinutes, calculateFreeSlots, minutesToTime, timeToMinutes } from '../src/lib/time';

describe('calculateFreeSlots', () => {
  it('находит свободные окна между рабочими часами и записями', () => {
    // Рабочий день 09:00 - 20:00
    // Записи: 10:00 - 12:00, 14:00 - 16:30
    const busy = [
      { start: '10:00', end: '12:00' },
      { start: '14:00', end: '16:30' },
    ];

    const slots = calculateFreeSlots('09:00', '20:00', busy, 60);

    expect(slots).toEqual([
      { start: '09:00', end: '10:00', duration_minutes: 60 },
      { start: '12:00', end: '14:00', duration_minutes: 120 },
      { start: '16:30', end: '20:00', duration_minutes: 210 },
    ]);
  });

  it('игнорирует окна короче минимальной длительности (minDurationMin)', () => {
    // Окно 12:00 - 12:30 длится 30 мин, при minDuration = 60 мин не должно попадать
    const busy = [
      { start: '09:00', end: '12:00' },
      { start: '12:30', end: '18:00' },
    ];
    const slots = calculateFreeSlots('09:00', '18:00', busy, 60);
    expect(slots).toEqual([]);
  });

  it('корректно склеивает пересекающиеся или смежные занятые интервалы', () => {
    const busy = [
      { start: '10:00', end: '12:00' },
      { start: '11:30', end: '13:00' }, // перекрытие
      { start: '13:00', end: '14:00' }, // стык в стык
    ];
    const slots = calculateFreeSlots('09:00', '18:00', busy, 60);
    expect(slots).toEqual([
      { start: '09:00', end: '10:00', duration_minutes: 60 },
      { start: '14:00', end: '18:00', duration_minutes: 240 },
    ]);
  });

  it('если весь день свободен, возвращает одно окно на весь день', () => {
    const slots = calculateFreeSlots('10:00', '18:00', [], 60);
    expect(slots).toEqual([
      { start: '10:00', end: '18:00', duration_minutes: 480 },
    ]);
  });

  it('если весь день занят, возвращает пустой список', () => {
    const slots = calculateFreeSlots('10:00', '18:00', [{ start: '09:00', end: '19:00' }], 60);
    expect(slots).toEqual([]);
  });
});

describe('addMinutes / timeToMinutes / minutesToTime', () => {
  it('переводит время в минуты и обратно', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('добавляет минуты к времени', () => {
    expect(addMinutes('14:00', 120)).toBe('16:00');
    expect(addMinutes('09:30', 90)).toBe('11:00');
    expect(addMinutes('22:00', 150)).toBe('23:59'); // ограничено 23:59
  });
});
