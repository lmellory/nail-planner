import { describe, expect, it } from 'vitest';
import { validate } from '../src/api/appointments';

describe('validate appointment input', () => {
  it('успешно валидирует корректную запись на маникюр с авто-расчетом конца (2ч)', () => {
    const input = {
      date: '2026-10-15',
      start_time: '14:00',
      client_name: 'Мария Иванова',
      service: 'manicure',
      manicure_coating: 'gel',
    };
    const [data, err] = validate(input);
    expect(err).toBeNull();
    expect(data).toBeDefined();
    expect(data?.start_time).toBe('14:00');
    expect(data?.end_time).toBe('16:00'); // +120 мин
    expect(data?.client_name).toBe('Мария Иванова');
    expect(data?.manicure_coating).toBe('gel');
    expect(data?.pedicure_coating).toBeNull();
  });

  it('успешно рассчитывает конец для педикюра (1.5ч) и комплекса (3.5ч)', () => {
    const [pediData] = validate({
      date: '2026-10-15',
      start_time: '10:00',
      client_name: 'Ольга',
      service: 'pedicure',
      pedicure_coating: 'none',
    });
    expect(pediData?.end_time).toBe('11:30');

    const [bothData] = validate({
      date: '2026-10-15',
      start_time: '12:00',
      client_name: 'Светлана',
      service: 'both',
      manicure_coating: 'gel',
      pedicure_coating: 'gel',
    });
    expect(bothData?.end_time).toBe('15:30');
  });

  it('услуга «пальцы»: конец +1 ч, покрытие не требуется и не сохраняется', () => {
    const [data, err] = validate({
      date: '2026-10-15',
      start_time: '10:00',
      client_name: 'Инна',
      service: 'fingers',
      // даже если фронт прислал покрытия, для «пальцев» они обнуляются
      manicure_coating: 'gel',
      pedicure_coating: 'gel',
    });
    expect(err).toBeNull();
    expect(data?.service).toBe('fingers');
    expect(data?.end_time).toBe('11:00');
    expect(data?.manicure_coating).toBeNull();
    expect(data?.pedicure_coating).toBeNull();
  });

  describe('цена', () => {
    const base = { date: '2026-10-15', start_time: '10:00', client_name: 'Инна', service: 'fingers' };

    it('не указана → null', () => {
      expect(validate(base)[0]?.price).toBeNull();
      expect(validate({ ...base, price: '' })[0]?.price).toBeNull();
      expect(validate({ ...base, price: null })[0]?.price).toBeNull();
    });

    it('принимает число, строку и строку с пробелами', () => {
      expect(validate({ ...base, price: 800 })[0]?.price).toBe(800);
      expect(validate({ ...base, price: '1200' })[0]?.price).toBe(1200);
      expect(validate({ ...base, price: '1 500' })[0]?.price).toBe(1500);
      expect(validate({ ...base, price: 0 })[0]?.price).toBe(0);
    });

    it('отклоняет дробные, отрицательные, слишком большие и нечисловые значения', () => {
      for (const price of [12.5, -1, 10_000_001, 'abc', NaN]) {
        const [d, err] = validate({ ...base, price });
        expect(d).toBeNull();
        expect(err).toContain('Цена');
      }
    });
  });

  describe('статус', () => {
    const base = { date: '2026-10-15', start_time: '10:00', client_name: 'Инна', service: 'fingers' };

    it('по умолчанию scheduled', () => {
      expect(validate(base)[0]?.status).toBe('scheduled');
      expect(validate({ ...base, status: null })[0]?.status).toBe('scheduled');
    });
    it('принимает no_show и cancelled', () => {
      expect(validate({ ...base, status: 'no_show' })[0]?.status).toBe('no_show');
      expect(validate({ ...base, status: 'cancelled' })[0]?.status).toBe('cancelled');
    });
    it('отклоняет неизвестный статус', () => {
      const [d, err] = validate({ ...base, status: 'done' });
      expect(d).toBeNull();
      expect(err).toContain('статус');
    });
  });

  it('сохраняет переданный явный end_time, если он корректен', () => {
    const input = {
      date: '2026-10-15',
      start_time: '14:00',
      end_time: '15:00',
      client_name: 'Елена',
      service: 'manicure',
      manicure_coating: 'none',
    };
    const [data, err] = validate(input);
    expect(err).toBeNull();
    expect(data?.end_time).toBe('15:00');
  });

  it('отклоняет некорректную дату и время', () => {
    const [d1, err1] = validate({ date: '2026-02-31', start_time: '10:00', client_name: 'А', service: 'manicure' });
    expect(err1).toBe('Некорректная дата');

    const [d2, err2] = validate({ date: '2026-10-15', start_time: '25:00', client_name: 'А', service: 'manicure' });
    expect(err2).toBe('Некорректное время');
  });

  it('отклоняет пустое имя клиента', () => {
    const [data, err] = validate({
      date: '2026-10-15',
      start_time: '14:00',
      client_name: '   ',
      service: 'manicure',
      manicure_coating: 'gel',
    });
    expect(err).toBe('Укажи имя клиента');
  });

  it('отклоняет время окончания раньше или равное времени начала', () => {
    const [data, err] = validate({
      date: '2026-10-15',
      start_time: '14:00',
      end_time: '13:30',
      client_name: 'Мария',
      service: 'manicure',
      manicure_coating: 'gel',
    });
    expect(err).toBe('Конец должен быть позже начала');
  });

  it('требует указания покрытия', () => {
    const [, err1] = validate({
      date: '2026-10-15',
      start_time: '14:00',
      client_name: 'Мария',
      service: 'manicure',
    });
    expect(err1).toBe('Укажи покрытие: с покрытием или без');

    const [, err2] = validate({
      date: '2026-10-15',
      start_time: '14:00',
      client_name: 'Мария',
      service: 'both',
      manicure_coating: 'gel',
      // pedicure_coating missing
    });
    expect(err2).toBe('Укажи покрытие: с покрытием или без');
  });
});

import { cleanBirthday } from '../src/api/clients';

describe('cleanBirthday', () => {
  it('нормализует корректные даты DD.MM', () => {
    expect(cleanBirthday('15.03')).toBe('15.03');
    expect(cleanBirthday('9.10')).toBe('09.10');
    expect(cleanBirthday('09-10')).toBe('09.10');
    expect(cleanBirthday(' 01.01 ')).toBe('01.01');
  });

  it('возвращает null для пустых значений', () => {
    expect(cleanBirthday(null)).toBeNull();
    expect(cleanBirthday(undefined)).toBeNull();
    expect(cleanBirthday('')).toBeNull();
    expect(cleanBirthday('   ')).toBeNull();
  });

  it('отклоняет некорректные дни и месяцы', () => {
    expect(cleanBirthday('32.05')).toBeNull();
    expect(cleanBirthday('00.05')).toBeNull();
    expect(cleanBirthday('15.13')).toBeNull();
    expect(cleanBirthday('не_дата')).toBeNull();
    expect(cleanBirthday('15.03.1995')).toBeNull(); // год не допускается
  });
});

