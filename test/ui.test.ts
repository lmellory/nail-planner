import { loadFrontend } from './helpers/frontend';
// Сквозные тесты экранов: скрипты из index.html в jsdom ⇄ настоящие обработчики ⇄ настоящая SQLite.
// Сценарий последовательный: тесты внутри файла идут по порядку и делят одну базу и один «браузер».
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, seedWeek, signInitData, stubTelegram, type TgCall } from './helpers/harness';

const read = (f: string) => readFileSync(fileURLToPath(new URL('../webapp/' + f, import.meta.url)), 'utf8');
const appFiles = () => [...read('index.html').matchAll(/<script\b[^>]*\bsrc="(\/(?!\/)[^"]+)"[^>]*><\/script>/g)]
  .map((m) => m[1].split('?')[0].slice(1));

let w: any;
let modules: Awaited<ReturnType<typeof loadFrontend>>;
let dom: JSDOM;
let env: any;
let tg: TgCall[];
let closeDb: () => void;
let mainButtonClick: () => void;
const errors: string[] = [];

const $ = (s: string): any => w.document.querySelector(s);
const $$ = (s: string): any[] => [...w.document.querySelectorAll(s)];
const txt = (s: string) => ($(s)?.textContent ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
const until = (fn: () => unknown) => vi.waitFor(() => { if (!fn()) throw new Error('ещё не готово'); }, { timeout: 4000, interval: 15 });
const click = (s: string) => { const el = $(s); if (!el) throw new Error('нет элемента ' + s); el.click(); };
const setVal = (s: string, v: string) => { $(s).value = v; };
const svc = (name: string) => $(`#service-selector .segment-btn[data-service="${name}"]`);
const calls = async (user = OWNER, path: string) => (await api(env, user, 'GET', path)).json;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  env = makeEnv(t.db);
  tg = stubTelegram();
  await seedWeek(env); // неделя 12–18 окт с записями, срывами и тратами

  const html = read('index.html').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.test/' });
  w = dom.window;
  // fetch/Request выполняются в Node: сигнал и File должны быть из той же среды.
  w.AbortController = AbortController;
  w.AbortSignal = AbortSignal;
  w.File = File;
  w.confirm = () => true;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  w.Telegram = { WebApp: {
    ready() {}, expand() {}, colorScheme: 'light',
    BackButton: { show() {}, hide() {}, onClick() {} },
    MainButton: { setParams() {}, hide() {}, onClick(fn: () => void) { mainButtonClick = fn; } },
    showConfirm(_message: string, callback: (ok: boolean) => void) { callback(true); },
  } };
  // «Сейчас» внутри браузера — то же, что на сервере
  w.eval(`(() => { const R = Date, fixed = new R('${NOW}').getTime();
    class F extends R { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } }
    globalThis.Date = F; })()`);
  // Запросы приложения идут прямо в настоящий сервер с настоящей подписью Telegram
  w.fetch = async (url: string, opts: any = {}) =>
    worker.fetch(
      new Request('https://app.test' + url, { ...opts, headers: { ...(opts.headers || {}), 'X-Init-Data': await signInitData(OWNER) } }),
      env,
      undefined as any,
    );
  w.addEventListener('error', (e: any) => errors.push(e.message));
  expect(appFiles()).toEqual(['app.js']);
  modules = await loadFrontend(dom);
  expect(errors).toEqual([]);
  await new Promise((r) => setTimeout(r, 150)); // первая загрузка недели и дня
});

