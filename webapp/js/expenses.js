import { state, todayStr } from './state.js';
import { RU_MONTHS, RU_WEEKDAYS_SHORT, addDays, parseDate } from './dates.js';
import { confirmDialog, escapeHtml, showToast } from './ui.js';
import { formatMoney } from './money.js';
import { haptic } from './telegram.js';
import { api } from './api.js';
import { goScreen } from './navigation.js';
import { singleAction } from './requests.js';

import { income, incomePeriodLabel } from './finance-state.js';
import { loadIncome } from './income.js';

// ===== ТРАТЫ НА МАТЕРИАЛЫ =====

async function loadExpenseNames() {
  try {
    const names = await api('/expenses/names');
    const list = document.getElementById('expense-names-datalist');
    if (list) list.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  } catch {}
}

function openExpenseEdit(expense = null) {
  const modal = document.getElementById('modal-expense-edit');
  document.getElementById('modal-expense-title').textContent = expense ? 'Редактировать трату' : 'Новая трата';
  document.getElementById('edit-expense-id').value = expense ? expense.id : '';
  document.getElementById('edit-expense-date').value = expense ? expense.date : todayStr;
  document.getElementById('edit-expense-name').value = expense ? expense.name : '';
  document.getElementById('edit-expense-amount').value = expense ? expense.amount : '';
  document.getElementById('btn-delete-expense').style.display = expense ? 'block' : 'none';
  if (modal) modal.style.display = 'flex';
  loadExpenseNames();
  setTimeout(() => {
    // Не перехватываем фокус, если мастер уже перешёл к другому полю окна.
    if (modal?.style.display !== 'flex' || modal.contains(document.activeElement)) return;
    document.getElementById('edit-expense-name')?.focus();
  }, 100);
}

function closeExpenseEdit() {
  const modal = document.getElementById('modal-expense-edit');
  if (modal) modal.style.display = 'none';
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
  const id = document.getElementById('edit-expense-id')?.value;
  const date = document.getElementById('edit-expense-date')?.value;
  const name = document.getElementById('edit-expense-name')?.value?.trim();
  const amountEl = document.getElementById('edit-expense-amount');

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
    closeExpenseEdit();
    await refreshAfterExpenseChange();
  } catch (err) {
    console.error('Ошибка сохранения траты:', err);
  }
}

function deleteExpenseModal() {
  const id = document.getElementById('edit-expense-id')?.value;
  if (!id) return;
  confirmDialog('Удалить эту трату?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' });
      haptic('success');
      showToast('Трата удалена');
      closeExpenseEdit();
      await refreshAfterExpenseChange();
    } catch (err) {
      console.error('Ошибка удаления траты:', err);
    }
  });
}

function renderExpensesList(items) {
  const list = document.getElementById('expenses-list');
  const totalEl = document.getElementById('expenses-total');
  if (!list) return;
  list.innerHTML = '';
  totalEl.textContent = formatMoney(items.reduce((a, x) => a + x.amount, 0));
  if (!items.length) {
    list.innerHTML = '<div class="expenses-empty">За этот период трат нет.<br>Нажми «+ Новая», чтобы добавить.</div>';
    return;
  }
  // Группируем по дате (список уже отсортирован: новые сверху)
  const byDate = new Map();
  for (const x of items) {
    if (!byDate.has(x.date)) byDate.set(x.date, []);
    byDate.get(x.date).push(x);
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
  document.getElementById('expenses-period-label').textContent = d ? incomePeriodLabel(d) : '';
  try {
    renderExpensesList(await api(`/expenses?from=${from}&to=${to}`));
  } catch (err) {
    console.error('Ошибка загрузки трат:', err);
  }
}

document.getElementById('btn-add-expense')?.addEventListener('click', () => { haptic('light'); openExpenseEdit(null); });
document.getElementById('btn-add-expense-list')?.addEventListener('click', () => { haptic('light'); openExpenseEdit(null); });
document.getElementById('btn-open-expenses')?.addEventListener('click', () => {
  haptic('light');
  goScreen('expenses');
  loadExpensesList();
});
document.getElementById('btn-back-from-expenses')?.addEventListener('click', () => {
  haptic('light');
  goScreen('income');
  loadIncome(); // траты могли измениться
});
document.getElementById('btn-close-expense-edit')?.addEventListener('click', closeExpenseEdit);
document.getElementById('btn-cancel-expense-edit')?.addEventListener('click', closeExpenseEdit);
document.getElementById('btn-save-expense')?.addEventListener('click', saveExpense);
document.getElementById('btn-delete-expense')?.addEventListener('click', deleteExpenseModal);
