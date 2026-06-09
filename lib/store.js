'use strict';

const kv = require('./kv');
const { generateSeedLeads } = require('./signals');

/**
 * Lead store. Persistence is delegated to the pluggable KV layer (filesystem
 * locally, Netlify Blobs in production) so the same code runs in both places.
 *
 * The pure helpers below (dedup/merge/staleness) are synchronous and have no
 * I/O — they're unit-tested directly.
 */

const LEADS_KEY = 'leads';

const STAGES = [
  'new', 'researching', 'outreach_sent', 'in_conversation', 'demo', 'won', 'parked',
];

const STALE_DAYS = 7;
const ACTIVE_STAGES = new Set(['researching', 'outreach_sent', 'in_conversation', 'demo']);

// ---- async persistence ----------------------------------------------------

async function loadLeads() {
  const stored = await kv.get(LEADS_KEY);
  if (stored && Array.isArray(stored.leads)) return stored.leads;
  // First run: generate the illustrative seed and persist it.
  const leads = mergeDuplicates(generateSeedLeads());
  await saveLeads(leads);
  return leads;
}

async function saveLeads(leads) {
  await kv.set(LEADS_KEY, { updatedAt: new Date().toISOString(), leads });
  return leads;
}

// ---- pure helpers ---------------------------------------------------------

/**
 * Aggressive dedup: one human, one card. Key on normalized name+org (or name
 * alone). Signals from every duplicate are merged and deduped.
 */
function mergeDuplicates(leads) {
  const byKey = new Map();
  for (const lead of leads) {
    const key = dedupKey(lead);
    if (!byKey.has(key)) {
      byKey.set(key, { ...lead, signals: dedupSignals(lead.signals || []) });
    } else {
      const existing = byKey.get(key);
      existing.signals = dedupSignals([...(existing.signals || []), ...(lead.signals || [])]);
      existing.estProjectScale = existing.estProjectScale || lead.estProjectScale;
      existing.market = existing.market || lead.market;
      existing.projectType = existing.projectType || lead.projectType;
      existing.secondarySegment = existing.secondarySegment || lead.secondarySegment;
    }
  }
  return Array.from(byKey.values());
}

function dedupKey(lead) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(lead.name);
  const o = norm(lead.org);
  return o ? `${n}@@${o}` : n;
}

function dedupSignals(signals) {
  const seen = new Set();
  const out = [];
  for (const s of signals) {
    const k = `${s.type}::${(s.title || '').toLowerCase().trim()}::${(s.date || '').slice(0, 10)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return out;
}

function isStale(lead, now = Date.now()) {
  if (!ACTIVE_STAGES.has(lead.stage)) return false;
  if (!lead.lastTouch) return true;
  const days = (now - Date.parse(lead.lastTouch)) / (1000 * 60 * 60 * 24);
  return days > STALE_DAYS;
}

module.exports = {
  loadLeads,
  saveLeads,
  mergeDuplicates,
  dedupSignals,
  dedupKey,
  isStale,
  STAGES,
  ACTIVE_STAGES,
  STALE_DAYS,
  LEADS_KEY,
};
