'use strict';

/**
 * Cuespaces Signal Radar — Ranking Model
 * ---------------------------------------
 * Every lead scores 0–100, recomputed on demand (the digest recomputes daily).
 * The score is never a black box: each component returns its own contribution
 * and a human-readable reason so the UI can always surface the "why".
 *
 *   Relevance (0–40): segment fit + project type Cuespaces scores + market fit
 *   Freshness (0–30): decays over time; full today, halves weekly
 *   Intent    (0–30): decision-stage of the hottest live signal
 */

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

// Project types Cuespaces actually scores (commercial + infrastructure).
// Residential is explicitly out of scope and disqualifies a lead.
const COMMERCIAL_PROJECT_TYPES = new Set([
  'qsr', 'retail', 'fitness', 'banking', 'dark_kitchen', 'fuel_ev', 'logistics',
  'data_center', 'manufacturing', 'lpg_energy', 'warehouse', 'industrial',
  'mixed_use', 'office', 'infrastructure', 'cold_storage', 'distribution',
]);

const RESIDENTIAL_PROJECT_TYPES = new Set([
  'residential', 'housing', 'apartments', 'condo', 'single_family', 'multifamily',
]);

// Emerging / high-stakes markets are the bullseye for Cuespaces' first-pass truth.
// (Lowercased substrings matched against the lead's market string.)
const EMERGING_MARKETS = [
  'nigeria', 'lagos', 'abuja', 'kenya', 'nairobi', 'ghana', 'accra', 'egypt',
  'cairo', 'south africa', 'johannesburg', 'rwanda', 'kigali', 'ethiopia',
  'tanzania', 'uganda', 'senegal', 'morocco', 'india', 'indonesia', 'vietnam',
  'philippines', 'bangladesh', 'pakistan', 'brazil', 'colombia', 'mexico',
  'kenya', 'côte d\'ivoire', 'cote d\'ivoire', 'abidjan', 'zambia', 'mozambique',
];

const VALID_SEGMENTS = new Set(['developer', 'agent', 'investor']);

// Intent weights by signal tier (decision-stage proximity to an undecided choice).
const TIER_INTENT = { highest: 30, strong: 18, context: 8 };

// A finer-grained nudge within a tier, by signal type. Pure site-search and live
// RFPs sit closest to an undecided ground choice.
const TYPE_INTENT_BONUS = {
  site_search: 0,      // already top of the highest tier
  rfp: 0,
  permit: -2,          // filed, but ground may be chosen
  job_posting: -3,     // buying soon, not today
  listing: -1,
  fund_close: -2,
  expansion: 0,
  capital_raise: -2,
  conference: -4,
  incorporation: 0,
  leadership: -1,
};

const DEFAULT_NOW = () => Date.now();

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

function scoreRelevance(lead) {
  const reasons = [];
  let points = 0;

  // Hard scope guard: residential is never scored.
  const projectType = (lead.projectType || '').toLowerCase();
  if (RESIDENTIAL_PROJECT_TYPES.has(projectType)) {
    return {
      points: 0,
      max: 40,
      disqualified: true,
      reasons: ['Residential project — out of scope (commercial & infrastructure only).'],
    };
  }

  // Segment fit (0–14): is this one of the three segments we hunt?
  if (VALID_SEGMENTS.has(lead.segment)) {
    points += 14;
    reasons.push(`Segment fit: ${lead.segment}`);
  } else {
    reasons.push('No recognized segment — weak fit.');
  }

  // Project-type fit (0–16): commercial/infra that Cuespaces scores.
  if (COMMERCIAL_PROJECT_TYPES.has(projectType)) {
    points += 16;
    reasons.push(`Project type Cuespaces scores: ${labelize(projectType)}`);
  } else if (projectType) {
    points += 6;
    reasons.push(`Project type "${labelize(projectType)}" — partial fit.`);
  }

  // Market fit (0–10): emerging / high-stakes ground is the bullseye.
  const market = (lead.market || '').toLowerCase();
  if (EMERGING_MARKETS.some((m) => market.includes(m))) {
    points += 10;
    reasons.push(`Bullseye market: ${lead.market}`);
  } else if (market) {
    points += 4;
    reasons.push(`Market: ${lead.market}`);
  }

  return { points: Math.min(points, 40), max: 40, disqualified: false, reasons };
}

function daysBetween(thenMs, nowMs) {
  return Math.max(0, (nowMs - thenMs) / (1000 * 60 * 60 * 24));
}

/**
 * Freshness decays from the MOST RECENT signal. Full (30) today, halves weekly:
 *   freshness = 30 * 0.5 ^ (days / 7)
 */
