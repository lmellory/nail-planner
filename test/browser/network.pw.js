import { test, expect, appointments } from './fixtures.js';

test('медленное сохранение блокирует повторное нажатие и создаёт одну запись', async ({ page, model }) => {
  model.latency['/api/appointments'] = 800;
  await page.goto('/');
  await page.locator('#btn-add-appt').click();
  await page.locator('#form-appt-client').fill('Медленная сеть');
  await page.locator('#btn-submit-appt').dblclick();
  await expect(page.locator('#btn-submit-appt')).toBeDisabled();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  expect(model.requests.filter(request => request.path === '/api/appointments' && request.method === 'POST')).toHaveLength(1);
  expect(model.writes.filter(request => request.path === '/api/appointments')).toHaveLength(1);
});

test('ошибка сохранения оставляет данные в форме и позволяет повторить запрос', async ({ page, model }) => {
  await page.goto('/');
  await expect(page.locator('.appointment-card')).toHaveCount(2);
  await page.locator('#btn-add-appt').click();
  await page.locator('#form-appt-client').fill('Не потерять имя');
  await page.locator('#form-appt-comment').fill('Не потерять комментарий');
  model.failures['/api/appointments'] = 1;
  await page.locator('#btn-submit-appt').click();
  await expect(page.locator('#toast')).toContainText('Тестовая ошибка');
  await expect(page.locator('#screen-form')).toHaveClass(/active/);
  await expect(page.locator('#form-appt-client')).toHaveValue('Не потерять имя');
  await expect(page.locator('#form-appt-comment')).toHaveValue('Не потерять комментарий');
  await expect(page.locator('#btn-submit-appt')).toBeEnabled();
  expect(model.writes.filter(request => request.path === '/api/appointments')).toHaveLength(0);
  await page.locator('#btn-submit-appt').click();
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  expect(model.writes.filter(request => request.path === '/api/appointments')).toHaveLength(1);
});

test('расписание с 500 записями прокручивается до последней карточки', async ({ page, model }) => {
  model.appointments = appointments(500);
  await page.goto('/');
  await expect(page.locator('.appointment-card')).toHaveCount(500);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.appointment-card').last()).toBeInViewport();
  const last = await page.locator('.appointment-card').last().boundingBox();
  const menu = await page.locator('#bottom-nav').boundingBox();
  expect(last.y + last.height).toBeLessThanOrEqual(menu.y - 12);
});
