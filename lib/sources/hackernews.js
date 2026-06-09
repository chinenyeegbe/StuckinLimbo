'use strict';

/**
 * Real signal source — Hacker News via the Algolia Search API.
 * ------------------------------------------------------------
 * Public, no-auth (https://hn.algolia.com/api). Surfaces company expansion,
 * data-center / manufacturing buildout, and infra-finance stories and posts.
 * Author is captured as a candidate contact for review.
 */

const { fetchJson } = require('./http');
const { buildLead } = require('./classify');

const QUERIES = [
  'data center', 'gigafactory', 'manufacturing plant', 'logistics warehouse',
  'site selection', 'breaks ground', 'new factory', 'infrastructure fund',
  'fulfillment center', 'cold storage', 'distribution center', 'industrial park',
  'EV charging', 'battery plant', 'solar farm', 'power plant', 'expansion',
  'opens new', 'building a', 'new campus', 'capacity expansion',
];

function searchUrl(query, { sinceDays = 7, hitsPerPage = 40 } = {}) {
  const sinceTs = Math.floor((Date.now() - sinceDays * 86400000) / 1000);
  const params = new URLSearchParams({
    query,
    tags: 'story',
    hitsPerPage: String(hitsPerPage),
    numericFilters: `created_at_i>${sinceTs}`,
  });
  return `https://hn.algolia.com/api/v1/search_by_date?${params}`;
}

function parseHits(json, query) {
  const hits = json && Array.isArray(json.hits) ? json.hits : [];
  return hits.map((h) => ({
    source: 'hackernews',
    social: true,
    title: h.title || h.story_title || '',
    summary: (h.story_text || h._highlightResult?.title?.value || '').replace(/<[^>]+>/g, '').slice(0, 280),
    url: h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : null),
    author: h.author ? `@${h.author}` : null,
    date: h.created_at || new Date().toISOString(),
    market: null,
    _query: query,
  })).filter((i) => i.url && i.title);
}

async function fetchLeads(opts = {}) {
  const leads = [];
  let scanned = 0;
  for (const q of QUERIES) {
    try {
      const json = await fetchJson(searchUrl(q, opts), { timeoutMs: 8000 });
      const items = parseHits(json, q);
      scanned += items.length;
      for (const item of items) {
        const lead = buildLead(item);
        if (lead) leads.push(lead);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[hackernews] "${q}" skipped: ${err.message}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[hackernews] scanned ${scanned} stories → ${leads.length} ICP-fit leads`);
  return leads;
}

module.exports = { name: 'hackernews', fetchLeads, parseHits, searchUrl, QUERIES };