afterAll(() => {
  dom?.window.close();
  closeDb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('нижняя навигация', () => {
  it('в шапке только календарь и админ-доступ, обе кнопки клиентов оформлены одинаково', () => {
    expect($$('#header-actions button').map(button => button.id)).toEqual(['btn-open-admin', 'btn-open-calendar']);
    expect($$('#bottom-nav .nav-tab-label').map(label => label.textContent)).toEqual(['Расписание', 'Клиенты', 'Доходы', 'Настройки']);
    expect($('#btn-back-from-clients').className).toBe($('#btn-add-client').className);
    expect($('#screen-clients #btn-open-search')).toBeTruthy();
  });

  it('подсвечивает текущую вкладку, возвращает к расписанию и скрывается в форме', async () => {
    click('#btn-open-clients');
    await until(() => $('#screen-clients').classList.contains('active'));
    expect($('#bottom-nav').hidden).toBe(false);
    expect($('#bottom-nav [aria-current="page"]').dataset.screen).toBe('clients');
    click('#btn-back-from-clients');
    expect($('#bottom-nav [aria-current="page"]').dataset.screen).toBe('main');
    click('#btn-add-appt');
    expect($('#bottom-nav').hidden).toBe(true);
    click('#btn-cancel-appt');
    expect($('#bottom-nav').hidden).toBe(false);
    click('#btn-open-clients');
    click('#btn-tab-main');
    expect($('#screen-main').classList.contains('active')).toBe(true);
  });
});

describe('экран «Доходы»', () => {
  it('открывается из шапки и показывает настоящие цифры недели', async () => {
    click('#btn-open-income');
    await until(() => $('#screen-income').classList.contains('active') && txt('#income-total-value') !== '—');
    expect(txt('#header-title')).toBe('Доходы');
    expect($$('#income-chart .income-bar')).toHaveLength(7);
    expect($$('#income-axis span').map((s) => s.textContent).join(',')).toBe('Пн,Вт,Ср,Чт,Пт,Сб,Вс');
    expect(txt('#income-total-value')).toBe('2 500 руб.');          // 800 + 1200 + 500
    expect(txt('#income-sum-income')).toBe('2 500 руб.');
    expect(txt('#income-sum-expense')).toBe('900 руб.');
    expect(txt('#income-sum-profit')).toBe('1 600 руб.');
    expect($('#income-sum-profit').classList.contains('is-plus')).toBe(true);
    expect(txt('#income-stat-count')).toBe('3');
    expect(txt('#income-stat-avg')).toBe('833 руб.');
    expect(txt('#income-delta')).toContain('▲ 150%'); // 2500 к 1000 прошлой недели
    expect(txt('#income-period-label')).toContain('12–18 октября');
  });

  it('«Ожидается» и «Сорвалось» отдельно от дохода', () => {
    const extra = txt('#income-extra');
    expect(extra).toContain('Ожидается: 1 600 руб. (2 записи)');       // 700 (сегодня позже) + 900 (завтра)
    expect(extra).toContain('Сорвалось записей: 2 (не пришли — 1, отменили — 1)');
    expect(txt('#income-note')).toContain('У 1 записи не указана цена'); // состоявшаяся без цены
  });

  it('траты по материалам — по отдельности, названия не исполняются как HTML', () => {
    const rows = $$('#income-materials .material-row').map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Гель-лак');
    expect(rows[0]).toContain('2×');
    expect(rows[0]).toContain('750');
    expect(rows[1]).toContain('Пилки');
  });

  it('диаграмма: тап по столбику, переключатель «Траты», смена периода', async () => {
    const bars = $$('#income-chart .income-bar');
    bars[0].click();
    expect(txt('#income-total-value')).toBe('800 руб.');
    expect(bars[0].classList.contains('is-selected')).toBe(true);
    bars[0].click();
    expect(txt('#income-focus-label')).toBe('Доход за неделю');

    $$('#income-metric-selector .segment-btn')[1].click();
    expect($('#income-chart').classList.contains('is-expense')).toBe(true);
    expect(txt('#income-total-value')).toBe('900 руб.');
    expect(txt('#income-delta')).toContain('▲ 350%');               // траты выросли — плохо
    expect($('#income-delta').classList.contains('down')).toBe(true);
    $$('#income-metric-selector .segment-btn')[0].click();

    $$('#income-period-selector .segment-btn')[1].click();           // месяц
    await until(() => $$('#income-chart .income-bar').length === 31);
    expect(txt('#income-total-value')).toBe('3 500 руб.');          // + 1000 с прошлой недели
    $$('#income-period-selector .segment-btn')[2].click();           // год
    await until(() => $$('#income-chart .income-bar').length === 12);
    expect($$('#income-axis span')[9].textContent).toBe('Окт');
    $$('#income-period-selector .segment-btn')[0].click();           // обратно: неделя
    await until(() => $$('#income-chart .income-bar').length === 7);
  });

  it('стрелки листают неделю', async () => {
    const before = txt('#income-period-label');
    click('#btn-income-prev');
    await until(() => txt('#income-period-label') !== before);
    expect(txt('#income-period-label')).toContain('5–11 октября');
    expect(txt('#income-total-value')).toBe('1 000 руб.');
    click('#btn-income-next');
    await until(() => txt('#income-period-label') === before);
  });
});

describe('траты на материалы', () => {
  it('добавление через окно: название нормализуется, итоги обновляются', async () => {
    click('#btn-add-expense');
    expect($('#modal-expense-edit').style.display).toBe('flex');
    setVal('#edit-expense-name', 'клей');
    setVal('#edit-expense-amount', '0');
    click('#btn-save-expense');
    await new Promise((r) => setTimeout(r, 30));
    expect((await calls(OWNER, '/api/expenses?from=2026-10-14&to=2026-10-14')).filter((e: any) => e.name === 'Клей')).toHaveLength(0); // 0 — не трата
    setVal('#edit-expense-amount', '50');
    click('#btn-save-expense');
    await until(() => $('#modal-expense-edit').style.display === 'none' && txt('#income-sum-expense') === '950 руб.');
    const saved = (await calls(OWNER, '/api/expenses?from=2026-10-14&to=2026-10-14')).find((e: any) => e.name === 'Клей');
    expect(saved).toMatchObject({ amount: 50, date: '2026-10-14' });
  });

  it('список за период: правка и удаление', async () => {
    click('#btn-open-expenses');
    await until(() => $$('#expenses-list .expense-row').length === 4);
    expect(txt('#expenses-total')).toBe('950 руб.');
    const row = $$('#expenses-list .expense-row').find((r) => r.textContent.includes('Клей'));
    row.click();
    expect($('#btn-delete-expense').style.display).toBe('block');
    setVal('#edit-expense-amount', '70');
    click('#btn-save-expense');
    await until(() => txt('#expenses-total') === '970 руб.');

    $$('#expenses-list .expense-row').find((r) => r.textContent.includes('Клей')).click();
    click('#btn-delete-expense');
    await until(() => $$('#expenses-list .expense-row').length === 3);
    expect(txt('#expenses-total')).toBe('900 руб.');
    click('#btn-back-from-expenses');
    await until(() => $('#screen-income').classList.contains('active') && txt('#income-sum-expense') === '900 руб.');
  });

  it('выгрузка доходов и трат в CSV уходит в чат за выбранный период', async () => {
    tg.length = 0;
    click('#btn-export-finance');
    await until(() => tg.some((c) => c.method === 'sendDocument'));
    const doc = tg.find((c) => c.method === 'sendDocument')!;
    expect(doc.filename).toBe('nail-planner-finance-2026-10-12_2026-10-18.csv');
    expect(doc.file).toContain('итого доход;;;;2500');
    expect(doc.file).toContain('прибыль;;;;1600');
    click('#btn-back-from-income');
  });
});

describe('настройки: прайс и бэкап', () => {
  it('сохранение прайса и переключателя бэкапа попадает в базу', async () => {
    click('#btn-open-settings');
    await until(() => $('#screen-settings').classList.contains('active'));
    expect($('#setting-backup-enabled').checked).toBe(true); // по умолчанию включён

    setVal('#setting-price-manicure', '12.5');
    click('#btn-save-prices');
    await new Promise((r) => setTimeout(r, 30));
    expect((await calls(OWNER, '/api/prices')).manicure).toBeNull(); // дробная цена не прошла

    setVal('#setting-price-manicure', '800');
    setVal('#setting-price-pedicure', '1200');
    setVal('#setting-price-manicure_fingers', '300');
    click('#btn-save-prices');
    await vi.waitFor(async () => expect(await calls(OWNER, '/api/prices')).toEqual({ manicure: 800, pedicure: 1200, both: null, manicure_fingers: 300, fingers: null }), { timeout: 4000 });

    $('#setting-backup-enabled').checked = false;
    click('#btn-save-settings');
    await vi.waitFor(async () => expect((await calls(OWNER, '/api/settings')).backup_enabled).toBe(false), { timeout: 4000 });
  });

  it('кнопка «Резервная копия сейчас» отправляет файл в чат', async () => {
    tg.length = 0;
    click('#btn-export-json');
    await until(() => tg.some((c) => c.method === 'sendDocument'));
    const doc = tg.find((c) => c.method === 'sendDocument')!;
    expect(doc.filename).toMatch(/^nail-planner-backup-.*\.json$/);
    expect(JSON.parse(doc.file!)).toMatchObject({ format: 'nail-planner-backup', version: 2, prices: { manicure: 800 } });
  });
});

describe('форма записи: цена из прайса и статус', () => {
  const fill = (name: string) => { setVal('#form-appt-client', name); setVal('#form-appt-date', '2026-10-14'); setVal('#form-appt-start', '20:00'); };

  it('новая запись открывается с ценой маникюра; при смене услуги цена меняется, а своя — нет', async () => {
    click('#btn-add-appt');
    await until(() => $('#screen-form').classList.contains('active'));
    expect($('#form-appt-price').value).toBe('800');
    svc('pedicure').click();
    expect($('#form-appt-price').value).toBe('1200');
    setVal('#form-appt-price', '999');
    svc('both').click();
    expect($('#form-appt-price').value).toBe('999');   // вписанная вручную цена не затирается
    setVal('#form-appt-price', '');
    svc('manicure_fingers').click();
    expect($('#form-appt-price').value).toBe('300');
  });

  it('сохранение: цена и статус «запланирована» уходят на сервер', async () => {
    fill('Тестовая');
    click('#btn-submit-appt');
    await until(() => $('#screen-main').classList.contains('active'));
    const a = (await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).find((x: any) => x.client_name === 'Тестовая');
    expect(a).toMatchObject({ service: 'manicure_fingers', price: 300, status: 'scheduled', manicure_coating: null, pedicure_coating: null });
  });

  it('пустая цена сохраняется как «не указана», дробная — блокируется до отправки', async () => {
    click('#btn-add-appt');
    await until(() => $('#screen-form').classList.contains('active'));
    fill('Без цены'); setVal('#form-appt-price', '');
    setVal('#form-appt-price', '1500.5');
    click('#btn-submit-appt');
    await new Promise((r) => setTimeout(r, 40));
    expect((await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).some((x: any) => x.client_name === 'Без цены')).toBe(false);
    setVal('#form-appt-price', '');
    click('#btn-submit-appt');
    await until(() => $('#screen-main').classList.contains('active'));
    const a = (await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).find((x: any) => x.client_name === 'Без цены');
    expect(a.price).toBeNull();
  });

  it('статус «Не пришла»: сохраняется, карточка затемнена с пометкой, доход не растёт', async () => {
    const before = (await calls(OWNER, '/api/stats?period=week')).total;
    const target = (await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).find((x: any) => x.client_name === 'Тестовая');
    await vi.waitFor(() => expect($$('.appointment-card').some((c) => c.dataset.id == target.id)).toBe(true), { timeout: 4000 });
    $$('.appointment-card').find((c) => c.dataset.id == target.id).click();
    await until(() => $('#screen-form').classList.contains('active') && $('#form-appt-client').value === 'Тестовая');
    $('#status-selector .segment-btn[data-status="no_show"]').click();
    expect($('#status-selector .segment-btn.active').dataset.status).toBe('no_show');
    click('#btn-submit-appt');
    await until(() => $('#screen-main').classList.contains('active'));

    expect((await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).find((x: any) => x.id === target.id).status).toBe('no_show');
    await vi.waitFor(() => {
      const card = $$('.appointment-card').find((c) => c.dataset.id == target.id);
      expect(card.classList.contains('is-inactive')).toBe(true);
      expect(card.textContent).toContain('Не пришла');
    }, { timeout: 4000 });
    const st = await calls(OWNER, '/api/stats?period=week');
    expect(st.total).toBe(before);   // эта запись и так была в будущем (20:00), в доход не шла
    expect(st.no_show).toBe(2);
  });
});

describe('восстановление из копии', () => {
  it('файл копии возвращает удалённые данные (проверка → подтверждение → замена)', async () => {
    const backup = (await api(env, OWNER, 'GET', '/api/export/json')).json;
    const victim = backup.appointments.find((a: any) => a.client_name === 'Тестовая');
    expect(victim).toBeTruthy();
    await api(env, OWNER, 'DELETE', `/api/appointments/${victim.id}`);
    expect((await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).some((x: any) => x.client_name === 'Тестовая')).toBe(false);

    click('#btn-open-settings');
    await until(() => $('#screen-settings').classList.contains('active'));
    const input = $('#restore-file-input');
    const file = new w.File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));

    await vi.waitFor(async () => {
      const back = (await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).find((x: any) => x.client_name === 'Тестовая');
      expect(back).toMatchObject({ status: 'no_show', price: 300 });
    }, { timeout: 5000 });
    expect(txt('#toast')).toContain('восстановлены');
  });

  it('чужой файл отклоняется с понятным сообщением, данные целы', async () => {
    const before = (await calls(OWNER, '/api/appointments?from=2026-10-01&to=2026-10-31')).length;
    const input = $('#restore-file-input');
    const bad = new w.File(['{"format":"other-app","appointments":[]}'], 'x.json');
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(txt('#toast')).toContain('не резервная копия'), { timeout: 4000 });
    expect((await calls(OWNER, '/api/appointments?from=2026-10-01&to=2026-10-31')).length).toBe(before);

    const junk = new w.File(['это не json'], 'x.json');
    Object.defineProperty(input, 'files', { value: [junk], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(txt('#toast')).toContain('не похож'), { timeout: 4000 });
  });
});

