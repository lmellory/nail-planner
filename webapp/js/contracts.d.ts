import type { Appointment, Service } from '../../src/types';
import type { settingsView } from '../../src/lib/settings';

export type Prices = Partial<Record<Service, number | null>>;
export type Settings = ReturnType<typeof settingsView>;
export interface GetResponses {
  '/prices': Prices;
  '/settings': Settings;
  '/me': { is_admin: boolean };
}
export interface PutRequests {
  '/prices': Prices;
  '/settings': Settings;
}
export interface PutResponses {
  '/prices': Prices;
  '/settings': Settings;
}
export interface AppState {
  currentScreen: string;
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
