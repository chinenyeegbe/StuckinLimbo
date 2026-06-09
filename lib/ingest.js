'use strict';

/**
 * Ingestion orchestrator.
 * -----------------------
 * Pulls fresh leads from every registered real source, merges them into the
 * store (dedup by human/org, signals merged), and persists. Source failures are
 * isolated — one unreachable feed never sinks the run, and the existing
 * pipeline is always preserved.
 */

const store = require('./store');
const gdelt = require('./sources/gdelt');

// Registered live sources. Add new adapters (each exposing async fetchLeads)
// here as they are built.
const LIVE_SOURCES = [gdelt];

async function runIngestion(opts = {}) {
  const before = store.load();
  const fetched = [];
  const report = [];

  for (const src of LIVE_SOURCES) {
    try {
      const leads = await src.fetchLeads(opts);
      fetched.push(...leads);
      report.push({ source: src.name, leads: leads.length, ok: true });
    } catch (err) {
      report.push({ source: src.name, leads: 0, ok: false, error: err.message });
    }
  }

  // Merge: existing first so manual edits (stage/owner) survive; new signals
  // for an existing human/org fold into that card.
  const merged = store.mergeDuplicates([...before, ...fetched]);
  store.persist(merged);

  return {
    sources: report,
    fetched: fetched.length,
    before: before.length,
    after: merged.length,
    added: merged.length - before.length,
  };
}

module.exports = { runIngestion, LIVE_SOURCES };
