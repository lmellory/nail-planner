import { api } from './api.js';

/**
 * @template {import('./contracts').GetPath} K
 * @param {K} path
 * @param {Omit<RequestInit, 'headers'> & {headers?: Record<string, string>}} [options]
 * @returns {Promise<import('./contracts').GetResponse<K>>}
 */
export function getApi(path, options) {
  return api(path, options);
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
