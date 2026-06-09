'use strict';

/**
 * Real signal source — GDELT DOC 2.0 API.
 * ----------------------------------------
 * GDELT indexes worldwide news in near-real-time. It is FREE, requires NO API
 * key, and is PUBLICLY ACCESSIBLE — a clean fit for the spec's "company
 * press/news" lane, with strong coverage of emerging markets.
 *
 *   Docs:  https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *   Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
 *
 * We query for language that signals an active, undecided CRE/infrastructure
 * ground decision, map each article into a dated, source-linked Signal, and
 * fold those into organization-level leads. Because a news article rarely names
 * the actual decision-maker, every lead is flagged `needsReview: true` and
 * `enriched: false` — a human confirms the contact before any outreach. The
 * signal itself always carries a real URL + date, satisfying the
 * "no hallucinated leads" guardrail.
 *
 * NOTE: GDELT must be reachable from the environment's egress allowlist. If it
 * is blocked, `fetchLeads` logs and returns [] — the workspace keeps running on
 * whatever is already in the store. No source is allowed to break the app.
 */

const { TYPE_TIER } = require('../signals');

const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

// ---------------------------------------------------------------------------
// Query — phrases that sit close to an active ground decision.
// ---------------------------------------------------------------------------

// GDELT query language: space = AND, so we OR a curated phrase set in parens.
const QUERY_PHRASES = [
  '"site selection"', '"seeking site"', '"scouting locations"', '"new warehouse"',
  '"distribution center"', '"logistics park"', '"data center"', '"cold storage"',
  '"manufacturing plant"', '"breaks ground"', '"groundbreaking"', '"to build"',
  '"new facility"', '"land acquisition"', '"site acquisition"', '"expansion plan"',
  '"new locations"', '"infrastructure fund"', '"project finance"',
];

function buildQuery(phrases = QUERY_PHRASES) {
  return `(${phrases.join(' OR ')})`;
}

