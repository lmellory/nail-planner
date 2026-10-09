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
