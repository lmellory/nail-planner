// Проверка подписи Telegram initData через WebCrypto (HMAC-SHA256).
// Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import type { Context, Next } from 'hono';
import type { AppVars, Env } from './types';

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

/** Middleware для /api/*: клиент шлёт заголовок X-Init-Data. user_id берём ТОЛЬКО из подписи. */
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) {
  const initData = c.req.header('X-Init-Data') ?? '';
  const userId = await verifyInitData(initData, c.env.BOT_TOKEN);
  if (!userId || !parseAllowedIds(c.env.ALLOWED_IDS).includes(userId)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  c.set('userId', userId);
  await next();
}
