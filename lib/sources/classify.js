'use strict';

/**
 * Shared signal classifier, ICP-fit gate, and lead builder.
 * ----------------------------------------------------------
 * Every live source (news, social posts, RSS, tenders) normalizes its raw
 * items into a common shape and runs them through here. One tested path means
 * consistent type/tier/segment classification and one place to enforce the
 * guardrails:
 *   - commercial & infrastructure only (residential is dropped),
 *   - a lead must carry a real CRE/infra intent signal (no noise / no
 *     "company exists" cards from generic chatter),
 *   - every signal keeps a real URL + date (no hallucinated leads).
 *
 * Social-post leads are keyed on the author (a candidate person) and flagged
 * needsReview so a human confirms ICP fit before any outreach.
 */

const { TYPE_TIER } = require('../signals');

// Type rules — first match wins. Mirrors the highest→context signal tiers.
const TYPE_RULES = [
  { type: 'rfp', re: /\b(rfp|request for proposals?|tender|pre-?qualif\w*|invitation to bid|expression of interest|eoi)\b/i },
  // job_posting is checked before site_search so "hiring a Site Acquisition
  // Manager" is read as a hiring signal, not a site search.
  { type: 'job_posting', re: /\b(hiring|we'?re hiring|now recruiting|job opening|join our team|seeking (a |an )?(head of real estate|site acquisition|development manager|expansion (lead|manager)|real estate manager))\b/i },
  { type: 'site_search', re: /\b(site selection|seeking (a )?site|scouting (for )?location|site search|looking for (a )?(site|space|land|\d[\d,]*\s*(sq\.?\s?(ft|m)|sqft|square (feet|met))|\d+\s*acre)|land acquisition|site acquisition|space requirement)\b/i },
  { type: 'permit', re: /\b(planning permission|zoning (change|application)|building permit|permit application|planning application|rezoning|site plan approval)\b/i },
  { type: 'fund_close', re: /\b(closes? (its |a |the )?[^.]*\bfund\b|fund (final )?close|reaches? (final )?close|first close of)\b/i },
  { type: 'capital_raise', re: /\b(raises?|secures?|closes?|lands?)\s+(\$|usd|€|£|ngn|kes|ghs)?\s?\d[\d.,]*\s?(m|million|bn|billion|k)?\b|series [a-d]\b|funding round\b/i },
  { type: 'expansion', re: /\b(expansion|expand(ing)?|new locations?|breaks? ground|ground-?breaking|to build|plans? to build|new (facility|plant|campus|hub)|enters? (the )?[\w\s]+ market|rolls? out|opening \d+)\b/i },
  { type: 'listing', re: /\b(for (sale|lease)|now leasing|available (now )?[:\-]?\s*(warehouse|industrial|retail|land|office|mixed-use)|new listing|just listed|prime (warehouse|retail|industrial|land))\b/i },
];

// Project-type rules — what Cuespaces scores.
const PROJECT_RULES = [
  { projectType: 'data_center', re: /\bdata ?cent(er|re)s?\b|\bhyperscale\b|\bcloud (region|campus)\b/i },
  { projectType: 'cold_storage', re: /\bcold (storage|chain)\b/i },
  { projectType: 'logistics', re: /\blogistics?( park| hub| cent(er|re))?\b|\bdistribution cent(er|re)\b|\b3pl\b/i },
  { projectType: 'warehouse', re: /\bwarehous(e|ing)\b|\bfulfil?ment cent(er|re)\b/i },
  { projectType: 'manufacturing', re: /\b(manufactur\w*|factory|assembly plant|production (plant|facility)|gigafactory)\b/i },
  { projectType: 'fuel_ev', re: /\b(ev charg\w*|charging (hub|station|network)|fuel (station|hub|retail)|petrol station)\b/i },
  { projectType: 'lpg_energy', re: /\b(lpg|lng|power plant|energy (terminal|plant|hub)|solar (farm|plant)|wind farm|gas terminal|battery (plant|storage))\b/i },
  { projectType: 'retail', re: /\b(retail (rollout|expansion|park)?|shopping (mall|cent(er|re))|store (rollout|opening)|qsr|quick service|restaurant (chain|expansion)|franchise (rollout|expansion)|dark kitchen|cloud kitchen|bank branch)\b/i },
  { projectType: 'fitness', re: /\b(gym|fitness (cent(er|re)|studio|club))\b/i },
  { projectType: 'infrastructure', re: /\b(infrastructure|sea ?port|airport|rail(way)?|highway|toll road|bridge|metro|terminal)\b/i },
  { projectType: 'mixed_use', re: /\bmixed-use\b/i },
];

const RESIDENTIAL_RE = /\b(residential|housing (estate|scheme|project)|apartment(s| complex| block)|condo(minium)?|home ?builder|single-family|multifamily|gated estate|housing units)\b/i;

// CRE/infra context terms — used by the ICP-fit gate for broad social queries.
const CRE_CONTEXT_RE = /\b(commercial real estate|cre\b|industrial|warehouse|logistics|data ?cent|retail|site|land|parcel|facility|facilities|plant|sqft|sq ?ft|square (feet|met)|acre|hectare|lease|tenant|developer|development|infrastructure|project finance|fund|underwrit|build|groundbreak|expansion|tender|rfp|zoning|permit)\b/i;

function classify(text) {
  const t = text || '';
  const typeHit = TYPE_RULES.find((r) => r.re.test(t));
  const type = typeHit ? typeHit.type : 'expansion';
  const projHit = PROJECT_RULES.find((r) => r.re.test(t));
  const projectType = RESIDENTIAL_RE.test(t)
    ? 'residential'
    : (projHit ? projHit.projectType : 'infrastructure');

  let segment = 'developer';
  if (type === 'fund_close' || type === 'capital_raise' || /\b(fund|investor|financ\w+|underwrit\w+|lender|debt desk|family office|private equity|\bpe\b)\b/i.test(t)) {
    segment = 'investor';
  } else if (type === 'listing' || /\b(broker|brokerage|tenant-?rep|listing agent)\b/i.test(t)) {
    segment = 'agent';
  }

  return {
    type,
    tier: TYPE_TIER[type] || 'context',
    projectType,
    segment,
    matchedType: !!typeHit,
    matchedProject: !!projHit,
  };
}

/**
 * ICP-fit gate. True only when an item plausibly reflects an ACTIVE, commercial
 * /infra ground decision — not residential, not generic chatter. Keeps the
 * pipeline to "buyers in motion".
 */
function isICPFit(text) {
  const t = text || '';
  if (!t.trim()) return false;
  if (RESIDENTIAL_RE.test(t)) return false;
  const c = classify(t);
  // A concrete asset type, OR a real intent signal backed by CRE/infra context.
  if (c.matchedProject) return true;
  if (c.matchedType && CRE_CONTEXT_RE.test(t)) return true;
  return false;
}

/** Best-effort organization name from a headline (proper-noun prefix). */
function extractOrg(title) {
  if (!title) return null;
  const m = title.match(/^([A-Z][\w&.'-]+(?:\s+(?:[A-Z][\w&.'-]+|of|and|&)){0,3})/);
  if (!m) return null;
  const candidate = m[1].trim().replace(/\s+(of|and|&)$/i, '');
  if (candidate.length < 3 || /^(The|A|An|This|New|Our|We|I)$/i.test(candidate)) return null;
  return candidate;
}

