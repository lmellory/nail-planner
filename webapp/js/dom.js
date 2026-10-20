/** @param {string} id @returns {HTMLInputElement | null} */
export function formInput(id) {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element : null;
}

/** @param {string} id @returns {HTMLSelectElement | null} */
export function formSelect(id) {
  const element = document.getElementById(id);
  return element instanceof HTMLSelectElement ? element : null;
}
