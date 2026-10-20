import { state } from './state.js';
import { goScreen } from './navigation.js';
import { singleAction } from './requests.js';
import { getApi, putApi } from './api-contracts.js';
import { formInput, formSelect } from './dom.js';
import { haptic } from './telegram.js';
import { showToast } from './ui.js';
import { loadPrices } from './prices.js';
import { rememberDraft, showSaveError } from './drafts.js';

// ===== 7. НАСТРОЙКИ И ЭКСПОРТ =====

let selectedWorkDays = [1, 2, 3, 4, 5, 6];
const workDayButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('#setting-work-days-picker .day-toggle-pill')
);

function renderWorkDaysPicker() {
  workDayButtons.forEach((btn) => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', selectedWorkDays.includes(day));
  });
}

workDayButtons.forEach((btn) => {
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
  if (state.currentScreen === 'settings') return;
  try {
    const [s] = await Promise.all([getApi('/settings'), loadPrices()]);
    const enabledCheck = formInput('setting-notify-enabled');
    const newApptCheck = formInput('setting-notify-new-appt');
    const timeInput = formInput('setting-notify-time');
    const tzSelect = formSelect('setting-tz');
    const workStart = formInput('setting-work-start');
    const workEnd = formInput('setting-work-end');

    const backupCheck = formInput('setting-backup-enabled');
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
    return;
  }
  goScreen('settings');
  rememberDraft('settings-preferences');
}

function saveSettings() {
  return singleAction('saveSettings', ["btn-save-settings"], performSaveSettings);
}

async function performSaveSettings() {
  const notify_enabled = !!formInput('setting-notify-enabled')?.checked;
  const notify_new_appt = !!formInput('setting-notify-new-appt')?.checked;
  const notify_time = formInput('setting-notify-time')?.value || '22:00';
  const tz = formSelect('setting-tz')?.value || 'Europe/Chisinau';
  const work_start_time = formInput('setting-work-start')?.value || '09:00';
  const work_end_time = formInput('setting-work-end')?.value || '20:00';
  const work_days = selectedWorkDays.join(',');
  const backup_enabled = !!formInput('setting-backup-enabled')?.checked;

  try {
    await putApi('/settings', {
      notify_enabled,
      notify_time,
      tz,
      notify_new_appt,
      work_start_time,
      work_end_time,
      work_days,
      backup_enabled,
    });
    rememberDraft('settings-preferences');
    haptic('success');
    showToast('Настройки сохранены ✅');
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
    showSaveError('settings-preferences');
  }
}

document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
