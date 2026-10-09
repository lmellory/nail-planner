import { describe, expect, it } from 'vitest';
import { parseAllowedIds, verifyInitData } from '../src/auth';

const enc = new TextEncoder();

async function createValidInitData(
  user: { id: number; first_name?: string },
  botToken: string,
  authDate: number = Math.floor(Date.now() / 1000),
  extraParams: Record<string, string> = {},
): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(user),
    ...extraParams,
  });

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const key1 = await crypto.subtle.importKey(
    'raw',
    enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secretKey = await crypto.subtle.sign('HMAC', key1, enc.encode(botToken));

  const key2 = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key2, enc.encode(dataCheckString));
  const hash = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  params.set('hash', hash);
  return params.toString();
}

describe('parseAllowedIds', () => {
  it('парсит список ID через запятую и пробелы', () => {
    expect(parseAllowedIds('123, 456, 789')).toEqual([123, 456, 789]);
  });

  it('игнорирует некорректные и отрицательные значения', () => {
    expect(parseAllowedIds('123, abc, -5, 0, 456, ')).toEqual([123, 456]);
  });

  it('возвращает пустой массив для пустой строки', () => {
    expect(parseAllowedIds('')).toEqual([]);
  });
});

describe('verifyInitData', () => {
  const token = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

  it('успешно валидирует корректную подпись и возвращает userId', async () => {
    const initData = await createValidInitData({ id: 987654321, first_name: 'Анна' }, token);
    const id = await verifyInitData(initData, token);
    expect(id).toBe(987654321);
  });

  it('отклоняет, если отсутствует параметр hash', async () => {
    const raw = 'auth_date=1700000000&user=%7B%22id%22%3A123%7D';
    expect(await verifyInitData(raw, token)).toBeNull();
  });

  it('отклоняет подделанные данные с неверным hash', async () => {
    const initData = await createValidInitData({ id: 123 }, token);
    const tampered = initData.replace('id%22%3A123', 'id%22%3A999');
    expect(await verifyInitData(tampered, token)).toBeNull();
  });

  it('отклоняет подпись с чужим botToken', async () => {
    const initData = await createValidInitData({ id: 123 }, 'OTHER_BOT_TOKEN');
    expect(await verifyInitData(initData, token)).toBeNull();
  });

  it('отклоняет просроченный initData (старше maxAgeSec)', async () => {
    const oldDate = Math.floor(Date.now() / 1000) - 90000; // 25 часов назад
    const initData = await createValidInitData({ id: 123 }, token, oldDate);
    expect(await verifyInitData(initData, token, 86400)).toBeNull();
  });

  it('отклоняет некорректный JSON в поле user', async () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: 'not-a-json',
    });
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const key1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secretKey = await crypto.subtle.sign('HMAC', key1, enc.encode(token));
    const key2 = await crypto.subtle.importKey('raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key2, enc.encode(dataCheckString));
    const hash = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
    params.set('hash', hash);

    expect(await verifyInitData(params.toString(), token)).toBeNull();
  });
});
