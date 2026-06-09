'use strict';

/**
 * Real signal source — GDELT DOC 2.0 API.
 * ----------------------------------------
 * Free, no-auth, worldwide news index — the "company press/news" lane, with
 * strong emerging-market coverage. We query for language signalling an active,
 * undecided CRE/infra ground decision and route articles through the shared
 * classifier / ICP-fit gate / lead builder.
 *
 *   Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
 *
 * GDELT must be reachable from the host's egress allowlist. If blocked,
 * fetchLeads logs and returns [] — no source breaks the app.
 */

const { fetchText } = require('./http');
const { buildLead } = require('./classify');

const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

const QUERY_PHRASES = [
  '"site selection"', '"seeking site"', '"scouting locations"', '"new warehouse"',
  '"distribution center"', '"logistics park"', '"data center"', '"cold storage"',
  '"manufacturing plant"', '"breaks ground"', '"groundbreaking"', '"to build"',
  '"new facility"', '"land acquisition"', '"site acquisition"', '"expansion plan"',
  '"new locations"', '"infrastructure fund"', '"project finance"',
  // Broadened lanes for higher volume of in-motion buyers.
  '"new factory"', '"gigafactory"', '"fulfillment center"', '"industrial park"',
  '"EV charging"', '"charging hub"', '"power plant"', '"solar farm"', '"gas terminal"',
  '"LNG terminal"', '"LPG terminal"', '"retail rollout"', '"store openings"',
  '"flagship store"', '"opens new"', '"to open"', '"plans to open"', '"to expand"',
  '"multi-million"', '"capacity expansion"', '"greenfield"', '"build-out"',
  '"new plant"', '"new campus"', '"new hub"', '"to invest"', '"invest in"',
  '"request for proposals"', '"tender"', '"pre-qualification"', '"zoning"',
  '"planning permission"', '"building permit"', '"now leasing"', '"for lease"',
];

// Emerging-market bias: GDELT lets us bound queries to a country list so the
// volume we pull skews to Cuespaces' bullseye markets.
const MARKET_COUNTRIES = [
  'NG', 'KE', 'GH', 'EG', 'ZA', 'RW', 'ET', 'TZ', 'UG', 'SN', 'MA', 'CI',
  'ZM', 'MZ', 'IN', 'ID', 'VN', 'PH', 'BD', 'PK', 'BR', 'CO', 'MX',
];

function buildQuery(phrases = QUERY_PHRASES) {
  return `(${phrases.join(' OR ')})`;
}

function buildUrl({ phrases, timespan = '3d', maxrecords = 250 } = {}) {
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

/** Map a GDELT article to a normalized source item for the shared builder. */
function articleToItem(a) {
  return {
    source: 'gdelt',
    social: false,
    title: a.title || '',
    summary: `${a.domain || 'news'}${a.sourcecountry ? ` · ${a.sourcecountry}` : ''}`,
    url: a.url,
    author: null,
    date: parseSeendate(a.seendate),
    market: a.sourcecountry || null,
  };
}

function articlesToLeads(articles) {
  const leads = [];
  for (const a of articles || []) {
    const lead = buildLead(articleToItem(a));
    if (lead) leads.push(lead);
  }
  return leads;
}

async function fetchArticles(opts = {}) {
  const text = await fetchText(buildUrl(opts), { timeoutMs: opts.timeoutMs || 12000 });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GDELT returned non-JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
  }
  return Array.isArray(json.articles) ? json.articles : [];
}

async function fetchLeads(opts = {}) {
  try {
    const articles = await fetchArticles(opts);
    const leads = articlesToLeads(articles);
    // eslint-disable-next-line no-console
    console.log(`[gdelt] ${articles.length} articles → ${leads.length} ICP-fit leads`);
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
  articleToItem,
  parseSeendate,
  buildQuery,
  buildUrl,
  QUERY_PHRASES,
  MARKET_COUNTRIES,
};