describe('переходы между модулями', () => {
  it('календарь выбирает день, поиск возвращает в расписание найденной записи', async () => {
    click('#btn-open-calendar');
    await until(() => $$('#calendar-grid .cal-day-cell:not(.other-month)').length === 31);
    expect(txt('#cal-month-title')).toBe('Октябрь 2026');
    $$('#calendar-grid .cal-day-cell').find((c) => c.querySelector('.cal-day-num')?.textContent === '14').click();
    await until(() => $('#screen-main').classList.contains('active') && $$('.week-day-col.selected')[0]?.dataset.date === '2026-10-14');

    click('#btn-open-clients');
    click('#btn-open-search');
    setVal('#search-input', 'Тестовая');
    $('#search-input').dispatchEvent(new w.Event('input', { bubbles: true }));
    await until(() => txt('#search-results-list').includes('Тестовая'));
    click('#search-results-list .appointment-card');
    await until(() => $('#screen-main').classList.contains('active') && $$('.appointment-card').some((c) => c.textContent.includes('Тестовая')));
  });

  it('заметка сохраняется кнопкой Telegram и удаляется через экран заметки', async () => {
    click('#btn-day-note-action');
    setVal('#note-text-input', 'Проверка заметки после разделения');
    mainButtonClick();
    await until(() => txt('#day-note-content') === 'Проверка заметки после разделения');
    expect((await calls(OWNER, '/api/notes/2026-10-14')).text).toBe('Проверка заметки после разделения');
    click('#btn-edit-note-card');
    click('#btn-delete-note');
    await until(() => $('#screen-main').classList.contains('active') && $('#day-note-card').style.display === 'none');
    expect((await calls(OWNER, '/api/notes/2026-10-14')).text).toBeFalsy();
  });

  it('клиент создаётся, редактируется, подставляется в запись и удаляется', async () => {
    click('#btn-open-clients');
    click('#btn-add-client');
    setVal('#edit-client-name', 'Клиент структурного теста');
    setVal('#edit-client-phone', '+37369123456');
    click('#btn-save-client');
    await until(() => txt('#clients-list').includes('Клиент структурного теста'));
    const card = () => $$('#clients-list .client-card').find((c) => c.textContent.includes('Клиент структурного теста'));
    card().click();
    await until(() => $('#modal-client-view').style.display === 'flex');
    expect($('#client-view-phone-link').getAttribute('href')).toBe('tel:+37369123456');
    click('#btn-client-edit');
    setVal('#edit-client-notes', 'Предпочитает утренние записи');
    click('#btn-save-client');
    await until(() => txt('#clients-list').includes('Предпочитает утренние записи'));
    // Сохранение обновляет и список, и подсказки формы.
    await until(() => $$('#clients-datalist option').some((o) => o.value === 'Клиент структурного теста'));
    card().click();
    await until(() => $('#modal-client-view').style.display === 'flex');
    click('#btn-client-book');
    expect($('#screen-form').classList.contains('active')).toBe(true);
    expect($('#form-appt-client').value).toBe('Клиент структурного теста');
    click('#btn-cancel-appt');
    click('#btn-open-clients');
    await until(() => !!card());
    card().click();
    await until(() => $('#modal-client-view').style.display === 'flex');
    click('#btn-client-delete');
    await until(() => $('#modal-client-view').style.display === 'none' && !card());
    expect((await calls(OWNER, '/api/clients')).some((c: any) => c.name === 'Клиент структурного теста')).toBe(false);
  });

  it('админ выбирает мастера, создаёт и меняет его запись, затем возвращается к своим данным', async () => {
    env.ADMIN_ID = String(OWNER);
    await modules('js/admin.js').loadMe();
    expect($('#btn-open-admin').style.display).not.toBe('none');
    click('#btn-open-admin');
    await until(() => !!$(`#admin-masters-list .admin-master-card[data-id="${OTHER}"]`));
    click(`#admin-masters-list .admin-master-card[data-id="${OTHER}"]`);
    await until(() => $('#act-as-banner').style.display === 'flex' && !$('#appointments-list .loading-spinner'));
    click('#btn-add-appt');
    setVal('#form-appt-client', 'Запись другого мастера');
    setVal('#form-appt-date', '2026-10-14');
    setVal('#form-appt-start', '18:30');
    click('#btn-submit-appt');
    await until(() => $('#screen-main').classList.contains('active') && txt('#appointments-list').includes('Запись другого мастера'));
    expect((await calls(OWNER, '/api/appointments?from=2026-10-14&to=2026-10-14')).some((a: any) => a.client_name === 'Запись другого мастера')).toBe(false);
    expect((await calls(OTHER, '/api/appointments?from=2026-10-14&to=2026-10-14')).some((a: any) => a.client_name === 'Запись другого мастера')).toBe(true);
    $$('#appointments-list .appointment-card').find((c) => c.textContent.includes('Запись другого мастера')).click();
    setVal('#form-appt-start', '19:00');
    click('#btn-submit-appt');
    await until(() => $('#screen-main').classList.contains('active') && txt('#appointments-list').includes('19:00'));
    click('#appointments-list .appointment-card');
    click('#btn-delete-appt');
    await until(() => $('#screen-main').classList.contains('active') && !txt('#appointments-list').includes('Запись другого мастера'));
    expect(await calls(OTHER, '/api/appointments?from=2026-10-14&to=2026-10-14')).toEqual([]);
    click('#btn-act-as-exit');
    await until(() => $('#act-as-banner').style.display === 'none' && txt('#appointments-list').includes('Тестовая'));
  });
});

describe('здоровье страницы', () => {
  it('за весь сценарий не было ошибок скриптов', () => {
    expect(errors).toEqual([]);
  });
});
