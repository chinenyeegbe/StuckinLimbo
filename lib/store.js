'use strict';

const fs = require('fs');
const path = require('path');
const { generateSeedLeads } = require('./signals');

/**
 * File-backed JSON store. Single-tenant, small team — a JSON file is plenty and
 * keeps the workspace zero-dependency and trivially portable. Kanban moves,
 * owner assignments, and last-touch dates persist across restarts; the
 * illustrative seed is generated once on first run with relative dates.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'leads.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts-log.json');

const STAGES = [
  'new', 'researching', 'outreach_sent', 'in_conversation', 'demo', 'won', 'parked',
];

// A card is "stale" if it has sat untouched in an active stage too long.
const STALE_DAYS = 7;
const ACTIVE_STAGES = new Set(['researching', 'outreach_sent', 'in_conversation', 'demo']);

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) {
    const leads = mergeDuplicates(generateSeedLeads());
    persist(leads);
    return leads;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(raw.leads) ? raw.leads : [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[store] failed to parse leads.json, regenerating seed:', err.message);
    const leads = mergeDuplicates(generateSeedLeads());
    persist(leads);
    return leads;
  }
}

function persist(leads) {
  ensureDir();
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), leads }, null, 2),
  );
}

/**
 * Aggressive dedup: one human, one card. We key on a normalized name+org and,
 * failing that, name alone. Signals from every duplicate are merged (deduped by
 * a content key) so nothing is lost.
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
      // Keep richest enrichment.
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
  // Newest signal first.
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
  load,
  persist,
  mergeDuplicates,
  dedupSignals,
  dedupKey,
  isStale,
  STAGES,
  ACTIVE_STAGES,
  STALE_DAYS,
  DATA_FILE,
  ALERTS_FILE,
};
