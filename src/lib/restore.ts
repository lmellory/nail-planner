import type { Database } from '../types';
// Восстановление данных из JSON-резервной копии (см. lib/backup.ts).
// Файл проверяется «строго по форме, лениво по мелочам»: чужой или повреждённый файл отклоняется целиком,
// а отдельные битые строки пропускаются и считаются в отчёте. Данные мастера заменяются одной транзакцией.
import { cleanBirthday } from './clients';
import { BACKUP_FORMAT, BACKUP_VERSION } from './backup';
import { parseAmount } from './money';
import { SERVICES } from './services';
import { isStatus } from './status';
import { normalizeName } from './text';
import { isDate, isTime } from './time';
import { settingsStatement, isWorkDays } from './settings';

const MAX_ROWS = 20000;

export interface RestoreAppointment {
  date: string; start_time: string; end_time: string | null; client_name: string; who: string | null;
  service: string; manicure_coating: string | null; pedicure_coating: string | null;
  comment: string | null; price: number | null; status: string;
}
export interface RestoreClient { name: string; phone: string | null; telegram: string | null; notes: string | null; birthday: string | null }
export interface RestoreExpense { date: string; name: string; amount: number }
export interface RestoreSettings {
  notify_enabled?: boolean; notify_time?: string; tz?: string; notify_new_appt?: boolean;
  work_start_time?: string; work_end_time?: string; work_days?: string; backup_enabled?: boolean;
}
export interface RestoreData {
  appointments: RestoreAppointment[];
  clients: RestoreClient[];
  expenses: RestoreExpense[];
  day_notes: { date: string; text: string }[];
  prices: Record<string, number>;
  settings: RestoreSettings;
}
export interface Counted { ok: number; skipped: number }
export interface RestoreReport {
  appointments: Counted; clients: Counted; expenses: Counted; day_notes: Counted;
  prices: number; settings: boolean;
}

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};
const coating = (v: unknown) => (v === 'gel' || v === 'none' ? v : null);

function sanitizeAppointment(r: any): RestoreAppointment | null {
  if (!isDate(r?.date) || !isTime(r?.start_time)) return null;
  const client_name = str(r?.client_name, 200);
  if (!client_name) return null;
  const price = parseAmount(r?.price);
  return {
    date: r.date,
    start_time: r.start_time,
    end_time: isTime(r?.end_time) && r.end_time > r.start_time ? r.end_time : null,
    client_name,
    who: str(r?.who, 200),
    service: SERVICES.includes(r?.service) ? r.service : 'manicure',
    manicure_coating: coating(r?.manicure_coating),
    pedicure_coating: coating(r?.pedicure_coating),
    comment: str(r?.comment, 1000),
    price: price === undefined ? null : price,
    status: isStatus(r?.status) ? r.status : 'scheduled',
  };
}

function sanitizeExpense(r: any): RestoreExpense | null {
  const name = normalizeName(r?.name);
  const amount = parseAmount(r?.amount);
  if (!isDate(r?.date) || !name || !amount) return null; // null, undefined и 0 — не трата
  return { date: r.date, name, amount };
}

function sanitizeSettings(s: any): RestoreSettings {
  const out: RestoreSettings = {};
  if (!s || typeof s !== 'object') return out;
  if (typeof s.notify_enabled === 'boolean') out.notify_enabled = s.notify_enabled;
  if (typeof s.notify_new_appt === 'boolean') out.notify_new_appt = s.notify_new_appt;
  if (typeof s.backup_enabled === 'boolean') out.backup_enabled = s.backup_enabled;
  if (isTime(s.notify_time)) out.notify_time = s.notify_time;
  if (isTime(s.work_start_time) && isTime(s.work_end_time) && s.work_end_time > s.work_start_time) {
    out.work_start_time = s.work_start_time;
    out.work_end_time = s.work_end_time;
  }
  if (isWorkDays(s.work_days)) out.work_days = s.work_days;
  if (typeof s.tz === 'string') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: s.tz });
      out.tz = s.tz;
    } catch { /* неизвестный пояс — оставляем текущий */ }
  }
  return out;
}

