// Статус записи. Допустимые значения проверяются здесь, а не CHECK-ом в БД (новый статус не требует миграции).
//   scheduled — запланирована (по умолчанию), занимает время и считается доходом, когда время прошло
//   no_show   — клиент не пришла: время свободно, дохода нет
//   cancelled — клиент отменила: время свободно, дохода нет
export const STATUSES = ['scheduled', 'no_show', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

export const isStatus = (s: unknown): s is Status => STATUSES.includes(s as Status);

export const STATUS_LABELS_RU: Record<Status, string> = {
  scheduled: 'запланирована',
  no_show: 'не пришла',
  cancelled: 'отменена',
};

/** Запись «живая»: занимает время в расписании. Пустой статус (старые данные) — тоже живая. */
export const isActiveStatus = (s: unknown): boolean => s === undefined || s === null || s === 'scheduled';

/** Состоялась ли запись к моменту now: живая и её начало уже наступило. Только такие идут в доход. */
export function isHeld(
  a: { date: string; start_time: string; status?: string | null },
  nowDate: string,
  nowTime: string,
): boolean {
  return isActiveStatus(a.status) && (a.date < nowDate || (a.date === nowDate && a.start_time <= nowTime));
}
