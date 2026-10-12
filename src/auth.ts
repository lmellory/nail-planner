// Проверка подписи Telegram initData через WebCrypto (HMAC-SHA256).
// Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import type { Context, Next } from 'hono';
import type { AppVars, Env } from './types';
import { getUser } from './db';
import { getAccessState, isAdmin, isAllowedUser } from './lib/access';

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function parseAllowedIds(raw: string): number[] {
  return raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

/** Возвращает id пользователя или null, если подпись неверна / данные устарели. */
export async function verifyInitData(initData: string, botToken: string, maxAgeSec = 86400): Promise<number | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmac(enc.encode('WebAppData'), botToken);
  const calc = toHex(await hmac(secretKey, dataCheckString));
  if (!safeEqual(calc, hash)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get('user') ?? '');
    return typeof user.id === 'number' ? user.id : null;
  } catch {
    return null;
  }
}

/** Данные пользователя Telegram из подписанного initData (имя, @username). Вызывать после verifyInitData. */
export function parseInitDataUser(initData: string): { id: number; name: string; username: string | null } | null {
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') ?? '');
    if (typeof user?.id !== 'number') return null;
    const name = [user.first_name, user.last_name].filter((x) => typeof x === 'string' && x).join(' ').trim().slice(0, 100);
    const username = typeof user.username === 'string' && user.username ? user.username.slice(0, 64) : null;
    return { id: user.id, name, username };
  } catch {
    return null;
  }
}

/**
 * Что администратор может делать от имени мастера (заголовок X-Act-As): только записи.
 * Записи — любые действия; чтение — то, что нужно форме записи и расписанию (дни, окна, клиенты для подсказок, цены, настройки, заметки).
 * Всё остальное (доходы, траты, клиенты и заметки на запись, настройки, прайс, импорт, экспорт) в этом режиме закрыто.
 */
export function actAsAllowed(method: string, pathname: string): boolean {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/');
  if (under('/api/appointments')) return true;
  if (method !== 'GET') return false;
  return ['/api/days', '/api/search', '/api/clients', '/api/prices', '/api/settings', '/api/notes'].some(under);
}

/**
 * Middleware для /api/*: клиент шлёт заголовок X-Init-Data. Личность берём ТОЛЬКО из подписи.
 * Пускаем мастеров с доступом (ALLOWED_IDS + /adduser, минус /ban) и администраторов (ADMIN_ID).
 *
 * Администратор может прислать заголовок X-Act-As: <ID мастера>: тогда запрос выполняется над данными
 * этого мастера (так админ-панель правит записи через те же проверки, что и обычное приложение),
 * но только для записей (см. actAsAllowed).
 * Все такие изменения пишутся в лог. userId — чьи данные, actorId — кто вошёл.
 */
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) {
  const initData = c.req.header('X-Init-Data') ?? '';
  const actorId = await verifyInitData(initData, c.env.BOT_TOKEN);
  if (!actorId) return c.json({ error: 'forbidden' }, 403);

  const admin = isAdmin(c.env, actorId);
  if (!admin && !(await isAllowedUser(c.env, actorId))) return c.json({ error: 'forbidden' }, 403);

  let targetId = actorId;
  const actAs = c.req.header('X-Act-As');
  if (actAs) {
    if (!admin) return c.json({ error: 'forbidden' }, 403);
    if (!actAsAllowed(c.req.method, new URL(c.req.url).pathname)) {
      // 400, а не 403: приложение на 403 показывает «сессия устарела»
      return c.json({ error: 'В режиме правки за мастера эта функция недоступна' }, 400);
    }
    if (!/^\d{1,15}$/.test(actAs.trim()) || Number(actAs) <= 0) return c.json({ error: 'Некорректный ID мастера' }, 400);
    targetId = Number(actAs);
    const known = (await getUser(c.env.DB, targetId)) || (await getAccessState(c.env, targetId)) === 'allowed';
    if (!known) return c.json({ error: 'Мастер не найден' }, 404);
  }

  c.set('actorId', actorId);
  c.set('isAdmin', admin);
  c.set('userId', targetId);
  await next();

  if (targetId !== actorId && c.req.method !== 'GET') {
    console.log(`admin-act actor=${actorId} target=${targetId} ${c.req.method} ${new URL(c.req.url).pathname} status=${c.res.status}`);
  }
}
