import { describe, expect, it } from 'vitest';
import { isActiveStatus, isHeld, isStatus, STATUS_LABELS_RU, STATUSES } from '../src/lib/status';
import { formatDay } from '../src/lib/format';
import { buildIncomeReport } from '../src/lib/stats';

describe('status', () => {
  it('isStatus: только известные значения', () => {
    for (const s of STATUSES) expect(isStatus(s)).toBe(true);
    for (const s of ['done', '', null, undefined, 1]) expect(isStatus(s)).toBe(false);
  });

  it('у каждого статуса есть русская подпись', () => {
    for (const s of STATUSES) expect(STATUS_LABELS_RU[s]).toBeTruthy();
  });

  it('isActiveStatus: живая только scheduled (и пустой статус старых данных)', () => {
    expect(isActiveStatus('scheduled')).toBe(true);
    expect(isActiveStatus(undefined)).toBe(true);
    expect(isActiveStatus(null)).toBe(true);
    expect(isActiveStatus('no_show')).toBe(false);
    expect(isActiveStatus('cancelled')).toBe(false);
    expect(isActiveStatus('что-то новое')).toBe(false);
  });
});

describe('isHeld — запись состоялась к моменту now', () => {
  const now = ['2026-10-14', '12:00'] as const;
  const appt = (o: object) => ({ date: '2026-10-14', start_time: '10:00', status: 'scheduled', ...o });

  it('прошедшие дни и уже начавшиеся сегодня — да', () => {
    expect(isHeld(appt({ date: '2026-10-13' }), ...now)).toBe(true);
    expect(isHeld(appt({ start_time: '10:00' }), ...now)).toBe(true);
    expect(isHeld(appt({ start_time: '12:00' }), ...now)).toBe(true); // ровно сейчас — началась
  });
  it('позже сегодня и будущие дни — нет', () => {
    expect(isHeld(appt({ start_time: '12:01' }), ...now)).toBe(false);
    expect(isHeld(appt({ date: '2026-10-15' }), ...now)).toBe(false);
  });
  it('отменённые и неявки — никогда', () => {
    expect(isHeld(appt({ status: 'cancelled' }), ...now)).toBe(false);
    expect(isHeld(appt({ status: 'no_show', date: '2026-10-01' }), ...now)).toBe(false);
  });
  it('запись без статуса (старые данные) считается живой', () => {
    expect(isHeld({ date: '2026-10-01', start_time: '10:00' }, ...now)).toBe(true);
  });
});

describe('расписание в боте', () => {
  const appt = (id: number, name: string, status: string): any => ({
    id, user_id: 1, date: '2026-10-10', start_time: '1' + id + ':00', end_time: null, client_name: name, who: null,
    service: 'fingers', manicure_coating: null, pedicure_coating: null, comment: null, price: null, status,
  });

  it('отменённые и неявки не показываются', () => {
    const out = formatDay('2026-10-10', [appt(0, 'Инна', 'scheduled'), appt(1, 'Мария', 'cancelled'), appt(2, 'Оля', 'no_show')]);
    expect(out).toContain('Инна');
    expect(out).not.toContain('Мария');
    expect(out).not.toContain('Оля');
  });
  it('если остались только отменённые — «Записей нет»', () => {
    expect(formatDay('2026-10-10', [appt(0, 'Мария', 'cancelled')])).toContain('Записей нет');
  });
});

describe('отчёт: ожидаемое и сорвавшиеся', () => {
  it('extras попадают в отчёт; без них — нули', () => {
    const r = buildIncomeReport('week', '2026-10-05', '2026-10-11', [], [], [], [], [], {
      expected: 2500, expected_count: 3, no_show: 1, cancelled: 2,
    });
    expect(r).toMatchObject({ expected: 2500, expected_count: 3, no_show: 1, cancelled: 2 });
    expect(buildIncomeReport('week', '2026-10-05', '2026-10-11', [], [])).toMatchObject({
      expected: 0, expected_count: 0, no_show: 0, cancelled: 0,
    });
  });
});
