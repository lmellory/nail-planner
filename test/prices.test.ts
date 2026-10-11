import { describe, expect, it } from 'vitest';
import { parsePricesBody } from '../src/api/prices';

describe('parsePricesBody', () => {
  it('принимает числа, строки и пустые значения', () => {
    expect(parsePricesBody({ manicure: 800, pedicure: '1 200', both: null, fingers: '' })).toEqual({
      ok: true,
      changes: [['manicure', 800], ['pedicure', 1200], ['both', null], ['fingers', null]],
    });
  });

  it('неуказанные услуги не трогает, неизвестные игнорирует', () => {
    expect(parsePricesBody({ manicure: 500, hairdo: 99999 })).toEqual({ ok: true, changes: [['manicure', 500]] });
    expect(parsePricesBody({})).toEqual({ ok: true, changes: [] });
  });

  it('отклоняет дробные, отрицательные, огромные и нечисловые цены', () => {
    for (const v of [12.5, -1, 10_000_001, 'abc']) {
      expect(parsePricesBody({ manicure: v })).toMatchObject({ ok: false });
    }
  });

  it('отклоняет тело не-объект', () => {
    expect(parsePricesBody(null)).toMatchObject({ ok: false });
    expect(parsePricesBody('x')).toMatchObject({ ok: false });
  });
});
