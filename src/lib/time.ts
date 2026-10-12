// Работа с датами/временем в нужном часовом поясе (TZ)

/** Текущая дата YYYY-MM-DD и время HH:MM в часовом поясе tz */
export function nowInTz(tz: string, d = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

/** Прибавить дни к строке YYYY-MM-DD */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Строгая проверка: формат YYYY-MM-DD и реально существующая дата (2026-02-31 не пройдёт). */
export const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export function weekdayRu(date: string): string {
  return WD[new Date(date + 'T00:00:00Z').getUTCDay()];
}

/** Прибавить минуты к времени HH:MM */
export function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const outH = Math.floor(clamped / 60);
  const outM = clamped % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

export function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Длительность процедуры по умолчанию в минутах */
export function defaultServiceDuration(service: string): number {
  if (service === 'manicure') return 120; // 2 ч
  if (service === 'pedicure') return 90;  // 1.5 ч
  if (service === 'both') return 210;     // 3.5 ч
  if (service === 'manicure_fingers') return 180; // 3 ч (маникюр 2 ч + пальцы 1 ч)
  if (service === 'fingers') return 60;   // 1 ч (старая отдельная услуга)
  return 120;
}

export interface SlotRange {
  start: string;
  end: string;
}

/**
 * Рассчитывает свободные окна между рабочими часами и существующими записями.
 * workStart: '09:00', workEnd: '20:00'
 */
export function calculateFreeSlots(
  workStart: string,
  workEnd: string,
  busyIntervals: SlotRange[],
  minDurationMin = 30,
): { start: string; end: string; duration_minutes: number }[] {
  const startLimit = timeToMinutes(workStart);
  const endLimit = timeToMinutes(workEnd);
  if (endLimit <= startLimit) return [];

  const busy = busyIntervals
    .map((b) => ({
      s: Math.max(startLimit, timeToMinutes(b.start)),
      e: Math.min(endLimit, timeToMinutes(b.end)),
    }))
    .filter((b) => b.e > b.s)
    .sort((a, b) => a.s - b.s);

  const mergedBusy: { s: number; e: number }[] = [];
  for (const item of busy) {
    if (!mergedBusy.length) {
      mergedBusy.push({ ...item });
      continue;
    }
    const last = mergedBusy[mergedBusy.length - 1];
    if (item.s <= last.e) {
      last.e = Math.max(last.e, item.e);
    } else {
      mergedBusy.push({ ...item });
    }
  }

  const freeSlots: { start: string; end: string; duration_minutes: number }[] = [];
  let current = startLimit;

  for (const b of mergedBusy) {
    if (b.s > current) {
      const dur = b.s - current;
      if (dur >= minDurationMin) {
        freeSlots.push({
          start: minutesToTime(current),
          end: minutesToTime(b.s),
          duration_minutes: dur,
        });
      }
    }
    current = Math.max(current, b.e);
  }

  if (endLimit > current) {
    const dur = endLimit - current;
    if (dur >= minDurationMin) {
      freeSlots.push({
        start: minutesToTime(current),
        end: minutesToTime(endLimit),
        duration_minutes: dur,
      });
    }
  }

  return freeSlots;
}
