// Минимальный клиент Telegram Bot API через fetch
import type { Env } from '../types';

/** Ответ Bot API. При сетевой ошибке возвращаем ok:false без error_code (исключения наружу не бросаем). */
export interface TgResult {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: any;
}

async function parse(res: Response, method: string): Promise<TgResult> {
  const data = (await res.json().catch(() => null)) as TgResult | null;
  if (!data) {
    console.error('Telegram API: некорректный ответ', method, res.status);
    return { ok: false, error_code: res.status, description: 'bad response' };
  }
  if (!data.ok) console.error('Telegram API error', method, data.error_code, data.description);
  return data;
}

export async function tg(env: Env, method: string, body: Record<string, unknown>): Promise<TgResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await parse(res, method);
  } catch (e) {
    console.error('Telegram fetch error', method, e);
    return { ok: false, description: String(e) };
  }
}

export const sendMessage = (env: Env, chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

export const deleteMessage = (env: Env, chatId: number, messageId: number) =>
  tg(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });

/** Отправка файла документом в чат пользователя (multipart/form-data) */
export async function sendDocument(
  env: Env,
  chatId: number,
  file: Blob | Uint8Array,
  filename: string,
  caption = '',
): Promise<TgResult> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  const blob = file instanceof Blob ? file : new Blob([file]);
  form.append('document', blob, filename);

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    return await parse(res, 'sendDocument');
  } catch (e) {
    console.error('Telegram fetch error sendDocument', e);
    return { ok: false, description: String(e) };
  }
}

/** Кнопка открытия Mini App. Адрес берём из запроса, поэтому хардкодить домен не нужно. */
export const openAppKeyboard = (appUrl: string, label = '📅 Открыть ежедневник') =>
  appUrl.startsWith('https://')
    ? { reply_markup: { inline_keyboard: [[{ text: label, web_app: { url: appUrl } }]] } }
    : {}; // без https кнопку Telegram не примет

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
