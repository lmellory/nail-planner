import { test, expect } from './fixtures.js';

async function answerNextConfirmation(page, withTelegram, answer) {
  if (withTelegram) await page.evaluate(value => { window.__confirmAnswer = value; }, answer);
  else page.once('dialog', dialog => {
    expect(dialog.message()).toContain('несохранённые изменения');
    return answer ? dialog.accept() : dialog.dismiss();
  });
}

test('изменённая запись предупреждает при выходе; отказ сохраняет поля, подтверждение не пишет в базу', async ({ page, model, withTelegram }) => {
  await page.goto('/');
  await page.locator('#btn-add-appt').click();
  await page.locator('#form-appt-client').fill('Не терять клиента');
  await page.locator('#form-appt-comment').fill('Важные пожелания');
  if (withTelegram) expect(await page.evaluate(() => window.__closingProtection)).toBe(true);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await answerNextConfirmation(page, withTelegram, false);
  await page.locator('#btn-back').click();
  await expect(page.locator('#screen-form')).toHaveClass(/active/);
  await expect(page.locator('#form-appt-comment')).toHaveValue('Важные пожелания');
  await answerNextConfirmation(page, withTelegram, true);
  if (withTelegram) await page.evaluate(() => window.__telegramBack());
  else await page.locator('#btn-cancel-appt').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  if (withTelegram) expect(await page.evaluate(() => window.__closingProtection)).toBe(false);
  expect(model.writes).toHaveLength(0);
});

test('неизменённая форма и возврат исходных значений не вызывают предупреждений', async ({ page, withTelegram }) => {
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.dismiss(); });
  await page.goto('/');
  await page.locator('#btn-add-appt').click();
  await page.locator('#form-appt-client').fill('Лишнее');
  await page.locator('#form-appt-client').fill('');
  await page.locator('#btn-cancel-appt').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  await page.locator('.appointment-card').first().click();
  await page.locator('#btn-back').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  expect(dialogs).toEqual([]);
  if (withTelegram) expect(await page.evaluate(() => window.__confirmMessages)).toEqual([]);
});

test('услуга и статус учитываются в защите; успешное сохранение снимает предупреждение', async ({ page, withTelegram }) => {
  await page.goto('/');
  await page.locator('#btn-add-appt').click();
  await page.locator('[data-service="pedicure"]').click();
  await page.locator('[data-status="cancelled"]').click();
  await answerNextConfirmation(page, withTelegram, false);
  await page.locator('#btn-cancel-appt').click();
  await expect(page.locator('#screen-form')).toHaveClass(/active/);
  await page.locator('#form-appt-client').fill('Сохранённый клиент');
  await page.locator('#btn-submit-appt').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  if (withTelegram) expect(await page.evaluate(() => window.__closingProtection)).toBe(false);
});

test('сохранение настроек не сбрасывает защиту несохранённого прайса', async ({ page, withTelegram }) => {
  await page.goto('/');
  await page.locator('#btn-open-settings').click();
  await page.locator('#setting-price-manicure').fill('999');
  await page.locator('#setting-notify-time').fill('20:30');
  await page.locator('#btn-save-settings').click();
  await expect(page.locator('#btn-save-settings')).toBeEnabled();
  await answerNextConfirmation(page, withTelegram, false);
  await page.locator('#btn-tab-main').click();
  await expect(page.locator('#screen-settings')).toHaveClass(/active/);
  await expect(page.locator('#setting-price-manicure')).toHaveValue('999');
  await page.locator('#btn-save-prices').click();
  await expect(page.locator('#btn-save-prices')).toBeEnabled();
  await page.locator('#btn-tab-main').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
});

test('закрытие клиента и траты предупреждает и оставляет данные по отказу', async ({ page, model, withTelegram }) => {
  await page.goto('/');
  await page.locator('#btn-open-clients').click();
  await page.locator('#btn-add-client').click();
  await page.locator('#edit-client-name').fill('Контакт');
  await answerNextConfirmation(page, withTelegram, false);
  await page.locator('#btn-close-client-edit').click();
  await expect(page.locator('#edit-client-name')).toHaveValue('Контакт');
  await expect(page.locator('#modal-client-edit')).toBeVisible();
  await answerNextConfirmation(page, withTelegram, true);
  await page.locator('#btn-cancel-client-edit').click();
  await expect(page.locator('#modal-client-edit')).toBeHidden();
  await page.locator('#btn-open-income').click();
  await page.locator('#btn-add-expense').click();
  await page.locator('#edit-expense-name').fill('Материалы');
  await answerNextConfirmation(page, withTelegram, false);
  await page.locator('#btn-close-expense-edit').click();
  await expect(page.locator('#modal-expense-edit')).toBeVisible();
  await expect(page.locator('#edit-expense-name')).toHaveValue('Материалы');
  expect(model.writes).toHaveLength(0);
});

test('заметка защищена при выходе и сохраняется одной доступной кнопкой', async ({ page, model, withTelegram }) => {
  await page.goto('/');
  await expect(page.locator('.appointment-card')).toHaveCount(2);
  await page.locator('#btn-day-note-action').click();
  await page.locator('#note-text-input').fill('Не забыть материалы');
  await answerNextConfirmation(page, withTelegram, false);
  await page.locator('#btn-cancel-note').click();
  await expect(page.locator('#screen-note')).toHaveClass(/active/);
  if (withTelegram) {
    await expect(page.locator('#btn-save-note')).toBeHidden();
    await page.evaluate(() => window.__telegramButton.callback());
  } else await page.locator('#btn-save-note').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  expect(model.writes.filter(write => write.path.startsWith('/api/notes/'))).toHaveLength(1);
});

test('на экранах один заголовок, длинные имена и комментарии помещаются в карточку', async ({ page, model }) => {
  model.appointments[0].client_name = 'ОченьДлинноеИмяБезПробелов'.repeat(8);
  model.appointments[0].comment = 'ДлинныйКомментарий'.repeat(15);
  await page.goto('/');
  await expect(page.locator('.appointment-card')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const [button, screen] of [['#btn-open-clients', 'clients'], ['#btn-open-settings', 'settings'], ['#btn-open-income', 'income']]) {
    await page.locator(button).click();
    await expect(page.locator(`#screen-${screen}`)).toHaveClass(/active/);
    await expect(page.locator(`#screen-${screen} h2`)).toHaveCount(0);
  }
});
