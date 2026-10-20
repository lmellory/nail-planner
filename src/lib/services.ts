// Допустимые услуги. Проверяются в коде (в БД на service больше нет смысла вешать CHECK).
//  manicure — маникюр, pedicure — педикюр, both — оба,
//  manicure_fingers — маникюр + пальцы (без выбора покрытия).
//  fingers — старая отдельная услуга «пальцы»: в форме новой записи её больше нет,
//  но она остаётся допустимой, чтобы старые записи, прайс и резервные копии продолжали работать.
export const SERVICES = ['manicure', 'pedicure', 'both', 'manicure_fingers', 'fingers'] as const;

export function isService(value: unknown): value is typeof SERVICES[number] {
  return typeof value === 'string' && (SERVICES as readonly string[]).includes(value);
}
