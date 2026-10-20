import { getApi } from './api-contracts.js';
import { byId } from './dom.js';
import { state, todayStr } from './state.js';
import { RU_MONTHS, RU_WEEKDAYS_SHORT, addDays, parseDate } from './dates.js';
import { confirmDialog, escapeHtml, showToast } from './ui.js';
import { formatMoney } from './money.js';
import { haptic } from './telegram.js';
import { api } from './api.js';
import { goScreen } from './navigation.js';
import { singleAction } from './requests.js';
import { rememberDraft, leaveDrafts, showSaveError } from './drafts.js';

import { income, incomePeriodLabel } from './finance-state.js';
import { loadIncome } from './income.js';

// ===== ТРАТЫ НА МАТЕРИАЛЫ =====

async function loadExpenseNames() {
  try {
    const names = await getApi('/expenses/names');
    const list = byId('expense-names-datalist', 'datalist');
    if (list) list.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  } catch {}
}

/** @param {import('./contracts').Expense|null} [expense] */
function openExpenseEdit(expense = null) {
  const modal = byId('modal-expense-edit', 'div');
  byId('modal-expense-title', 'h3').textContent = expense ? 'Редактировать трату' : 'Новая трата';
  byId('edit-expense-id', 'input').value = String(expense ? expense.id : '');
  byId('edit-expense-date', 'input').value = String(expense ? expense.date : todayStr);
  byId('edit-expense-name', 'input').value = String(expense ? expense.name : '');
  byId('edit-expense-amount', 'input').value = String(expense ? expense.amount : '');
  byId('btn-delete-expense', 'button').style.display = expense ? 'block' : 'none';
  if (modal) modal.style.display = 'flex';
  rememberDraft('modal-expense-edit');
  loadExpenseNames();
  setTimeout(() => {
    // Не перехватываем фокус, если мастер уже перешёл к другому полю окна.
    if (modal?.style.display !== 'flex' || modal.contains(document.activeElement)) return;
    byId('edit-expense-name', 'input')?.focus();
  }, 100);
}

function closeExpenseEdit() {
  leaveDrafts(() => {
    const modal = byId('modal-expense-edit', 'div');
    if (modal) modal.style.display = 'none';
  });
}

// После изменения трат обновляем тот экран, который открыт под окном
async function refreshAfterExpenseChange() {
  if (state.currentScreen === 'expenses') await loadExpensesList();
  else if (state.currentScreen === 'income') await loadIncome();
}

function saveExpense() {
  return singleAction('saveExpense', ["btn-save-expense"], performSaveExpense);
}

async function performSaveExpense() {
  const id = byId('edit-expense-id', 'input')?.value;
  const date = byId('edit-expense-date', 'input')?.value;
  const name = byId('edit-expense-name', 'input')?.value?.trim();
  const amountEl = byId('edit-expense-amount', 'input');

  if (!date) return showToast('Укажите дату');
  if (!name) return showToast('Укажите, на что потрачено');
  if (amountEl?.validity?.badInput) return showToast('Сумма — целое число, например 450');
  const amount = Number(amountEl?.value?.trim() ?? '');
  if (!Number.isInteger(amount) || amount <= 0) return showToast('Сумма — целое число больше нуля');

  try {
    await api(id ? `/expenses/${id}` : '/expenses', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({ date, name, amount }),
    });
    haptic('success');
    showToast(id ? 'Трата обновлена ✅' : 'Трата добавлена ✅');
    rememberDraft('modal-expense-edit');
    closeExpenseEdit();
    await refreshAfterExpenseChange();
  } catch (err) {
    console.error('Ошибка сохранения траты:', err);
    showSaveError('modal-expense-edit');
  }
}

function deleteExpenseModal() {
  const id = byId('edit-expense-id', 'input')?.value;
  if (!id) return;
  confirmDialog('Удалить эту трату?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' });
      haptic('success');
      showToast('Трата удалена');
      rememberDraft('modal-expense-edit');
      closeExpenseEdit();
      await refreshAfterExpenseChange();
    } catch (err) {
      console.error('Ошибка удаления траты:', err);
    }
  });
}

/** @param {import('./contracts').Expense[]} items */
function renderExpensesList(items) {
  const list = byId('expenses-list', 'div');
  const totalEl = byId('expenses-total', 'div');
  if (!list) return;
  list.innerHTML = '';
  totalEl.textContent = formatMoney(items.reduce((a, x) => a + x.amount, 0));
  if (!items.length) {
    list.innerHTML = '<div class="expenses-empty">За этот период трат нет.<br>Нажми «+ Новая», чтобы добавить.</div>';
    return;
  }
  // Группируем по дате (список уже отсортирован: новые сверху)
  /** @type {Map<string, import('./contracts').Expense[]>} */
  const byDate = new Map();
  for (const x of items) {
    if (!byDate.has(x.date)) byDate.set(x.date, []);
    const rows = byDate.get(x.date);
    if (rows) rows.push(x);
  }
  for (const [date, rows] of byDate) {
    const d = parseDate(date);
    const head = document.createElement('div');
    head.className = 'expenses-day';
    head.innerHTML = `<span>${RU_WEEKDAYS_SHORT[(d.getDay() + 6) % 7]}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]}</span>` +
      `<span>${formatMoney(rows.reduce((a, x) => a + x.amount, 0))}</span>`;
    list.appendChild(head);
    for (const x of rows) {
      const row = document.createElement('div');
      row.className = 'expense-row';
      row.innerHTML = `<span class="expense-name">${escapeHtml(x.name)}</span><span class="expense-amount">${formatMoney(x.amount)}</span>`;
      row.addEventListener('click', () => { haptic('light'); openExpenseEdit(x); });
      list.appendChild(row);
    }
  }
}

async function loadExpensesList() {
  // Показываем траты за тот же период, что выбран на экране «Доходы»
  const d = income.data;
  const from = d ? d.from : state.weekStart;
  const to = d ? d.to : addDays(state.weekStart, 6);
  byId('expenses-period-label', 'div').textContent = d ? incomePeriodLabel(d) : '';
  try {
    renderExpensesList(await getApi(`/expenses?from=${from}&to=${to}`));
  } catch (err) {
    console.error('Ошибка загрузки трат:', err);
  }
}

byId('btn-add-expense', 'button')?.addEventListener('click', () => { haptic('light'); openExpenseEdit(null); });
byId('btn-add-expense-list', 'button')?.addEventListener('click', () => { haptic('light'); openExpenseEdit(null); });
byId('btn-open-expenses', 'button')?.addEventListener('click', () => {
  haptic('light');
  goScreen('expenses');
  loadExpensesList();
});
byId('btn-back-from-expenses', 'button')?.addEventListener('click', () => {
  haptic('light');
  goScreen('income');
  loadIncome(); // траты могли измениться
});
byId('btn-close-expense-edit', 'button')?.addEventListener('click', closeExpenseEdit);
byId('btn-cancel-expense-edit', 'button')?.addEventListener('click', closeExpenseEdit);
byId('btn-save-expense', 'button')?.addEventListener('click', saveExpense);
byId('btn-delete-expense', 'button')?.addEventListener('click', deleteExpenseModal);
