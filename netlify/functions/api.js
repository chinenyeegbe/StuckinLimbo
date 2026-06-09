'use strict';

/**
 * Netlify Function entrypoint for the Signal Radar API.
 * Delegates to the shared transport-agnostic core (lib/core.js) — identical
 * logic to the local server. Persistence is Netlify Blobs (STORE_BACKEND=blobs,
 * set in netlify.toml). The /api/* path is rewritten here via a redirect.
 */

const { handleRequest } = require('../../lib/core');

const FN_BASE = '/.netlify/functions/api';

exports.handler = async (event) => {
  try {
    // Reconstruct the original /api/... path from the rewritten function path.
    let apiPath = event.path || '';
    if (apiPath.startsWith(FN_BASE)) apiPath = '/api' + apiPath.slice(FN_BASE.length);
    if (!apiPath.startsWith('/api')) apiPath = '/api' + apiPath;

    let body = {};
    if (event.body) {
      try { body = JSON.parse(event.body); } catch { body = {}; }
    }

    const host = event.headers && (event.headers.host || event.headers.Host);
    const baseUrl = host ? `https://${host}` : '';

    const { status, json } = await handleRequest({
      method: event.httpMethod,
      path: apiPath,
      query: event.queryStringParameters || {},
      body,
      baseUrl,
    });

    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(json),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'internal error', detail: e.message }),
    };
  }
};
