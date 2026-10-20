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

/**
 * Обязательный элемент статической разметки: ошибка содержит ID вместо неясного обращения к null.
 * @template {keyof HTMLElementTagNameMap} T
 * @param {string} id
 * @param {T} tag
 * @returns {HTMLElementTagNameMap[T]}
 */
export function byId(id, tag) {
  const element = document.getElementById(id);
  if (!element || element.tagName.toLowerCase() !== tag) throw new Error(`Нет элемента ${tag}#${id}`);
  return /** @type {HTMLElementTagNameMap[T]} */ (element);
}

/** @param {string} selector @param {ParentNode} [root] */
export function all(selector, root = document) {
  return [...root.querySelectorAll(selector)].filter(element => element instanceof HTMLElement);
}
