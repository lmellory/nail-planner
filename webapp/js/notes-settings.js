import { formatFullDateRu } from './dates.js';
import { state } from './state.js';
import { goScreen } from './navigation.js';
import { singleAction } from './requests.js';
import { api } from './api.js';
import { haptic } from './telegram.js';
import { confirmDialog, showToast } from './ui.js';
import { loadSelectedDay, loadWeekSummary } from './schedule.js';
import { loadClientsDatalist } from './clients.js';
import { income } from './finance.js';

// ===== 6. ЗАМЕТКА ДНЯ =====

function openNote() {
  const titleDate = document.getElementById('note-screen-date');
  const textarea = document.getElementById('note-text-input');

  if (titleDate) titleDate.textContent = formatFullDateRu(state.selectedDate);
  if (textarea) textarea.value = state.currentDayNote || '';

  goScreen('note');
  setTimeout(() => textarea?.focus(), 100);
}

export function saveDayNote() {
  return singleAction('saveDayNote', ["btn-save-note"], performSaveDayNote);
}

async function performSaveDayNote() {
  const textarea = document.getElementById('note-text-input');
  const text = textarea?.value?.trim() || '';

  try {
    await api(`/notes/${state.selectedDate}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    });

    haptic('success');
    showToast(text ? 'Заметка сохранена 📝' : 'Заметка удалена');
    state.currentDayNote = text;

    goScreen('main');
    await loadWeekSummary();
    await loadSelectedDay();
  } catch (err) {
    console.error('Ошибка сохранения заметки:', err);
  }
}

function deleteDayNote() {
  const date = state.selectedDate;
  confirmDialog('Очистить заметку на этот день?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/notes/${date}`, {
        method: 'PUT',
        body: JSON.stringify({ text: '' }),
      });
      haptic('success');
      showToast('Заметка очищена');
      state.currentDayNote = '';
      goScreen('main');
      await loadWeekSummary();
      await loadSelectedDay();
    } catch (err) {
      console.error('Ошибка удаления заметки:', err);
    }
  });
}

document.getElementById('btn-day-note-action')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
document.getElementById('btn-edit-note-card')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
document.getElementById('btn-delete-note')?.addEventListener('click', deleteDayNote);
document.getElementById('btn-cancel-note')?.addEventListener('click', () => goScreen('main'));

// ===== 7. НАСТРОЙКИ И ЭКСПОРТ =====

let selectedWorkDays = [1, 2, 3, 4, 5, 6];

function renderWorkDaysPicker() {
  document.querySelectorAll('#setting-work-days-picker .day-toggle-pill').forEach((btn) => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', selectedWorkDays.includes(day));
  });
}

document.querySelectorAll('#setting-work-days-picker .day-toggle-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const day = Number(btn.dataset.day);
    if (selectedWorkDays.includes(day)) {
      if (selectedWorkDays.length > 1) {
        selectedWorkDays = selectedWorkDays.filter((d) => d !== day);
      }
    } else {
      selectedWorkDays.push(day);
      selectedWorkDays.sort((a, b) => a - b);
    }
    renderWorkDaysPicker();
  });
});

export async function openSettings() {
  loadPrices().catch(() => {});
  try {
    const s = await api('/settings');
    const enabledCheck = document.getElementById('setting-notify-enabled');
    const newApptCheck = document.getElementById('setting-notify-new-appt');
    const timeInput = document.getElementById('setting-notify-time');
    const tzSelect = document.getElementById('setting-tz');
    const workStart = document.getElementById('setting-work-start');
    const workEnd = document.getElementById('setting-work-end');

    const backupCheck = document.getElementById('setting-backup-enabled');
    if (backupCheck) backupCheck.checked = s.backup_enabled !== false;
    if (enabledCheck) enabledCheck.checked = !!s.notify_enabled;
    if (newApptCheck) newApptCheck.checked = s.notify_new_appt !== false;
    if (timeInput) timeInput.value = s.notify_time || '22:00';
    if (workStart) workStart.value = s.work_start_time || '09:00';
    if (workEnd) workEnd.value = s.work_end_time || '20:00';

    if (typeof s.work_days === 'string') {
      selectedWorkDays = s.work_days.split(',').map((x) => Number(x.trim())).filter(Boolean);
    } else {
      selectedWorkDays = [1, 2, 3, 4, 5, 6];
    }
    renderWorkDaysPicker();

    if (tzSelect && s.tz) {
      if (![...tzSelect.options].some((o) => o.value === s.tz)) {
        const opt = document.createElement('option');
        opt.value = s.tz;
        opt.textContent = s.tz;
        tzSelect.appendChild(opt);
      }
      tzSelect.value = s.tz;
    }
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
  goScreen('settings');
}

function saveSettings() {
  return singleAction('saveSettings', ["btn-save-settings"], performSaveSettings);
}

async function performSaveSettings() {
  const notify_enabled = !!document.getElementById('setting-notify-enabled')?.checked;
  const notify_new_appt = !!document.getElementById('setting-notify-new-appt')?.checked;
  const notify_time = document.getElementById('setting-notify-time')?.value || '22:00';
  const tz = document.getElementById('setting-tz')?.value || 'Europe/Chisinau';
  const work_start_time = document.getElementById('setting-work-start')?.value || '09:00';
  const work_end_time = document.getElementById('setting-work-end')?.value || '20:00';
  const work_days = selectedWorkDays.join(',');
  const backup_enabled = !!document.getElementById('setting-backup-enabled')?.checked;

  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        notify_enabled,
        notify_time,
        tz,
        notify_new_appt,
        work_start_time,
        work_end_time,
        work_days,
        backup_enabled,
      }),
    });
    haptic('success');
    showToast('Настройки сохранены ✅');
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
  }
}

