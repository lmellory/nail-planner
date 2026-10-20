// Общая валидация клиентов: не зависит от HTTP и используется также при импорте.
export function cleanBirthday(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})[.-](\d{1,2})$/);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]);
  // Високосный год позволяет хранить 29 февраля без года рождения.
  const date = new Date(Date.UTC(2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

export function cleanTelegram(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim().replace(/^@/, '').replace(/^https?:\/\/(?:www\.)?t\.me\//i, '').replace(/\/$/, '');
  return /^[A-Za-z0-9_]{3,32}$/.test(username) ? username : null;
}

export function parseClientPayload(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Некорректные данные клиента' } as const;
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) return { error: 'Имя клиента обязательно' } as const;
  const birthday = body.birthday ? cleanBirthday(body.birthday) : null;
  if (body.birthday && !birthday) return { error: 'Некорректный день рождения (например 15.03)' } as const;
  const telegram = body.telegram ? cleanTelegram(body.telegram) : null;
  // Существующие контакты могут быть произвольным текстом. Строго проверяем только новые значения;
  // API разрешает сохранить прежнее значение при редактировании другой части карточки.
  const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
  return { data: { name, birthday, telegram, phone: text(body.phone, 50), notes: text(body.notes, 1000) },
    invalidTelegram: Boolean(body.telegram && !telegram), rawTelegram: text(body.telegram, 50),
  } as const;
}
