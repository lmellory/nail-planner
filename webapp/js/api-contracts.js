import { api } from './api.js';

/**
 * @template {keyof import('./contracts').GetResponses} K
 * @param {K} path
 * @returns {Promise<import('./contracts').GetResponses[K]>}
 */
export function getApi(path) {
  return api(path);
}

/**
 * @template {keyof import('./contracts').PutRequests} K
 * @param {K} path
 * @param {import('./contracts').PutRequests[K]} body
 * @returns {Promise<import('./contracts').PutResponses[K]>}
 */
export function putApi(path, body) {
  return api(path, { method: 'PUT', body: JSON.stringify(body) });
}