// ===== ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ =====
async function restoreFromFile(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return showToast('Файл не похож на резервную копию');
  }
  let preview;
  try {
    preview = await api('/import', { method: 'POST', body: JSON.stringify({ backup }) }); // только проверка
  } catch {
    return; // api() уже показал причину
  }
  const r = preview.report;
  const skipped = r.appointments.skipped + r.clients.skipped + r.expenses.skipped + r.day_notes.skipped;
  const message =
    `Восстановить из копии?\n\nЗаписей: ${r.appointments.ok}\nКлиентов: ${r.clients.ok}\nТрат: ${r.expenses.ok}\nЗаметок: ${r.day_notes.ok}` +
    (skipped ? `\nПропущено повреждённых строк: ${skipped}` : '') +
    `\n\nВсе текущие данные будут заменены.`;
  confirmDialog(message, async (confirmed) => {
    if (!confirmed) return;
    try {
      await singleAction('restoreBackup', ['btn-restore-backup'], () => api('/import', { method: 'POST', body: JSON.stringify({ backup, confirm: true }) }));
      haptic('success');
      showToast('Данные восстановлены ✅');
      await Promise.all([loadWeekSummary(), loadSelectedDay(), loadClientsDatalist().catch(() => {}), loadPrices().catch(() => {})]);
      await openSettings();
    } catch (err) {
      console.error('Ошибка восстановления:', err);
    }
  });
}

document.getElementById('btn-restore-backup')?.addEventListener('click', () => {
  haptic('light');
  document.getElementById('restore-file-input')?.click();
});
document.getElementById('restore-file-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // чтобы тот же файл можно было выбрать повторно
  if (file) restoreFromFile(file);
});

// ===== ПРАЙС УСЛУГ =====
const PRICE_SERVICES = ['manicure', 'pedicure', 'both', 'manicure_fingers'];

function applyPricesToInputs() {
  for (const s of PRICE_SERVICES) {
    const el = document.getElementById(`setting-price-${s}`);
    if (el) el.value = state.prices[s] ?? '';
  }
}

export async function loadPrices() {
  state.prices = await api('/prices');
  applyPricesToInputs();
}

function savePrices() {
  return singleAction('savePrices', ["btn-save-prices"], performSavePrices);
}

async function performSavePrices() {
  const body = {};
  for (const s of PRICE_SERVICES) {
    const el = document.getElementById(`setting-price-${s}`);
    if (el?.validity?.badInput) return showToast('Цена — целое число, например 800');
    const raw = el?.value?.trim() ?? '';
    if (raw === '') { body[s] = null; continue; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return showToast('Цена — целое число, например 800');
    body[s] = n;
  }
  try {
    state.prices = await api('/prices', { method: 'PUT', body: JSON.stringify(body) });
    applyPricesToInputs();
    haptic('success');
    showToast('Прайс сохранён ✅');
  } catch (err) {
    console.error('Ошибка сохранения прайса:', err);
  }
}

async function exportFinance() {
  haptic('light');
  showToast('Формируем файл и отправляем в чат…');
  try {
    const res = await api('/export/finance', {
      method: 'POST',
      body: JSON.stringify({ period: income.period, date: income.anchor }),
    });
    if (res.ok) {
      haptic('success');
      showToast('📊 CSV за период отправлен в чат!');
    }
  } catch (err) {
    console.error('Ошибка выгрузки доходов:', err);
  }
}

async function exportData(format = 'csv') {
  haptic('light');
  showToast('Формируем и отправляем файл в чат…');
  try {
    const res = await api('/export/send', {
      method: 'POST',
      body: JSON.stringify({ format }),
    });
    if (res.ok) {
      haptic('success');
      showToast(format === 'csv' ? '📊 CSV-файл отправлен ботом в чат!' : '💾 Резервная копия JSON отправлена в чат!');
    }
  } catch (err) {
    console.error('Ошибка экспорта:', err);
  }
}

document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
document.getElementById('btn-export-csv')?.addEventListener('click', () => exportData('csv'));
document.getElementById('btn-export-json')?.addEventListener('click', () => exportData('json'));
document.getElementById('btn-save-prices')?.addEventListener('click', savePrices);
document.getElementById('btn-export-finance')?.addEventListener('click', exportFinance);
