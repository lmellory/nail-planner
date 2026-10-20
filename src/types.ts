/** Только операции, которые реализует адаптер Turso и использует приложение. */
export type Database = Pick<D1Database, 'prepare' | 'batch' | 'exec'>;

// Общие типы проекта
export interface Env {
  DB: Database;
  ASSETS: Fetcher;
  BOT_TOKEN: string;       // secret
  ALLOWED_IDS: string;     // secret: "123,456"
  ADMIN_ID?: string;       // Telegram ID администраторов через запятую (wrangler.toml [vars]): команды бота и админ-панель Mini App
  VIEWER_IDS?: string;     // Telegram ID наблюдателей через запятую (wrangler.toml [vars]): только /records, без правки и без остальных команд
  WEBHOOK_SECRET: string;  // secret
  TZ: string;              // wrangler.toml [vars]
  ENABLE_ID_COMMAND?: string;
  APP_URL?: string;        // https-адрес Worker, например https://nail-planner.xxx.workers.dev/
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}

import type { Status } from './lib/status';

export type Service = typeof import('./lib/services').SERVICES[number];
export type Coating = 'gel' | 'none';

export interface Appointment {
  id: number;
  user_id: number;
  date: string;
  start_time: string;
  end_time: string | null; // null допускается для совместимости со старыми записями
  client_name: string;
  who: string | null;
  service: Service;
  manicure_coating: Coating | null;
  pedicure_coating: Coating | null;
  comment: string | null;
  price: number | null; // цена в валюте мастера, целое число; null — не указана
  status: Status;       // scheduled | no_show | cancelled
}

export interface Expense {
  id: number;
  user_id: number;
  date: string;   // YYYY-MM-DD
  name: string;   // на что потрачено
  amount: number; // целое число > 0
}
export type ExpenseInput = Omit<Expense, 'id' | 'user_id'>;

export interface UserRow {
  user_id: number;
  tz: string;
  notify_enabled: number;
  notify_time: string;
  last_notified_date: string | null;
  notify_new_appt: number;
  work_start_time?: string; // '09:00'
  work_end_time?: string;   // '20:00'
  work_days?: string;       // '1,2,3,4,5,6' (1=Пн, 7=Вс)
  last_birthday_notify_date?: string | null;
  backup_enabled?: number;          // 1 — присылать еженедельную копию (по умолчанию)
  last_backup_date?: string | null; // дата воскресного «слота», за который копия отправлена
}

export interface Client {
  id: number;
  user_id: number;
  name: string;
  phone: string | null;
  telegram: string | null;
  notes: string | null;
  birthday?: string | null; // 'DD.MM' (например '15.03')
  created_at: string;
  updated_at: string;
  appointments_count?: number;
  last_visit?: string | null;
  next_visit?: string | null;
}

export interface FreeSlot {
  start: string;
  end: string;
  duration_minutes: number;
}

// Переменные Hono-контекста (кладём туда проверенный user_id)
// userId — чьи данные обрабатывает запрос (мастер); actorId — кто реально вошёл (при «правке за мастера» они разные)
export type AppVars = { userId: number; actorId: number; isAdmin: boolean };
