import { todayStr } from './state.js';
import { RU_MONTHS, RU_MONTHS_NOM, RU_WEEKDAYS_SHORT, addDays, fmt, parseDate } from './dates.js';
import { escapeHtml, showToast } from './ui.js';
import { formatMoney } from './money.js';
import { plural } from './schedule.js';
import { haptic } from './telegram.js';
import { api } from './api.js';
import { goScreen } from './navigation.js';

import { income, incomePeriodLabel } from './finance-state.js';

// ===== ДОХОДЫ =====
const RU_MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function incomeBucketTitle(period, bucket) {
  const d = parseDate(bucket.from);
  if (period === 'year') return `${RU_MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
  return `${RU_WEEKDAYS_SHORT[(d.getDay() + 6) % 7]}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
}

function incomeAxisLabel(period, index, total) {
  if (period === 'week') return RU_WEEKDAYS_SHORT[index];
  if (period === 'year') return RU_MONTHS_SHORT[index];
  const day = index + 1; // месяц: подписываем 1, 5, 10, … и последний день, если не вплотную к кратному 5
  if (day === 1 || day % 5 === 0) return String(day);
  return day === total && total % 5 >= 3 ? String(day) : '';
}

function unpricedPhrase(n) {
  const word = n % 10 === 1 && n % 100 !== 11 ? 'записи' : 'записей';
  return `У ${n} ${word} не указана цена — они не входят в доходы.`;
}

const incomeValue = (b) => (income.metric === 'expense' ? b.expense : b.sum);

function renderIncomeMaterials(d) {
  const box = document.getElementById('income-materials');
  if (!box) return;
  box.innerHTML = '';
  const list = d.materials || [];
  if (!list.length) {
    box.innerHTML = '<div class="materials-empty">Трат за этот период нет</div>';
    return;
  }
  const top = list[0].sum || 1;
  list.slice(0, 10).forEach((m) => {
    const row = document.createElement('div');
    row.className = 'material-row';
    row.innerHTML = `
      <div class="material-bar" style="width: ${Math.max(4, Math.round((m.sum / top) * 100))}%"></div>
      <div class="material-info">
        <span class="material-name">${escapeHtml(m.name)}</span>
        <span class="material-count">${m.count}×</span>
      </div>
      <div class="material-sum">${formatMoney(m.sum)}</div>`;
    box.appendChild(row);
  });
  const rest = list.slice(10);
  if (rest.length) {
    const more = document.createElement('div');
    more.className = 'materials-more';
    more.textContent = `Ещё ${rest.length} поз. на ${formatMoney(rest.reduce((a, m) => a + m.sum, 0))} — в «Все траты за период»`;
    box.appendChild(more);
  }
}

function renderIncomeSummary() {
  const d = income.data;
  if (!d) return;
  const isExp = income.metric === 'expense';
  const selected = income.selectedKey ? d.buckets.find((b) => b.key === income.selectedKey) : null;

  document.getElementById('income-period-label').textContent = incomePeriodLabel(d);
  document.getElementById('income-focus-label').textContent = selected
    ? incomeBucketTitle(d.period, selected)
    : (isExp
        ? { week: 'Траты за неделю', month: 'Траты за месяц', year: 'Траты за год' }
        : { week: 'Доход за неделю', month: 'Доход за месяц', year: 'Доход за год' })[d.period];
  document.getElementById('income-total-value').textContent =
    formatMoney(selected ? incomeValue(selected) : (isExp ? d.total_expense : d.total));

  // Динамика к прошлому периоду: рост дохода — хорошо (зелёный), рост трат — плохо (красный)
  const deltaEl = document.getElementById('income-delta');
  deltaEl.className = 'income-delta';
  const cur = isExp ? d.total_expense : d.total;
  const prev = isExp ? d.prev_expense : d.prev_total;
  if (selected) {
    const n = isExp ? selected.expense_count : selected.paid;
    deltaEl.textContent = n
      ? `${isExp ? 'Покупок' : 'Записей с ценой'}: ${n}`
      : (isExp ? 'Трат нет' : 'Нет записей с ценой');
  } else if (prev > 0) {
    const pct = Math.round(((cur - prev) / prev) * 100);
    const prevWord = { week: 'прошлой неделе', month: 'прошлому месяцу', year: 'прошлому году' }[d.period];
    if (pct === 0) {
      deltaEl.textContent = `Без изменений к ${prevWord}`;
    } else {
      const good = isExp ? pct < 0 : pct > 0;
      deltaEl.classList.add(good ? 'up' : 'down');
      deltaEl.textContent = `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% к ${prevWord}`;
    }
  } else {
    deltaEl.textContent = '';
  }

  // Итог периода: доход, траты, прибыль
  document.getElementById('income-sum-income').textContent = formatMoney(d.total);
  document.getElementById('income-sum-expense').textContent = formatMoney(d.total_expense);
  const profitEl = document.getElementById('income-sum-profit');
  profitEl.textContent = formatMoney(d.profit);
  profitEl.className = 'income-stat-value' + (d.profit > 0 ? ' is-plus' : d.profit < 0 ? ' is-minus' : '');

  document.getElementById('income-stat-count').textContent = String(d.paid);
  document.getElementById('income-stat-avg').textContent = d.paid ? formatMoney(d.avg) : '—';

  const noteEl = document.getElementById('income-note');
  if (d.unpaid > 0) {
    noteEl.textContent = unpricedPhrase(d.unpaid);
    noteEl.style.display = 'block';
  } else if (d.paid === 0) {
    noteEl.textContent = 'Укажи цену в записях — и здесь появятся доходы.';
    noteEl.style.display = 'block';
  } else {
    noteEl.style.display = 'none';
  }

  const extraEl = document.getElementById('income-extra');
  if (extraEl) {
    const lines = [];
    if (d.expected > 0) {
      lines.push(`⏳ Ожидается: ${formatMoney(d.expected)} (${d.expected_count} ${plural(d.expected_count, 'запись', 'записи', 'записей')})`);
    }
    const missed = (d.no_show || 0) + (d.cancelled || 0);
    if (missed > 0) {
      lines.push(`⚠️ Сорвалось записей: ${missed} (не пришли — ${d.no_show}, отменили — ${d.cancelled})`);
    }
    extraEl.innerHTML = '';
    lines.forEach((t) => { const div = document.createElement('div'); div.textContent = t; extraEl.appendChild(div); });
    extraEl.style.display = lines.length ? 'block' : 'none';
  }

  renderIncomeMaterials(d);
}

