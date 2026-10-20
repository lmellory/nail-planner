import { state } from './state.js';
import { singleAction } from './requests.js';
import { getApi, putApi } from './api-contracts.js';
import { formInput } from './dom.js';
import { haptic } from './telegram.js';
import { showToast } from './ui.js';

// ===== ПРАЙС УСЛУГ =====
/** @type {Array<import('../../src/types').Service>} */
const PRICE_SERVICES = ['manicure', 'pedicure', 'both', 'manicure_fingers'];

function applyPricesToInputs() {
  for (const s of PRICE_SERVICES) {
    const el = formInput(`setting-price-${s}`);
    if (el) el.value = String(state.prices[s] ?? '');
  }
}

export async function loadPrices() {
  state.prices = await getApi('/prices');
  applyPricesToInputs();
}

function savePrices() {
  return singleAction('savePrices', ["btn-save-prices"], performSavePrices);
}

async function performSavePrices() {
  /** @type {import('./contracts').Prices} */
  const body = {};
  for (const s of PRICE_SERVICES) {
    const el = formInput(`setting-price-${s}`);
    if (el?.validity?.badInput) return showToast('Цена — целое число, например 800');
    const raw = el?.value?.trim() ?? '';
    if (raw === '') { body[s] = null; continue; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return showToast('Цена — целое число, например 800');
    body[s] = n;
  }
  try {
    state.prices = await putApi('/prices', body);
    applyPricesToInputs();
    haptic('success');
    showToast('Прайс сохранён ✅');
  } catch (err) {
    console.error('Ошибка сохранения прайса:', err);
  }
}

document.getElementById('btn-save-prices')?.addEventListener('click', savePrices);