function buildUrl({ phrases, timespan = '3d', maxrecords = 75 } = {}) {
  // Encode with %20 (not '+') so quoted phrases survive GDELT's parser.
  const params = [
    ['query', buildQuery(phrases)],
    ['mode', 'ArtList'],
    ['format', 'json'],
    ['sort', 'datedesc'],
    ['maxrecords', String(maxrecords)],
    ['timespan', timespan],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${ENDPOINT}?${params}`;
}

// ---------------------------------------------------------------------------
// Classification — heuristics mapping an article to signal type / project /
// segment. First match wins; everything is keyword-driven and auditable.
// ---------------------------------------------------------------------------

const TYPE_RULES = [
  { type: 'rfp', re: /\b(rfp|request for proposal|tender|pre-?qualif|invitation to bid)\b/i },
  { type: 'site_search', re: /\b(site selection|seeking site|scouting location|site search|looking for .* (acre|sqft|sq ft|square (feet|metre|meter))|land acquisition|site acquisition)\b/i },
  { type: 'permit', re: /\b(planning permission|zoning|building permit|permit application|planning application)\b/i },
  { type: 'job_posting', re: /\b(hiring|job opening|now recruiting|seeks? (a )?(head of real estate|site acquisition|expansion))\b/i },
  { type: 'fund_close', re: /\b(closes?( a)? .*fund|fund close|final close|reaches? .* close)\b/i },
  { type: 'capital_raise', re: /\b(raises?|secures?|closes?) (\$|usd|€|£)?\s?\d/i },
  { type: 'expansion', re: /\b(expansion|expand|new locations?|breaks ground|groundbreaking|to build|new facility|new plant|enters? the .* market)\b/i },
  { type: 'listing', re: /\b(for (sale|lease)|now leasing|available .* (warehouse|industrial|retail|land)|new listing)\b/i },
];

const PROJECT_RULES = [
  { projectType: 'data_center', re: /\bdata ?cent(er|re)|hyperscale\b/i },
  { projectType: 'cold_storage', re: /\bcold (storage|chain)\b/i },
  { projectType: 'logistics', re: /\blogistics?( park)?|distribution cent(er|re)\b/i },
  { projectType: 'warehouse', re: /\bwarehouse|fulfil?ment cent(er|re)\b/i },
  { projectType: 'manufacturing', re: /\b(manufactur|factory|plant|assembly)\b/i },
  { projectType: 'fuel_ev', re: /\b(ev charg|fuel (station|hub)|charging hub)\b/i },
  { projectType: 'lpg_energy', re: /\b(lpg|lng|power plant|energy (terminal|plant)|solar farm|wind farm)\b/i },
  { projectType: 'retail', re: /\b(retail|shopping|mall|store rollout|qsr|restaurant)\b/i },
  { projectType: 'data_center', re: /\bcloud (region|campus)\b/i },
  { projectType: 'infrastructure', re: /\b(infrastructure|port|airport|rail|highway|toll road)\b/i },
];

const RESIDENTIAL_RE = /\b(residential|housing estate|apartment|condo|home ?builder|single-family|multifamily)\b/i;

function classify(title) {
  const t = title || '';
  const typeHit = TYPE_RULES.find((r) => r.re.test(t));
  const type = typeHit ? typeHit.type : 'expansion';
  const projHit = PROJECT_RULES.find((r) => r.re.test(t));
  const projectType = RESIDENTIAL_RE.test(t)
    ? 'residential'                       // let the scoring guard disqualify it
    : (projHit ? projHit.projectType : 'infrastructure');

  // Segment: financiers if money/fund language; agents if listing; else developer.
  let segment = 'developer';
  if (type === 'fund_close' || type === 'capital_raise' || /\b(fund|investor|financ|underwrit)\b/i.test(t)) {
    segment = 'investor';
  } else if (type === 'listing') {
    segment = 'agent';
  }

  return { type, tier: TYPE_TIER[type] || 'context', projectType, segment };
}

/** Best-effort organization name from a headline (proper-noun prefix). */
function extractOrg(title) {
  if (!title) return null;
  const m = title.match(/^([A-Z][\w&.'-]+(?:\s+(?:[A-Z][\w&.'-]+|of|and|&)){0,3})/);
  if (!m) return null;
  const candidate = m[1].trim().replace(/\s+(of|and|&)$/i, '');
  // Reject pure stopword/short fragments.
  if (candidate.length < 3 || /^(The|A|An|This|New)$/i.test(candidate)) return null;
  return candidate;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// GDELT seendate: "YYYYMMDDTHHMMSSZ"
function parseSeendate(s) {
  if (!s) return new Date().toISOString();
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) {
    const d = Date.parse(s);
    return Number.isNaN(d) ? new Date().toISOString() : new Date(d).toISOString();
  }
  const [, y, mo, da, h, mi, se] = m;
  return new Date(Date.UTC(+y, +mo - 1, +da, +h, +mi, +se)).toISOString();
}

function articleToSignal(a) {
  const cls = classify(a.title);
  return {
    id: `gdelt-${Buffer.from(a.url || a.title || Math.random().toString()).toString('base64').slice(0, 16)}`,
    type: cls.type,
    tier: cls.tier,
    title: a.title,
    summary: `${a.domain || 'news'}${a.sourcecountry ? ` · ${a.sourcecountry}` : ''}`,
    sourceName: a.domain || 'news',
    sourceUrl: a.url,
    date: parseSeendate(a.seendate),
    market: a.sourcecountry || null,
    projectType: cls.projectType,
    _segment: cls.segment, // internal hint for lead building
  };
}

/**
 * Fold articles into organization-level leads. Articles about the same org are
 * merged (case-insensitive). Leads with no extractable org are still kept,
 * keyed by domain, so nothing real is silently dropped.
 */
function articlesToLeads(articles) {
  const byKey = new Map();
  for (const a of articles) {
    if (!a || !a.url || !a.title) continue;
    const signal = articleToSignal(a);
    const org = extractOrg(a.title);
    const key = (org || a.domain || a.url).toLowerCase();

    if (!byKey.has(key)) {
      byKey.set(key, {
        id: `GDELT-${Buffer.from(key).toString('base64').slice(0, 12)}`,
        name: org || a.domain || 'Unconfirmed org',
        org: org || null,
        role: null,
        segment: signal._segment,
        market: signal.market,
        projectType: signal.projectType,
        estProjectScale: null,
        stage: 'new',
        owner: null,
        lastTouch: null,
        sample: false,
        source: 'gdelt',
        enriched: false,
        needsReview: true, // human confirms the actual contact before outreach
        signals: [],
      });
    }
    const lead = byKey.get(key);
    delete signal._segment;
    lead.signals.push(signal);
    // Prefer a concrete project type / market over null.
    lead.projectType = lead.projectType || signal.projectType;
    lead.market = lead.market || signal.market;
  }
  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Live fetch (graceful — never throws to the orchestrator)
// ---------------------------------------------------------------------------

async function fetchArticles(opts = {}) {
  const url = buildUrl(opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CuespacesSignalRadar/0.1 (+demand-sourcing)' },
    });
    if (!res.ok) {
      throw new Error(`GDELT responded ${res.status}`);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // GDELT occasionally returns an HTML/text error page (e.g. throttling).
      throw new Error(`GDELT returned non-JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
    }
    return Array.isArray(json.articles) ? json.articles : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLeads(opts = {}) {
  try {
    const articles = await fetchArticles(opts);
    const leads = articlesToLeads(articles);
    // eslint-disable-next-line no-console
    console.log(`[gdelt] ${articles.length} articles → ${leads.length} leads`);
    return leads;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[gdelt] fetch skipped: ${err.message}`);
    return [];
  }
}

module.exports = {
  name: 'gdelt',
  fetchLeads,
  fetchArticles,
  articlesToLeads,
  articleToSignal,
  classify,
  extractOrg,
  parseSeendate,
  buildQuery,
  buildUrl,
  QUERY_PHRASES,
};