function list(raw: any, key: string): any[] | string {
  const v = raw?.[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return `Поле «${key}» в файле имеет неверный вид`;
  if (v.length > MAX_ROWS) return `Слишком много строк в «${key}» (больше ${MAX_ROWS})`;
  return v;
}

export function sanitizeBackup(raw: any): { ok: true; data: RestoreData; report: RestoreReport } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Файл не похож на резервную копию' };
  if (raw.format !== undefined && raw.format !== BACKUP_FORMAT) return { ok: false, error: 'Это не резервная копия Nail Planner' };
  if (raw.version !== undefined && (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION)) {
    return { ok: false, error: 'Копия создана более новой версией приложения' };
  }
  // Старые копии (до появления поля format) содержали как минимум список записей
  if (raw.format === undefined && !Array.isArray(raw.appointments)) {
    return { ok: false, error: 'Файл не похож на резервную копию' };
  }

  const lists: Record<string, any[]> = {};
  for (const key of ['appointments', 'clients', 'expenses', 'day_notes']) {
    const l = list(raw, key);
    if (typeof l === 'string') return { ok: false, error: l };
    lists[key] = l;
  }

  const appointments: RestoreAppointment[] = [];
  for (const r of lists.appointments) { const a = sanitizeAppointment(r); if (a) appointments.push(a); }

  const clients: RestoreClient[] = [];
  const seenClients = new Set<string>();
  for (const r of lists.clients) {
    const name = str(r?.name, 100);
    if (!name || seenClients.has(name)) continue; // имя уникально (UNIQUE user_id+name)
    seenClients.add(name);
    clients.push({ name, phone: str(r?.phone, 50), telegram: str(r?.telegram, 100), notes: str(r?.notes, 2000), birthday: cleanBirthday(r?.birthday) });
  }

  const expenses: RestoreExpense[] = [];
  for (const r of lists.expenses) { const e = sanitizeExpense(r); if (e) expenses.push(e); }

  const notesByDate = new Map<string, string>();
  for (const r of lists.day_notes) {
    const text = str(r?.text, 5000);
    if (isDate(r?.date) && text) notesByDate.set(r.date, text);
  }
  const day_notes = [...notesByDate].map(([date, text]) => ({ date, text }));

  const prices: Record<string, number> = {};
  if (raw.prices && typeof raw.prices === 'object') {
    for (const s of SERVICES) {
      const p = parseAmount((raw.prices as any)[s]);
      if (typeof p === 'number') prices[s] = p;
    }
  }

  const settings = sanitizeSettings(raw.settings);
  const report: RestoreReport = {
    appointments: { ok: appointments.length, skipped: lists.appointments.length - appointments.length },
    clients: { ok: clients.length, skipped: lists.clients.length - clients.length },
    expenses: { ok: expenses.length, skipped: lists.expenses.length - expenses.length },
    day_notes: { ok: day_notes.length, skipped: lists.day_notes.length - day_notes.length },
    prices: Object.keys(prices).length,
    settings: Object.keys(settings).length > 0,
  };
  const total = report.appointments.ok + report.clients.ok + report.expenses.ok + report.day_notes.ok + report.prices;
  if (total === 0 && !report.settings) return { ok: false, error: 'В файле нет данных для восстановления' };
  return { ok: true, data: { appointments, clients, expenses, day_notes, prices, settings }, report };
}

/** Заменяет ВСЕ данные мастера содержимым копии — одной транзакцией (при ошибке ничего не меняется). */
export async function restoreBackup(db: Database, userId: number, tzFallback: string, data: RestoreData): Promise<void> {

  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT OR IGNORE INTO users (user_id, tz, notify_time) VALUES (?, ?, ?)').bind(userId, tzFallback, '22:00'),
    ...['appointments', 'clients', 'expenses', 'day_notes', 'service_prices'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId),
    ),
    ...data.appointments.map((a) =>
      db
        .prepare(
          `INSERT INTO appointments (user_id, date, start_time, end_time, client_name, who, service,
             manicure_coating, pedicure_coating, comment, price, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(userId, a.date, a.start_time, a.end_time, a.client_name, a.who, a.service,
          a.manicure_coating, a.pedicure_coating, a.comment, a.price, a.status),
    ),
    ...data.clients.map((c) =>
      db
        .prepare('INSERT INTO clients (user_id, name, phone, telegram, notes, birthday) VALUES (?,?,?,?,?,?)')
        .bind(userId, c.name, c.phone, c.telegram, c.notes, c.birthday),
    ),
    ...data.expenses.map((e) =>
      db.prepare('INSERT INTO expenses (user_id, date, name, amount) VALUES (?,?,?,?)').bind(userId, e.date, e.name, e.amount),
    ),
    ...data.day_notes.map((n) =>
      db.prepare('INSERT INTO day_notes (user_id, date, text) VALUES (?,?,?)').bind(userId, n.date, n.text),
    ),
    ...Object.entries(data.prices).map(([service, price]) =>
      db.prepare('INSERT INTO service_prices (user_id, service, price) VALUES (?,?,?)').bind(userId, service, price),
    ),
  ];
  const settings = settingsStatement(db, userId, data.settings);
  if (settings) stmts.push(settings);
  await db.batch(stmts);
}
