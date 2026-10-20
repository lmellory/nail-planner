import { fmt, mondayOf } from './dates.js';

// ===== Состояние приложения =====
export const todayStr = fmt(new Date());

export const state = {
  currentScreen: 'main',
  selectedDate: todayStr,
  weekStart: fmt(mondayOf(new Date())),
  appointments: [],
  daySummaryMap: new Map(), // date -> { count, has_note }
  currentDayNote: '',
  editingAppointmentId: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0..11
  prices: {},                           // прайс: { manicure: 800, pedicure: null, ... }
  isAdmin: false,                       // администратор (по ответу сервера /api/me)
  contextVersion: 0,
  pendingWrites: 0,
  actAs: null,                          // ID мастера, чьи записи правит админ; null — свои данные
  actAsLabel: '',                       // как показывать этого мастера (имя, @username или ID)
};
