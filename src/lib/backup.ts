// Полная резервная копия данных мастера в JSON (для кнопки «Резервная копия» и еженедельной отправки).
import {
  ensureUser,
  getAllAppointments,
  getAllClients,
  getAllDayNotes,
  getAllExpenses,
  getServicePrices,
} from '../db';

export const BACKUP_FORMAT = 'nail-planner-backup';
export const BACKUP_VERSION = 2;

export async function buildJsonBackup(db: D1Database, userId: number, fallbackTz: string): Promise<string> {
  const u = await ensureUser(db, userId, fallbackTz);
  const [appointments, clients, expenses, day_notes, prices] = await Promise.all([
    getAllAppointments(db, userId),
    getAllClients(db, userId),
    getAllExpenses(db, userId),
    getAllDayNotes(db, userId),
    getServicePrices(db, userId),
  ]);
  const settings = {
    notify_enabled: !!u.notify_enabled,
    notify_time: u.notify_time,
    tz: u.tz,
    notify_new_appt: !!u.notify_new_appt,
    work_start_time: u.work_start_time ?? '09:00',
    work_end_time: u.work_end_time ?? '20:00',
    work_days: u.work_days ?? '1,2,3,4,5,6',
    backup_enabled: u.backup_enabled !== 0,
  };
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
