'use strict';

/**
 * Real signal source — Reddit public JSON.
 * -----------------------------------------
 * Reddit exposes read-only JSON with no auth (just a descriptive User-Agent).
 * This is the "public social posts" lane: people openly asking where to put
 * something physical. We search CRE/infra subreddits for active site-seeking
 * language, then the shared ICP-fit gate keeps only buyers in motion.
 *
 * Public only — read endpoints, no login, no scraping behind auth.
 */

const { fetchJson } = require('./http');
const { buildLead } = require('./classify');

// Targeted subreddit searches: subreddit + intent query.
const SEARCHES = [
  { sub: 'commercialrealestate', q: 'site OR land OR warehouse OR lease OR tenant OR expansion' },
  { sub: 'CommercialRealEstate', q: 'looking for OR site selection OR development OR industrial' },
  { sub: 'datacenter', q: 'site OR land OR build OR expansion OR location' },
  { sub: 'logistics', q: 'warehouse OR distribution OR site OR facility' },
  { sub: 'RealEstateDevelopment', q: 'commercial OR industrial OR retail OR site OR land' },
];

function searchUrl({ sub, q }, { limit = 25, t = 'week' } = {}) {
  const params = new URLSearchParams({
    q, restrict_sr: '1', sort: 'new', limit: String(limit), t, raw_json: '1',
  });
  return `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?${params}`;
}

/** Map a Reddit listing payload to normalized source items. */
function parseListing(json, sub) {
  const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
  return children.map((c) => {
    const d = c.data || {};
    return {
      source: `reddit/r/${sub}`,
      social: true,
      title: d.title || '',
      summary: (d.selftext || '').slice(0, 280),
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url,
      author: d.author ? `u/${d.author}` : null,
      date: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
      market: null,
    };
  }).filter((i) => i.url && i.title);
}

async function fetchLeads(opts = {}) {
  const leads = [];
  let scanned = 0;
  for (const search of SEARCHES) {
    try {
      const json = await fetchJson(searchUrl(search, opts), { timeoutMs: 8000 });
      const items = parseListing(json, search.sub);
      scanned += items.length;
      for (const item of items) {
        const lead = buildLead(item);
        if (lead) leads.push(lead);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[reddit] r/${search.sub} skipped: ${err.message}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[reddit] scanned ${scanned} posts → ${leads.length} ICP-fit leads`);
  return leads;
}

module.exports = { name: 'reddit', fetchLeads, parseListing, searchUrl, SEARCHES };
