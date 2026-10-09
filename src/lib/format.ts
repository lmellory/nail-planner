// Форматирование расписания для сообщений бота (/today, /tomorrow, вечернее уведомление)
import type { Appointment } from '../types';
import { escapeHtml } from '../bot/telegram';
import { weekdayRu } from './time';

const coat = (c: string | null) => (c === 'gel' ? 'с покрытием' : 'без покрытия');

/** Время записи для показа: «18:00», а у старых записей с концом «18:00–20:00». */
export function timeLabel(a: Pick<Appointment, 'start_time' | 'end_time'>): string {
  return a.end_time ? `${a.start_time}–${a.end_time}` : a.start_time;
}

export function serviceLabel(a: Appointment): string {
  if (a.service === 'manicure') return `маникюр ${coat(a.manicure_coating)}`;
  if (a.service === 'pedicure') return `педикюр ${coat(a.pedicure_coating)}`;
  return `маникюр ${coat(a.manicure_coating)} + педикюр ${coat(a.pedicure_coating)}`;
}

export function formatDay(date: string, items: Appointment[], note?: string): string {
  const [y, m, d] = date.split('-');
  let out = `<b>📅 ${d}.${m}.${y}, ${weekdayRu(date)}</b>\n`;
  if (!items.length) {
    out += '\nЗаписей нет 🌸';
  } else {
    for (const a of items) {
      out += `\n🕐 <b>${timeLabel(a)}</b> · ${escapeHtml(a.client_name)}`;
      if (a.who) out += ` (${escapeHtml(a.who)})`;
      out += `\n   💅 ${serviceLabel(a)}`;
      if (a.comment) out += `\n   💬 ${escapeHtml(a.comment)}`;
      out += '\n';
    }
  }
  if (note && note.trim()) {
    out += `\n📝 <i>${escapeHtml(note.trim())}</i>`;
  }
  return out;
}
