// Форматирование расписания для сообщений бота (/today, /tomorrow, вечернее уведомление)
import type { Appointment } from '../types';
import { escapeHtml } from '../bot/telegram';
import { weekdayRu } from './time';
import { isActiveStatus } from './status';

const coat = (c: string | null) => (c === 'gel' ? 'с покрытием' : 'без покрытия');

/** Время записи для показа: только начало, например «18:00» (конец нужен лишь для расчётов). */
export function timeLabel(a: Pick<Appointment, 'start_time'> & { end_time?: string | null }): string {
  return a.start_time;
}

export function serviceLabel(a: Appointment): string {
  if (a.service === 'manicure') return `маникюр ${coat(a.manicure_coating)}`;
  if (a.service === 'pedicure') return `педикюр ${coat(a.pedicure_coating)}`;
  if (a.service === 'manicure_fingers') return 'маникюр + пальцы';
  if (a.service === 'fingers') return 'пальцы';
  return `маникюр ${coat(a.manicure_coating)} + педикюр ${coat(a.pedicure_coating)}`;
}

export interface ClientContactInfo {
  phone?: string | null;
  telegram?: string | null;
}

export function formatDay(
  date: string,
  items: Appointment[],
  note?: string,
  clientContacts?: Map<string, ClientContactInfo>,
): string {
  items = items.filter((a) => isActiveStatus(a.status)); // отменённые и неявки в расписание не попадают
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

      const contact = clientContacts?.get(a.client_name);
      if (contact?.phone || contact?.telegram) {
        const parts: string[] = [];
        if (contact.phone) parts.push(`📞 ${escapeHtml(contact.phone)}`);
        if (contact.telegram) {
          const tgClean = contact.telegram.replace(/^@/, '');
          parts.push(`💬 <a href="https://t.me/${tgClean}">@${escapeHtml(tgClean)}</a>`);
        }
        out += `\n   ${parts.join(' · ')}`;
      }
      out += '\n';
    }
  }
  if (note && note.trim()) {
    out += `\n📝 <i>${escapeHtml(note.trim())}</i>`;
  }
  return out;
}
