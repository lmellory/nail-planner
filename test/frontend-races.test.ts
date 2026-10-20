import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadFrontend } from './helpers/frontend';

let dom: JSDOM, w: any;
let modules: Awaited<ReturnType<typeof loadFrontend>>;
let pending: Array<{ url: string; resolve: (value: unknown, status?: number) => void }>;
beforeEach(async () => {
  const html = readFileSync(new URL('../webapp/index.html', import.meta.url), 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.test' });
  w = dom.window;
  w.scrollTo = () => {};
  pending = [];
  // Умышленно не соблюдаем abort: защита должна работать и после уже полученного ответа.
  w.fetch = (url: string) => new Promise(resolve => pending.push({ url, resolve: (data, status = 200) => resolve({ ok: status < 400, status, json: async () => data }) }));
  modules = await loadFrontend(dom, 'js/calendar-search.js');
});
afterEach(() => dom.window.close());
const slots = (start: string) => ({ is_work_day: true, slots: [{ start, end: '20:00', duration_minutes: 60 }] });

it('запоздалые свободные окна не подменяют выбранный день', async () => {
  const { state } = modules('js/state.js');
  const schedule = modules('js/schedule.js');
  state.selectedDate = '2026-10-20';
  const first = schedule.loadFreeSlots(state.selectedDate);
  state.selectedDate = '2026-10-21';
  const last = schedule.loadFreeSlots(state.selectedDate);
  pending[1].resolve(slots('19:00')); await last;
  pending[0].resolve(slots('09:00')); await first;
  expect(w.document.getElementById('free-slots-chips').textContent).toContain('19:00');
  expect(w.document.getElementById('free-slots-chips').textContent).not.toContain('09:00');
});

it('быстрое переключение календаря не смешивает два месяца', async () => {
  const { state } = modules('js/state.js');
  const calendar = modules('js/calendar-search.js');
  state.calendarYear = 2026; state.calendarMonth = 1;
  const first = calendar.renderCalendar();
  state.calendarMonth = 2;
  const last = calendar.renderCalendar();
  pending[1].resolve([]); await last;
  pending[0].resolve([]); await first;
  expect(w.document.querySelectorAll('.cal-day-num')).toHaveLength(31);
  expect(w.document.getElementById('cal-month-title').textContent).toContain('Март');
});

it('смена мастера отбрасывает старый ответ даже при возврате к прежнему ID', async () => {
  const { state } = modules('js/state.js');
  const request = modules('js/api.js').api('/prices');
  state.contextVersion += 2;
  pending[0].resolve({ manicure: 100 });
  await expect(request).rejects.toHaveProperty('name', 'AbortError');
});

it('двойное сохранение отправляет одну запись; ошибка освобождает кнопку для повторной попытки', async () => {
  const { state } = modules('js/state.js');
  state.currentScreen = 'form';
  w.document.getElementById('form-appt-date').value = '2026-10-20';
  w.document.getElementById('form-appt-start').value = '10:00';
  w.document.getElementById('form-appt-client').value = 'Анна';
  const form = modules('js/appointment-form.js');
  const first = form.saveAppointment();
  const second = form.saveAppointment();
  await Promise.resolve();
  expect(pending.filter(p => p.url === '/api/appointments')).toHaveLength(1);
  expect(w.document.getElementById('btn-submit-appt').disabled).toBe(true);
  pending[0].resolve({ error: 'Попробуйте снова' }, 500);
  await first; await second;
  expect(w.document.getElementById('btn-submit-appt').disabled).toBe(false);
  const retry = form.saveAppointment();
  await Promise.resolve();
  expect(pending.filter(p => p.url === '/api/appointments')).toHaveLength(2);
  pending[1].resolve({ error: 'Попробуйте снова' }, 500);
  await retry;
  expect(state.pendingWrites).toBe(0);
});
