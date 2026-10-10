import { describe, expect, it } from 'vitest';
import { timeLabel, formatDay } from '../src/lib/format';
import type { Appointment } from '../src/types';

describe('timeLabel', () => {
  it('возвращает только start_time, если end_time отсутствует', () => {
    expect(timeLabel({ start_time: '18:00', end_time: null })).toBe('18:00');
  });

  it('показывает только время начала, даже если конец сохранён', () => {
    expect(timeLabel({ start_time: '18:00', end_time: '20:00' })).toBe('18:00');
  });
});

describe('formatDay', () => {
  it('форматирует день с записями без end_time', () => {
    const appt: Appointment = {
      id: 1,
      user_id: 123,
      date: '2026-10-10',
      start_time: '14:00',
      end_time: null,
      client_name: 'Анна',
      who: null,
      service: 'manicure',
      manicure_coating: 'gel',
      pedicure_coating: null,
      comment: null,
      created_at: '',
      updated_at: '',
    };
    const formatted = formatDay('2026-10-10', [appt]);
    expect(formatted).toContain('🕐 <b>14:00</b> · Анна');
    expect(formatted).toContain('💅 маникюр с покрытием');
  });

  it('показывает услугу «пальцы» без покрытия', () => {
    const appt: any = {
      id: 2, user_id: 1, date: '2026-10-10', start_time: '15:00', end_time: null,
      client_name: 'Инна', who: null, service: 'fingers',
      manicure_coating: null, pedicure_coating: null, comment: null,
    };
    const formatted = formatDay('2026-10-10', [appt]);
    expect(formatted).toContain('💅 пальцы');
    expect(formatted).not.toContain('покрыт');
  });
});
