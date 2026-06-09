'use strict';

/**
 * Ingestion orchestrator.
 * -----------------------
 * Pulls fresh, ICP-fit leads from every registered public source IN PARALLEL,
 * merges them into the store (dedup by human/org, signals merged), and
 * persists. Source failures are isolated — one unreachable feed never sinks the
 * run, and existing pipeline edits (stage/owner) are preserved.
 */

const store = require('./store');

// Registered live sources. Each exposes async fetchLeads(opts) -> Lead[].
// All are public, no-auth, and respect the "public signals only" guardrail.
const LIVE_SOURCES = [
  require('./sources/gdelt'),       // worldwide news (company press)
  require('./sources/reddit'),      // public social posts (ICP-fit detection)
  require('./sources/hackernews'),  // tech/infra/expansion stories & posts
  require('./sources/rss'),         // configurable public feeds (tenders, listings, press)
];

async function runIngestion(opts = {}) {
  const before = await store.loadLeads();

  const results = await Promise.allSettled(
    LIVE_SOURCES.map((src) => src.fetchLeads(opts)),
  );

  const fetched = [];
  const report = results.map((r, i) => {
    const name = LIVE_SOURCES[i].name;
    if (r.status === 'fulfilled') {
      fetched.push(...r.value);
      return { source: name, leads: r.value.length, ok: true };
    }
    return { source: name, leads: 0, ok: false, error: r.reason && r.reason.message };
  });

  // Merge: existing first so manual edits survive; new signals for an existing
  // human/org fold into that card.
  const merged = store.mergeDuplicates([...before, ...fetched]);
  try {
    await store.saveLeads(merged);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ingest] persist failed:', err.message);
  }

  return {
    sources: report,
    fetched: fetched.length,
    before: before.length,
    after: merged.length,
    added: merged.length - before.length,
  };
}

module.exports = { runIngestion, LIVE_SOURCES };
