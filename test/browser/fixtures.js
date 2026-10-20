import { test as base, expect } from '@playwright/test';

export function appointments(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1, user_id: 1, date: '2026-10-23', start_time: index ? '12:30' : '10:00',
    end_time: null, client_name: index ? `Клиент ${index + 1}` : 'Анна', who: 'Постоянный клиент',
    service: index ? 'both' : 'manicure', manicure_coating: 'none', pedicure_coating: 'gel',
    status: 'scheduled', price: 250, comment: 'Заметка о процедуре',
  }));
}

export const test = base.extend({
  withTelegram: [true, { option: true }],
  model: [async ({ page, isMobile, withTelegram }, use) => {
    const model = {
      appointments: appointments(), writes: [], errors: [], expenses: [], clients: [],
      latency: {}, failures: {}, requests: [],
      settings: { notify_enabled: true, notify_new_appt: true, notify_time: '22:48', tz: 'Europe/Chisinau', work_start_time: '09:00', work_end_time: '20:00', work_days: '1,2,3', backup_enabled: true },
      prices: { manicure: 250, pedicure: 300, both: 500, manicure_fingers: null },
    };
    page.on('pageerror', error => model.errors.push(error.message));
    await page.addInitScript(({ inset, withTelegram }) => {
      if (!withTelegram) return;
      const button = { visible: false, callback: null };
      window.__telegramButton = button;
      window.__confirmMessages = [];
      window.__confirmAnswer = true;
      window.Telegram = { WebApp: {
        colorScheme: 'dark', themeParams: {}, ready() {}, expand() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, onEvent() {},
        BackButton: { show() {}, hide() {}, onClick(callback) { window.__telegramBack = callback; } },
        MainButton: { hide() { button.visible = false; }, setParams(params) { if ('is_visible' in params) button.visible = params.is_visible; }, onClick(callback) { button.callback = callback; } },
        enableClosingConfirmation() { window.__closingProtection = true; },
        disableClosingConfirmation() { window.__closingProtection = false; },
        showConfirm(message, callback) { window.__confirmMessages.push(message); callback(window.__confirmAnswer); },
      } };
      document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--tg-content-safe-area-inset-bottom', inset + 'px'));
    }, { inset: isMobile ? 34 : 0, withTelegram });
    // Тесты не обращаются к рабочей базе, Telegram или любым внешним адресам.
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:4173') { await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      model.requests.push({ method: request.method(), path: url.pathname });
      if (model.latency[url.pathname]) await new Promise(resolve => setTimeout(resolve, model.latency[url.pathname]));
      if (model.failures[url.pathname] > 0) {
        model.failures[url.pathname]--;
        await route.fulfill({ status: 503, json: { error: 'Тестовая ошибка: попробуйте ещё раз' } });
        return;
      }
      const write = !['GET', 'HEAD'].includes(request.method());
      const body = write ? request.postDataJSON() : null;
      let data;
      if (url.pathname === '/api/appointments/check') data = { conflicts: [] };
      else if (write) {
        model.writes.push({ method: request.method(), path: url.pathname, body });
        if (url.pathname.startsWith('/api/appointments')) {
          const id = Number(url.pathname.split('/')[3]) || 100;
          const item = { ...appointments(1)[0], ...body, id };
          model.appointments = [...model.appointments.filter(a => a.id !== id), item]; data = { id };
        } else if (url.pathname === '/api/prices') data = model.prices = body;
        else if (url.pathname === '/api/settings') data = model.settings = body;
        else if (url.pathname === '/api/expenses') { const item = { ...body, id: 1 }; model.expenses.push(item); data = item; }
        else if (url.pathname === '/api/clients') { const item = { ...body, id: 1 }; model.clients.push(item); data = item; }
        else data = { ok: true };
      } else if (url.pathname === '/api/me') data = { is_admin: true };
      else if (url.pathname === '/api/appointments') data = model.appointments;
      else if (url.pathname === '/api/settings') data = model.settings;
      else if (url.pathname === '/api/prices') data = model.prices;
      else if (url.pathname.startsWith('/api/notes/')) data = { text: 'Подготовить материалы' };
      else if (url.pathname === '/api/days/slots') data = { is_work_day: false, slots: [] };
      else if (url.pathname === '/api/expenses') data = model.expenses;
      else if (url.pathname === '/api/clients') data = model.clients;
      else if (url.pathname === '/api/stats') data = {
        period: url.searchParams.get('period'), from: '2026-10-19', to: '2026-10-25',
        total: 500, total_expense: model.expenses.reduce((sum, e) => sum + e.amount, 0), profit: 500,
        paid: 2, avg: 250, unpaid: 0, expected: 0, expected_count: 0, cancelled: 0, no_show: 0,
        prev_total: 0, prev_expense: 0, materials: [], buckets: [],
      };
      else data = [];
      await route.fulfill({ json: data });
    });
    await use(model);
    expect(model.errors).toEqual([]);
  }, { auto: true }],
});
export { expect };