function scoreFreshness(signals, now = DEFAULT_NOW()) {
  if (!signals || signals.length === 0) {
    return { points: 0, max: 30, reasons: ['No signals on file.'], freshestDays: null };
  }
  const freshestMs = Math.max(...signals.map((s) => Date.parse(s.date)));
  const days = daysBetween(freshestMs, now);
  const points = 30 * Math.pow(0.5, days / 7);
  const rounded = Math.round(points * 10) / 10;
  return {
    points: rounded,
    max: 30,
    freshestDays: Math.round(days),
    reasons: [
      days < 1
        ? 'Freshest signal: today.'
        : `Freshest signal: ${Math.round(days)} day(s) ago (decays weekly).`,
    ],
  };
}

/**
 * Intent maps to the signal tiers. We take the hottest single signal — a lead
 * is only as undecided as its closest-to-decision live signal.
 */
function scoreIntent(signals) {
  if (!signals || signals.length === 0) {
    return { points: 0, max: 30, reasons: ['No signals on file.'], topSignal: null };
  }
  let best = null;
  let bestPoints = -1;
  for (const s of signals) {
    const tierPts = TIER_INTENT[s.tier] ?? 0;
    const bonus = TYPE_INTENT_BONUS[s.type] ?? 0;
    const pts = Math.max(0, tierPts + bonus);
    if (pts > bestPoints) {
      bestPoints = pts;
      best = s;
    }
  }
  return {
    points: Math.min(bestPoints, 30),
    max: 30,
    topSignal: best,
    reasons: [`Hottest signal: ${labelize(best.type)} (${best.tier} intent).`],
  };
}

// ---------------------------------------------------------------------------
// Top-level scorer
// ---------------------------------------------------------------------------

/**
 * Score a lead. Returns total (0–100), a per-component breakdown, the hottest
 * signal, and a one-line "why now". A residential lead is hard-zeroed.
 */
function scoreLead(lead, now = DEFAULT_NOW()) {
  const signals = (lead.signals || []).slice();
  const relevance = scoreRelevance(lead);

  if (relevance.disqualified) {
    return {
      score: 0,
      disqualified: true,
      breakdown: { relevance, freshness: { points: 0, max: 30, reasons: [] }, intent: { points: 0, max: 30, reasons: [] } },
      topSignal: null,
      whyNow: 'Disqualified: residential is out of scope.',
    };
  }

  const freshness = scoreFreshness(signals, now);
  const intent = scoreIntent(signals);

  const score = Math.round(relevance.points + freshness.points + intent.points);
  const topSignal = intent.topSignal;
  const whyNow = buildWhyNow(lead, topSignal, freshness, now);

  return {
    score: Math.max(0, Math.min(100, score)),
    disqualified: false,
    breakdown: { relevance, freshness, intent },
    topSignal,
    whyNow,
  };
}

/**
 * The "why now" sentence: the exact signal, its date, and a one-line reason.
 */
function buildWhyNow(lead, signal, freshness, now = DEFAULT_NOW()) {
  if (!signal) return 'No live signal — build the file, do not outreach yet.';
  const when = relativeTime(Date.parse(signal.date), now);
  const market = lead.market ? ` in ${lead.market}` : '';
  switch (signal.type) {
    case 'site_search':
      return `Actively scouting${market} — "${signal.title}" (${when}). Pre-conviction window is open.`;
    case 'rfp':
      return `Live RFP/tender out${market} — "${signal.title}" (${when}). Ground choice is imminent.`;
    case 'permit':
      return `New permit/zoning filing${market} — "${signal.title}" (${when}). Building something physical.`;
    case 'job_posting':
      return `Hiring site/expansion talent — "${signal.title}" (${when}). Buying ground soon.`;
    case 'listing':
      return `Fresh commercial listing live — "${signal.title}" (${when}). Needs ground qualified fast.`;
    case 'fund_close':
      return `Fund close tied to buildout — "${signal.title}" (${when}). Capital is committed.`;
    case 'expansion':
      return `Expansion announced${market} — "${signal.title}" (${when}). Sites to be chosen.`;
    case 'capital_raise':
      return `Raise for land/facilities — "${signal.title}" (${when}). Use of proceeds is physical.`;
    case 'conference':
      return `Speaking on site/infra topics — "${signal.title}" (${when}). In-market mindset.`;
    default:
      return `"${signal.title}" (${when}).`;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function labelize(s) {
  if (!s) return '';
  return String(s)
    .split('_')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function relativeTime(thenMs, nowMs = DEFAULT_NOW()) {
  if (!thenMs || Number.isNaN(thenMs)) return 'unknown date';
  const days = Math.round(daysBetween(thenMs, nowMs));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

module.exports = {
  scoreLead,
  scoreRelevance,
  scoreFreshness,
  scoreIntent,
  buildWhyNow,
  labelize,
  relativeTime,
  COMMERCIAL_PROJECT_TYPES,
  RESIDENTIAL_PROJECT_TYPES,
  EMERGING_MARKETS,
  TIER_INTENT,
};
