import { byId } from './dom.js';
import { singleAction } from './requests.js';
import { api } from './api.js';
import { haptic } from './telegram.js';
import { confirmDialog, showToast } from './ui.js';
import { loadSelectedDay, loadWeekSummary } from './schedule.js';
import { loadClientsDatalist } from './clients.js';
import { loadPrices } from './prices.js';
import { openSettings } from './settings.js';

// ===== ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ =====
/** @param {File} file */
async function restoreFromFile(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return showToast('Файл не похож на резервную копию');
  }
/** @type {{report: import('../../src/lib/restore').RestoreReport}} */
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

byId('btn-restore-backup', 'button')?.addEventListener('click', () => {
  haptic('light');
  byId('restore-file-input', 'input')?.click();
});
byId('restore-file-input', 'input')?.addEventListener('change', (e) => {
  const input = byId('restore-file-input', 'input');
  const file = input.files?.[0];
  input.value = ''; // чтобы тот же файл можно было выбрать повторно
  if (file) restoreFromFile(file);
});

/** @param {'csv'|'json'} [format] */
async function exportData(format = 'csv') {
  haptic('light');
  showToast('Формируем и отправляем файл в чат…');
  try {
/** @type {{ok:boolean}} */
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

byId('btn-export-csv', 'button')?.addEventListener('click', () => exportData('csv'));
byId('btn-export-json', 'button')?.addEventListener('click', () => exportData('json'));
