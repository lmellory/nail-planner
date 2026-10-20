import type { Appointment, Service, Client, Expense, FreeSlot } from '../../src/types';
import type { settingsView } from '../../src/lib/settings';
import type { IncomeReport, Period, Bucket } from '../../src/lib/stats';
import type { MasterRow } from '../../src/api/admin';
export type { Appointment, Service, Client, Expense, FreeSlot, IncomeReport, Period, Bucket, MasterRow };
export type Screen = 'main' | 'form' | 'calendar' | 'search' | 'note' | 'settings' | 'clients' | 'income' | 'expenses' | 'admin';
export type FormPreset = Appointment | { id?: undefined; date?: string; start_time?: string; client_name?: string };
export interface DaySummary { date: string; count: number; has_note: boolean }
export interface FinanceState { period: Period; anchor: string; data: IncomeReport | null; selectedKey: string | null; metric: 'income' | 'expense'; requestId: number }

export type Prices = Partial<Record<Service, number | null>>;
export type Settings = ReturnType<typeof settingsView>;
export interface GetResponses {
  '/prices': Prices;
  '/settings': Settings;
  '/me': { is_admin: boolean };
  '/clients': Client[];
  '/expenses/names': string[];
  '/admin/masters': { masters: MasterRow[] };
}
export type GetPath = keyof GetResponses | `/appointments?${string}` | `/days?${string}` | `/days/slots?${string}` | `/notes/${string}` | `/search?${string}` | `/clients?${string}` | `/clients/${string}` | `/expenses?${string}` | `/stats?${string}`;
export type GetResponse<P extends GetPath> = P extends keyof GetResponses ? GetResponses[P]
  : P extends `/appointments?${string}` | `/search?${string}` ? Appointment[]
  : P extends `/days?${string}` ? DaySummary[]
  : P extends `/days/slots?${string}` ? { is_work_day: boolean; slots: FreeSlot[] }
  : P extends `/notes/${string}` ? { text: string }
  : P extends `/clients?${string}` ? Client[]
  : P extends `/clients/${string}` ? { client: Client; history: Appointment[] }
  : P extends `/expenses?${string}` ? Expense[]
  : P extends `/stats?${string}` ? IncomeReport : never;
export interface PutRequests {
  '/prices': Prices;
  '/settings': Settings;
}
export interface PutResponses {
  '/prices': Prices;
  '/settings': Settings;
}
export interface AppState {
  currentScreen: Screen;
  selectedDate: string;
  weekStart: string;
  appointments: Appointment[];
  daySummaryMap: Map<string, { date: string; count: number; has_note: boolean }>;
  currentDayNote: string;
  editingAppointmentId: number | null;
  calendarYear: number;
  calendarMonth: number;
  prices: Prices;
  isAdmin: boolean;
  contextVersion: number;
  pendingWrites: number;
  actAs: number | null;
  actAsLabel: string;
}
