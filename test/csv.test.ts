import { describe, expect, it } from 'vitest';
import { buildCsv, csvEscape } from '../src/api/export';

describe('csvEscape', () => {
  it('возвращает пустую строку для null и undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('не ломает телефонные номера с плюсом', () => {
    expect(csvEscape('+79991234567')).toBe('+79991234567');
    expect(csvEscape('+7 (999) 123-45-67')).toBe('+7 (999) 123-45-67');
    expect(csvEscape('+380501234567')).toBe('+380501234567');
  });

  it('экранирует потенциальные формульные инъекции Excel (=, -, @, +, табуляция)', () => {
    expect(csvEscape('=1+2')).toBe("'=1+2");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape('-5*2')).toBe("'-5*2");
    // Если плюс, но не телефон
    expect(csvEscape('+calc()')).toBe("'+calc()");
  });

  it('оборачивает в кавычки и дублирует кавычки при наличии точек с запятой и перевода строк', () => {
    expect(csvEscape('Иванова; Анна')).toBe('"Иванова; Анна"');
    expect(csvEscape('Заметка с "кавычками"')).toBe('"Заметка с ""кавычками"""');
    expect(csvEscape("Строка 1\nСтрока 2")).toBe("\"Строка 1\nСтрока 2\"");
  });
});

describe('buildCsv', () => {
  it('добавляет колонку «цена» (пусто, если цена не указана)', () => {
    const base: any = {
      id: 1, user_id: 1, date: '2026-10-10', start_time: '10:00', end_time: '11:00',
      client_name: 'Инна', who: null, service: 'fingers',
      manicure_coating: null, pedicure_coating: null, comment: null,
    };
    const lines = buildCsv([{ ...base, price: 800 }, { ...base, id: 2, price: null }]).split('\r\n');
    expect(lines[0]).toContain('покрытие;цена;комментарий');
    expect(lines[1]).toBe('2026-10-10;10:00;11:00;Инна;;пальцы;;800;');
    expect(lines[2]).toBe('2026-10-10;10:00;11:00;Инна;;пальцы;;;');
  });
});
