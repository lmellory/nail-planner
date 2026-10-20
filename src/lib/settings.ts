import type { Database } from '../types';
import type { UserRow } from '../types';
import { isTime } from './time';

export interface UserSettings {
  notify_enabled?: boolean | number;
  notify_time?: string;
  tz?: string;
  notify_new_appt?: boolean | number;
  work_start_time?: string;
  work_end_time?: string;
  work_days?: string;
  backup_enabled?: boolean | number;
}

export function settingsView(u: UserRow) {
  return {
    notify_enabled: !!u.notify_enabled, notify_time: u.notify_time, tz: u.tz,
    notify_new_appt: !!u.notify_new_appt,
    work_start_time: u.work_start_time ?? '09:00', work_end_time: u.work_end_time ?? '20:00',
    work_days: u.work_days ?? '1,2,3,4,5,6', backup_enabled: u.backup_enabled !== 0,
  };
}

/** Пустой список означает отсутствие рабочих дней и не заменяется значением по умолчанию. */
export function isWorkDays(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^[1-7](,[1-7])*$/.test(value)) &&
    new Set(value.split(',')).size === value.split(',').length;
}

export function validateSchedule(start: unknown, end: unknown, days: unknown): string | null {
  if (!isTime(start) || !isTime(end) || end <= start) return 'Конец рабочего дня должен быть позже начала';
  if (!isWorkDays(days)) return 'Рабочие дни: выберите дни с понедельника по воскресенье';
  return null;
}

/** Обновляет только указанные поля: подходит и для отдельного запроса, и для общей транзакции импорта. */
export function settingsStatement(db: Database, userId: number, settings: UserSettings): D1PreparedStatement | null {
  const keys = ['notify_enabled', 'notify_time', 'tz', 'notify_new_appt', 'work_start_time', 'work_end_time', 'work_days', 'backup_enabled'] as const;
  const entries = keys.filter(key => settings[key] !== undefined).map(key => {
    const value = settings[key]!;
    return [key, typeof value === 'boolean' ? Number(value) : value] as const;
  });
  if (!entries.length) return null;
  return db.prepare(`UPDATE users SET ${entries.map(([key]) => `${key}=?`).join(', ')} WHERE user_id=?`)
    .bind(...entries.map(([, value]) => value), userId);
}
