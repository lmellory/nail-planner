import type { Database } from '../types';
import { settingsView } from './settings';
// Полная резервная копия данных мастера в JSON (для кнопки «Резервная копия» и еженедельной отправки).
import { ensureUser } from '../db/users';
import { getAllAppointments } from '../db/appointments';
import { getAllClients } from '../db/clients';
import { getAllDayNotes } from '../db/notes';
import { getAllExpenses } from '../db/expenses';
import { getServicePrices } from '../db/prices';

export const BACKUP_FORMAT = 'nail-planner-backup';
export const BACKUP_VERSION = 2;

export async function buildJsonBackup(db: Database, userId: number, fallbackTz: string): Promise<string> {
  const u = await ensureUser(db, userId, fallbackTz);
  const [appointments, clients, expenses, day_notes, prices] = await Promise.all([
    getAllAppointments(db, userId),
    getAllClients(db, userId),
    getAllExpenses(db, userId),
    getAllDayNotes(db, userId),
    getServicePrices(db, userId),
  ]);
  const settings = settingsView(u);
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      appointments,
      clients,
      expenses,
      prices,
      day_notes,
      settings,
    },
    null,
    2,
  );
}
