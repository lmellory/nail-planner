// Общие типы проекта
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOT_TOKEN: string;       // secret
  ALLOWED_IDS: string;     // secret: "123,456"
  WEBHOOK_SECRET: string;  // secret
  TZ: string;              // wrangler.toml [vars]
  ENABLE_ID_COMMAND?: string;
  APP_URL?: string;        // https-адрес Worker, например https://nail-planner.xxx.workers.dev/
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}

export type Service = 'manicure' | 'pedicure' | 'both';
export type Coating = 'gel' | 'none';

export interface Appointment {
  id: number;
  user_id: number;
  date: string;
  start_time: string;
  end_time: string | null; // у новых записей null, у старых может быть значение
  client_name: string;
  who: string | null;
  service: Service;
  manicure_coating: Coating | null;
  pedicure_coating: Coating | null;
  comment: string | null;
}

export interface UserRow {
  user_id: number;
  tz: string;
  notify_enabled: number;
  notify_time: string;
  last_notified_date: string | null;
  notify_new_appt: number;
}

// Переменные Hono-контекста (кладём туда проверенный user_id)
export type AppVars = { userId: number };
