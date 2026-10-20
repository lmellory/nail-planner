// Только компиляция: этот файл не исполняется и не отправляет запросов.
import { getApi, putApi } from '../../webapp/js/api-contracts.js';
import { state } from '../../webapp/js/state.js';
import { formInput } from '../../webapp/js/dom.js';

getApi('/settings').then(settings => {
  settings.notify_time.toUpperCase();
  // @ts-expect-error Время приходит строкой, а не числом.
  settings.notify_time.toFixed(2);
});
getApi('/prices').then(prices => {
  const value: number | null | undefined = prices.manicure;
  void value;
  // @ts-expect-error В прайсе нельзя добавлять произвольную услугу.
  prices.unknown_service = 100;
});
putApi('/prices', { manicure: 250, pedicure: null });
// @ts-expect-error Цена должна быть числом или null.
putApi('/prices', { manicure: '250' });
// @ts-expect-error Незарегистрированный endpoint не считается типизированным контрактом.
getApi('/unknown');
// @ts-expect-error Счётчик операций нельзя заменять строкой.
state.pendingWrites = '1';
const input = formInput('setting-notify-time');
if (input) input.value = '22:00';
