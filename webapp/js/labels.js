const SERVICE_NAMES = { manicure: 'Маникюр', pedicure: 'Педикюр', both: 'Маникюр + Педикюр', manicure_fingers: 'Маникюр + пальцы', fingers: 'Пальцы' };
export function serviceName(service) { return SERVICE_NAMES[service] || service; }
