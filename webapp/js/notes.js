import { byId } from './dom.js';
import { formatFullDateRu } from './dates.js';
import { state } from './state.js';
import { goScreen } from './navigation.js';
import { singleAction } from './requests.js';
import { api } from './api.js';
import { haptic } from './telegram.js';
import { confirmDialog, showToast } from './ui.js';
import { loadSelectedDay, loadWeekSummary } from './schedule.js';

// ===== 6. ЗАМЕТКА ДНЯ =====

function openNote() {
  const titleDate = byId('note-screen-date', 'span');
  const textarea = byId('note-text-input', 'textarea');

  if (titleDate) titleDate.textContent = formatFullDateRu(state.selectedDate);
  if (textarea) textarea.value = state.currentDayNote || '';

  goScreen('note');
  setTimeout(() => textarea?.focus(), 100);
}

export function saveDayNote() {
  return singleAction('saveDayNote', ["btn-save-note"], performSaveDayNote);
}

async function performSaveDayNote() {
  const textarea = byId('note-text-input', 'textarea');
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

byId('btn-day-note-action', 'button')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
byId('btn-edit-note-card', 'button')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
byId('btn-delete-note', 'button')?.addEventListener('click', deleteDayNote);
byId('btn-cancel-note', 'button')?.addEventListener('click', () => goScreen('main'));
