'use strict';

/**
 * Tiny fetch helpers shared by all live source adapters.
 * Zero-dependency: uses Node 18+ global fetch with an abort timeout.
 * Every adapter sends a descriptive User-Agent and fails soft.
 */

const UA = 'CuespacesSignalRadar/0.2 (+demand-sourcing; public signals only)';

async function fetchWithTimeout(url, { headers = {}, timeoutMs = 9000, method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, ...opts });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
  }
}

async function fetchText(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return res.text();
}

module.exports = { fetchWithTimeout, fetchJson, fetchText, UA };
