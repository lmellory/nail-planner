import type { Database } from '../types';
// Запросы prices. Данные мастера всегда ограничиваются user_id.

// ===== Прайс услуг и полная выгрузка клиентов =====

/** Цены услуг мастера: { manicure: 800, ... } (только заданные). */
export async function getServicePrices(db: Database, userId: number): Promise<Record<string, number>> {
  const r = await db
    .prepare('SELECT service, price FROM service_prices WHERE user_id = ?')
    .bind(userId)
    .all<{ service: string; price: number }>();
  return Object.fromEntries(r.results.map((x) => [x.service, Number(x.price)]));
}

/** Задаёт цену услуги; null — убирает цену. */
export async function setServicePrice(db: Database, userId: number, service: string, price: number | null): Promise<void> {
  if (price === null) {
    await db.prepare('DELETE FROM service_prices WHERE user_id = ? AND service = ?').bind(userId, service).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO service_prices (user_id, service, price) VALUES (?,?,?)
       ON CONFLICT(user_id, service) DO UPDATE SET price = excluded.price`,
    )
    .bind(userId, service, price)
    .run();
}

/** Весь прайс сохраняется одной транзакцией. */
export async function setServicePrices(db: Database, userId: number, changes: Array<[string, number | null]>): Promise<void> {
  if (!changes.length) return;
  await db.batch(changes.map(([service, price]) => price === null
    ? db.prepare('DELETE FROM service_prices WHERE user_id=? AND service=?').bind(userId, service)
    : db.prepare('INSERT INTO service_prices (user_id, service, price) VALUES (?,?,?) ON CONFLICT(user_id, service) DO UPDATE SET price=excluded.price').bind(userId, service, price)));
}
