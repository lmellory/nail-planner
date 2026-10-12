/** Убирает лишние пробелы, режет до 100 символов, первая буква заглавная («гель  лак» → «Гель лак»). */
export function normalizeName(raw: unknown): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const [first, ...rest] = Array.from(s).slice(0, 100);
  return first ? first.toUpperCase() + rest.join('') : '';
}
