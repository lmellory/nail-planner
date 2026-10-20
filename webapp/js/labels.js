const SERVICE_NAMES = { manicure: 'Маникюр', pedicure: 'Педикюр', both: 'Маникюр + Педикюр', manicure_fingers: 'Маникюр + пальцы', fingers: 'Пальцы' };
/** @param {import('./contracts').Service} service */
export function serviceName(service) { return SERVICE_NAMES[service] || service; }

/** @param {unknown} value @returns {value is import('./contracts').Service} */
export function isService(value) { return typeof value === 'string' && Object.hasOwn(SERVICE_NAMES, value); }
