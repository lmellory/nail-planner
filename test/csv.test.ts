import { describe, expect, it } from 'vitest';
import { csvEscape } from '../src/api/export';

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