function renderIncomeChart() {
  const d = income.data;
  const chart = document.getElementById('income-chart');
  const axis = document.getElementById('income-axis');
  if (!d || !chart || !axis) return;

  const cols = `repeat(${d.buckets.length}, minmax(0, 1fr))`;
  chart.className = `income-chart is-${d.period}${income.metric === 'expense' ? ' is-expense' : ''}`;
  axis.className = `income-axis is-${d.period}`;
  chart.style.gridTemplateColumns = cols;
  axis.style.gridTemplateColumns = cols;
  chart.innerHTML = '';
  axis.innerHTML = '';

  const max = Math.max(0, ...d.buckets.map(incomeValue));
  const nowKey = d.period === 'year' ? todayStr.slice(0, 7) : todayStr;
  const fills = [];

  d.buckets.forEach((b, i) => {
    const val = incomeValue(b);
    const pct = max > 0 && val > 0 ? Math.max(3, Math.round((val / max) * 100)) : 0;
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'income-bar';
    bar.dataset.key = b.key;
    if (val === 0) bar.classList.add('is-empty');
    if (b.key === nowKey) bar.classList.add('is-today');
    if (b.key === income.selectedKey) bar.classList.add('is-selected');
    bar.setAttribute('aria-label', `${incomeBucketTitle(d.period, b)}: ${formatMoney(val)}`);

    const fill = document.createElement('div');
    fill.className = 'income-bar-fill';
    fill.style.height = '0%';
    fill.dataset.target = `${pct}%`;
    bar.appendChild(fill);
    fills.push(fill);

    bar.addEventListener('click', () => {
      haptic('light');
      income.selectedKey = income.selectedKey === b.key ? null : b.key;
      chart.querySelectorAll('.income-bar').forEach((el) => {
        el.classList.toggle('is-selected', el.dataset.key === income.selectedKey);
      });
      renderIncomeSummary();
    });
    chart.appendChild(bar);

    const label = document.createElement('span');
    label.textContent = incomeAxisLabel(d.period, i, d.buckets.length);
    if (b.key === nowKey) label.classList.add('is-today');
    axis.appendChild(label);
  });

  // Плавное «вырастание» столбиков
  const grow = () => fills.forEach((f) => { f.style.height = f.dataset.target; });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(grow));
  else grow();
}

function renderIncome() {
  renderIncomeChart();
  renderIncomeSummary();
}

export async function loadIncome() {
  const reqId = ++income.requestId;
  try {
    const data = await api(`/stats?period=${income.period}&date=${income.anchor}`);
    if (reqId !== income.requestId) return; // пока грузилось, пользователь переключил период
    income.data = data;
    income.selectedKey = null;
    renderIncome();
  } catch (err) {
    console.error('Ошибка загрузки доходов:', err);
  }
}

function shiftIncomeAnchor(dir) {
  if (income.period === 'week') {
    income.anchor = addDays(income.anchor, 7 * dir);
    return;
  }
  const d = parseDate(income.anchor);
  d.setDate(1);
  if (income.period === 'month') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  income.anchor = fmt(d);
}

document.getElementById('btn-open-income')?.addEventListener('click', () => {
  haptic('light');
  income.anchor = todayStr;
  goScreen('income');
  loadIncome();
});
document.getElementById('btn-back-from-income')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});
document.querySelectorAll('#income-period-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    if (btn.dataset.period === income.period) income.anchor = todayStr; // повторное нажатие — к текущему периоду
    income.period = btn.dataset.period;
    document.querySelectorAll('#income-period-selector .segment-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    loadIncome();
  });
});
document.getElementById('btn-income-prev')?.addEventListener('click', () => { haptic('light'); shiftIncomeAnchor(-1); loadIncome(); });
document.getElementById('btn-income-next')?.addEventListener('click', () => { haptic('light'); shiftIncomeAnchor(1); loadIncome(); });

document.querySelectorAll('#income-metric-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    income.metric = btn.dataset.metric;
    income.selectedKey = null;
    document.querySelectorAll('#income-metric-selector .segment-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderIncome();
  });
});

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

document.getElementById('btn-export-finance')?.addEventListener('click', exportFinance);
