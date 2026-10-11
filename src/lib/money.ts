// Разбор денежных сумм из запросов (цена записи, сумма траты).
export const MAX_AMOUNT = 10_000_000;

/**
 * Целая сумма от 0 до MAX_AMOUNT. Пробелы допускаются («1 500»).
 * Пусто → null («не указано»), некорректное значение → undefined.
 */
export function parseAmount(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isInteger(n) && n >= 0 && n <= MAX_AMOUNT ? n : undefined;
}
