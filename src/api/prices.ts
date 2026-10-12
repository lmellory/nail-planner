// Прайс услуг: цена подставляется в форму новой записи.
//   GET /api/prices → { manicure: 800, pedicure: null, both: null, manicure_fingers: 300, fingers: null }  (null — цена не задана)
//   PUT /api/prices ← тот же объект; null/пусто удаляет цену услуги
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { getServicePrices, setServicePrice } from '../db';
import { SERVICES } from '../lib/services';
import { parseAmount } from '../lib/money';

export const prices = new Hono<{ Bindings: Env; Variables: AppVars }>();

/** Разбор тела PUT: только известные услуги; неверная сумма → ошибка. Неуказанные услуги не трогаем. */
export function parsePricesBody(
  body: any,
): { ok: true; changes: Array<[string, number | null]> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Некорректное тело запроса' };
  const changes: Array<[string, number | null]> = [];
  for (const service of SERVICES) {
    if (!(service in body)) continue;
    const price = parseAmount(body[service]);
    if (price === undefined) return { ok: false, error: 'Цена: целое число от 0 до 10 000 000' };
    changes.push([service, price]);
  }
  return { ok: true, changes };
}

async function currentPrices(db: D1Database, userId: number) {
  const saved = await getServicePrices(db, userId);
  return Object.fromEntries(SERVICES.map((s) => [s, saved[s] ?? null]));
}

prices.get('/', async (c) => c.json(await currentPrices(c.env.DB, c.get('userId'))));

prices.put('/', async (c) => {
  const userId = c.get('userId');
  const parsed = parsePricesBody(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  for (const [service, price] of parsed.changes) await setServicePrice(c.env.DB, userId, service, price);
  return c.json(await currentPrices(c.env.DB, userId));
});
