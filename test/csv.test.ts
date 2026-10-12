import { describe, expect, it } from 'vitest';
import { buildCsv, buildFinanceCsv, csvEscape } from '../src/api/export';

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
      manicure_coating: null, pedicure_coating: null, comment: null, status: 'scheduled',
    };
    const lines = buildCsv([{ ...base, price: 800 }, { ...base, id: 2, price: null, status: 'cancelled' }]).split('\r\n');
    expect(lines[0]).toContain('покрытие;цена;статус;комментарий');
    expect(lines[1]).toBe('2026-10-10;10:00;11:00;Инна;;пальцы;;800;запланирована;');
    expect(lines[2]).toBe('2026-10-10;10:00;11:00;Инна;;пальцы;;;отменена;');
  });

  it('подписывает услугу «маникюр + пальцы» без покрытия', () => {
    const a: any = {
      id: 3, user_id: 1, date: '2026-10-10', start_time: '10:00', end_time: '13:00',
      client_name: 'Инна', who: null, service: 'manicure_fingers',
      manicure_coating: null, pedicure_coating: null, comment: null, status: 'scheduled', price: 1500,
    };
    expect(buildCsv([a]).split('\r\n')[1]).toBe('2026-10-10;10:00;13:00;Инна;;маникюр + пальцы;;1500;запланирована;');
  });
});

describe('buildFinanceCsv', () => {
  const appt = (o: any): any => ({
    id: 1, user_id: 1, date: '2026-10-05', start_time: '10:00', end_time: null, client_name: 'Инна',
    who: null, service: 'manicure', manicure_coating: 'gel', pedicure_coating: null, comment: null, price: 800, ...o,
  });
  const exp = (o: any): any => ({ id: 1, user_id: 1, date: '2026-10-05', name: 'Гель-лак', amount: 450, ...o });
  const lines = (csv: string) => csv.replace('\uFEFF', '').split('\r\n');

  it('строки: доходы и траты по датам (в день доход раньше траты), затем итоги', () => {
    const csv = buildFinanceCsv(
      [appt({ date: '2026-10-07', client_name: 'Мария', service: 'pedicure', price: 1200 }), appt({})],
      [exp({ date: '2026-10-05' }), exp({ id: 2, date: '2026-10-06', name: 'Пилки', amount: 150 })],
    );
    const l = lines(csv);
    expect(l[0]).toBe('тип;дата;описание;категория;сумма');
    expect(l.slice(1, 5)).toEqual([
      'доход;2026-10-05;Инна;маникюр;800',
      'трата;2026-10-05;Гель-лак;материалы;450',
      'трата;2026-10-06;Пилки;материалы;150',
      'доход;2026-10-07;Мария;педикюр;1200',
    ]);
    expect(l).toContain('итого доход;;;;2000');
    expect(l).toContain('итого траты;;;;600');
    expect(l).toContain('прибыль;;;;1400');
  });

  it('записи без цены не входят в доход, но их число указано', () => {
    const l = lines(buildFinanceCsv([appt({}), appt({ price: null }), appt({ price: null })], []));
    expect(l).toContain('итого доход;;;;800');
    expect(l).toContain('записей без цены (не учтены);;;;2');
    expect(l.filter((x) => x.startsWith('доход;'))).toHaveLength(1);
  });

  it('отрицательная прибыль остаётся числом (без апострофа защиты от формул)', () => {
    const l = lines(buildFinanceCsv([appt({ price: 100 })], [exp({ amount: 450 })]));
    expect(l).toContain('прибыль;;;;-350');
  });

  it('траты по материалам: одинаковые названия суммируются, большие сверху', () => {
    const l = lines(buildFinanceCsv([], [
      exp({ name: 'Пилки', amount: 100 }), exp({ id: 2, name: 'Гель-лак', amount: 450 }),
      exp({ id: 3, name: 'Гель-лак', amount: 550 }),
    ]));
    const i = l.indexOf('траты по материалам;;;покупок;сумма');
    expect(l.slice(i + 1)).toEqual(['материал;;Гель-лак;2;1000', 'материал;;Пилки;1;100']);
  });

  it('защита от CSV-инъекции в именах и названиях', () => {
    const l = lines(buildFinanceCsv([appt({ client_name: '=SUM(1+1)' })], [exp({ name: '@cmd' })]));
    expect(l[1]).toContain("'=SUM(1+1)");
    expect(l.join('\n')).toContain("'@cmd");
  });

  it('пустой период даёт нули, без падения', () => {
    const l = lines(buildFinanceCsv([], []));
    expect(l).toContain('итого доход;;;;0');
    expect(l).toContain('прибыль;;;;0');
    expect(l.some((x) => x.startsWith('записей без цены'))).toBe(false);
  });
});
