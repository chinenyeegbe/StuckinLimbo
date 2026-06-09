'use strict';

/**
 * Pluggable key/value persistence.
 * --------------------------------
 * One small JSON-per-key interface with two backends so the exact same domain
 * code runs locally and on Netlify:
 *
 *   - file  (default): writes data/<key>.json — used by `node server.js`.
 *   - blobs (Netlify) : Netlify Blobs — durable, zero-config, set via
 *                       STORE_BACKEND=blobs in netlify.toml.
 *
 * Selected by STORE_BACKEND env (or auto-detected on Netlify). All access is
 * async so the serverless path is identical to local.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function backendName() {
  if (process.env.STORE_BACKEND) return process.env.STORE_BACKEND;
  // Netlify sets NETLIFY=true in build/functions runtime.
  if (process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS_CONTEXT) return 'blobs';
  return 'file';
}

// ---- file backend ---------------------------------------------------------

function filePath(key) {
  return path.join(DATA_DIR, `${key}.json`);
}

const fileBackend = {
  async get(key) {
    try {
      return JSON.parse(fs.readFileSync(filePath(key), 'utf8'));
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath(key), JSON.stringify(value, null, 2));
  },
};

// ---- Netlify Blobs backend ------------------------------------------------

let _store = null;
function blobStore() {
  if (_store) return _store;
  // Required lazily so local runs don't need the dependency installed.
  // eslint-disable-next-line global-require, import/no-unresolved
  const { getStore } = require('@netlify/blobs');
  _store = getStore({ name: 'signal-radar', consistency: 'strong' });
  return _store;
}

const blobBackend = {
  async get(key) {
    try {
      return await blobStore().get(key, { type: 'json' });
    } catch {
      return null;
    }
  },
  async set(key, value) {
    await blobStore().setJSON(key, value);
  },
};

// ---------------------------------------------------------------------------

function backend() {
  return backendName() === 'blobs' ? blobBackend : fileBackend;
}

async function get(key) {
  return backend().get(key);
}

async function set(key, value) {
  return backend().set(key, value);
}

module.exports = { get, set, backendName };
