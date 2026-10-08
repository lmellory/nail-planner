// Минимальный клиент Telegram Bot API через fetch
import type { Env } from '../types';

export async function tg(env: Env, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!data.ok) console.error('Telegram API error', method, data.description);
  return data;
}

export const sendMessage = (env: Env, chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

/** Отправка файла документом в чат пользователя (multipart/form-data) */
export async function sendDocument(
  env: Env,
  chatId: number,
  file: Blob | Uint8Array,
  filename: string,
  caption = '',
) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  const blob = file instanceof Blob ? file : new Blob([file]);
  form.append('document', blob, filename);

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!data.ok) console.error('Telegram API error sendDocument', data.description);
  return data;
}

/** Кнопка открытия Mini App. Адрес берём из запроса, поэтому хардкодить домен не нужно. */
export const openAppKeyboard = (appUrl: string, label = '📅 Открыть ежедневник') =>
  appUrl.startsWith('https://')
    ? { reply_markup: { inline_keyboard: [[{ text: label, web_app: { url: appUrl } }]] } }
    : {}; // без https кнопку Telegram не примет

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