function hashId(prefix, seed) {
  return `${prefix}-${Buffer.from(String(seed)).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 14)}`;
}

/**
 * Build a normalized, review-flagged lead from a source item, or null if the
 * item isn't ICP-fit / is residential.
 *
 * item: { source, title, summary, url, date(ISO), market?, author?, social? }
 */
function buildLead(item) {
  if (!item || !item.url || !item.title) return null;
  const text = `${item.title} ${item.summary || ''}`;
  if (!isICPFit(text)) return null;

  const cls = classify(text);
  if (cls.projectType === 'residential') return null;

  const org = extractOrg(item.title);
  // For social posts, the author is a candidate person; for news, prefer the org.
  const name = item.social
    ? (item.author ? `${item.author}` : (org || 'Unconfirmed author'))
    : (org || item.author || hostOf(item.url));

  const signal = {
    id: hashId('sig', item.url + (item.title || '')),
    type: cls.type,
    tier: cls.tier,
    title: item.title,
    summary: item.summary || `${hostOf(item.url)}${item.market ? ` · ${item.market}` : ''}`,
    sourceName: item.source || hostOf(item.url),
    sourceUrl: item.url,
    date: item.date || new Date().toISOString(),
    market: item.market || null,
    projectType: cls.projectType,
  };

  return {
    id: hashId(`L-${(item.source || 'src').toUpperCase()}`, item.url),
    name,
    org: item.social ? (org || null) : (org || null),
    role: item.social ? 'Social post author' : null,
    segment: cls.segment,
    market: item.market || null,
    projectType: cls.projectType,
    estProjectScale: null,
    stage: 'new',
    owner: null,
    lastTouch: null,
    sample: false,
    source: item.source || 'live',
    social: !!item.social,
    enriched: false,
    needsReview: true,
    signals: [signal],
  };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; }
}

module.exports = {
  classify,
  isICPFit,
  extractOrg,
  buildLead,
  hashId,
  hostOf,
  TYPE_RULES,
  PROJECT_RULES,
  RESIDENTIAL_RE,
  CRE_CONTEXT_RE,
};
