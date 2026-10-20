import { test, expect, appointments } from './fixtures.js';

async function expectFieldsInside(page, selector) {
  const outside = await page.locator(selector).evaluateAll(fields => fields.filter(field => {
    const rect = field.getBoundingClientRect(), parent = field.parentElement.getBoundingClientRect();
    return rect.width && (rect.left < parent.left - 1 || rect.right > parent.right + 1);
  }).map(field => field.id));
  expect(outside).toEqual([]);
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('body *')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width && (rect.right > innerWidth + 1 || rect.left < -1);
    }).map(el => ({ tag: el.tagName, id: el.id, className: el.className })).slice(0, 12),
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
}

test('поля настроек, даты и времени помещаются в карточки', async ({ page, model }) => {
  await page.goto('/');
  await page.locator('#btn-open-settings').click();
  await expect(page.locator('#setting-notify-time')).toHaveValue(model.settings.notify_time);
  await expectFieldsInside(page, '#screen-settings .form-input');
  await page.locator('#btn-tab-main').click();
  await page.locator('#btn-add-appt').click();
  await expectFieldsInside(page, '#screen-form .form-input');
});

test('последняя карточка остаётся полностью выше меню после прокрутки', async ({ page, model }) => {
  for (const count of [2, 8]) {
    model.appointments = appointments(count);
    await page.goto('/');
    await expect(page.locator('.appointment-card')).toHaveCount(count);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const last = await page.locator('.appointment-card').last().boundingBox();
    const menu = await page.locator('#bottom-nav').boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(menu.y - 12);
  }
});

test('создание и правка сохраняются одной кнопкой; заметка сохраняет кнопку Telegram', async ({ page, model, withTelegram }) => {
  await page.goto('/');
  await page.locator('#btn-day-note-action').click();
  if (withTelegram) expect(await page.evaluate(() => window.__telegramButton.visible)).toBe(true);
  await page.locator('#btn-cancel-note').click();
  for (const editing of [false, true]) {
    if (editing) await page.locator('.appointment-card').first().click();
    else await page.locator('#btn-add-appt').click();
    await expect(page.locator('#btn-submit-appt')).toBeVisible();
    expect(await page.evaluate(() => !!window.__telegramButton?.visible)).toBe(false);
    expect(await page.locator('#app').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))).toBeLessThanOrEqual(50);
    await page.locator('#form-appt-client').fill('Тест браузера');
    await page.locator('#form-appt-start').fill('10:00');
    await page.locator('#btn-submit-appt').click();
    await expect(page.locator('#screen-main')).toHaveClass(/active/);
    expect(model.writes.filter(write => write.path.startsWith('/api/appointments'))).toHaveLength(editing ? 2 : 1);
  }
  expect(model.writes.filter(write => write.path.startsWith('/api/appointments')).map(write => write.method)).toEqual(['POST', 'PUT']);
});

test('настройки, прайс и расходы работают после разделения модулей', async ({ page, model }) => {
  await page.goto('/');
  await page.locator('#btn-open-settings').click();
  await expect(page.locator('#setting-notify-time')).toHaveValue('22:48');
  await page.locator('#setting-notify-time').fill('21:30');
  await page.locator('#btn-save-settings').click();
  await expect.poll(() => model.settings.notify_time).toBe('21:30');
  await page.locator('#setting-price-manicure').fill('275');
  await page.locator('#btn-save-prices').click();
  await expect.poll(() => model.prices.manicure).toBe(275);
  await page.locator('#btn-open-income').click();
  await expect(page.locator('#income-total-value')).toContainText('500');
  await page.locator('#btn-add-expense').click();
  await page.locator('#edit-expense-name').fill('Пилки');
  await page.locator('#edit-expense-amount').fill('50');
  await expect(page.locator('#edit-expense-name')).toHaveValue('Пилки');
  await expect(page.locator('#edit-expense-amount')).toHaveValue('50');
  await page.locator('#btn-save-expense').click();
  await expect.poll(() => model.expenses.length).toBe(1);
  await page.locator('#btn-open-expenses').click();
  await expect(page.locator('.expense-name')).toHaveText('Пилки');
});

test('окно нового клиента доступно поверх меню и сохраняет введённые контакты', async ({ page, model }) => {
  await page.goto('/');
  await page.locator('#btn-open-clients').click();
  await page.locator('#btn-add-client').click();
  await page.locator('#edit-client-name').fill('Мария');
  await page.locator('#edit-client-phone').fill('+37360123456');
  await expect(page.locator('#edit-client-name')).toHaveValue('Мария');
  await page.locator('#btn-save-client').click();
  await expect.poll(() => model.clients.length).toBe(1);
  expect(model.clients[0].phone).toBe('+37360123456');
  await expect(page.locator('#modal-client-edit')).toBeHidden();
  await expect(page.locator('#clients-list')).toContainText('Мария');
});
