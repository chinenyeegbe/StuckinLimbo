'use strict';

/**
 * Real signal source — generic RSS / Atom adapter.
 * ------------------------------------------------
 * Many public signal sources publish feeds: government tender & planning
 * portals, CRE listing pages, fund/press newsrooms, industry event sites.
 * This adapter pulls any PUBLIC feed (no auth), parses it with a tiny
 * zero-dependency parser, and runs items through the shared ICP-fit gate.
 *
 * Configure feeds without code changes via the RSS_FEEDS env var
 * (comma-separated URLs). The defaults below are a starting set — swap in the
 * tender/planning/listing feeds for your target markets. Each feed fails soft.
 */

const { fetchText } = require('./http');
const { buildLead } = require('./classify');

// Editable default feeds. Override entirely with RSS_FEEDS="url1,url2,...".
const DEFAULT_FEEDS = [
  // Construction / infrastructure / CRE trade press (public newsroom feeds).
  'https://www.bisnow.com/rss',
  'https://www.constructiondive.com/feeds/news/',
  'https://www.datacenterdynamics.com/en/rss/',
  'https://www.supplychaindive.com/feeds/news/',
  'https://www.retaildive.com/feeds/news/',
  'https://www.utilitydive.com/feeds/news/',
  'https://www.theloadstar.com/feed/',
  'https://www.globalconstructionreview.com/feed/',
  'https://constructionreviewonline.com/feed/',
  'https://www.esi-africa.com/feed/',
  'https://furtherafrica.com/feed/',
  'https://www.devdiscourse.com/rss/business.xml',
  'https://news.google.com/rss/search?q=%22site+selection%22+OR+%22breaks+ground%22+OR+%22new+warehouse%22+OR+%22data+center%22+OR+%22distribution+center%22+when:7d&hl=en',
  'https://news.google.com/rss/search?q=(Nigeria+OR+Kenya+OR+Ghana+OR+Egypt+OR+India)+(%22to+build%22+OR+%22expansion%22+OR+%22new+facility%22+OR+%22logistics%22)+when:7d&hl=en',
];

function feeds() {
  const env = process.env.RSS_FEEDS;
  if (env && env.trim()) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_FEEDS;
}

// ---- tiny RSS/Atom parser (no deps) ---------------------------------------

function decode(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

// Atom <link href="..."/> or RSS <link>...</link>
function linkOf(block) {
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (href) return href[1];
  return tag(block, 'link');
}

function parseFeed(xml, sourceName) {
  if (!xml) return [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => {
    const title = tag(b, 'title');
    const url = linkOf(b);
    const summary = (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 280);
    const dateRaw = tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date');
    const parsed = dateRaw ? Date.parse(dateRaw) : NaN;
    return {
      source: `rss/${sourceName}`,
      social: false,
      title,
      summary,
      url,
      author: tag(b, 'author') || tag(b, 'dc:creator') || null,
      date: Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString(),
      market: null,
    };
  }).filter((i) => i.url && i.title);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'feed'; }
}

async function fetchLeads() {
  const leads = [];
  let scanned = 0;
  for (const url of feeds()) {
    try {
      const xml = await fetchText(url, { timeoutMs: 9000, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
      const items = parseFeed(xml, hostOf(url));
      scanned += items.length;
      for (const item of items) {
        const lead = buildLead(item);
        if (lead) leads.push(lead);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[rss] ${url} skipped: ${err.message}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[rss] scanned ${scanned} items → ${leads.length} ICP-fit leads`);
  return leads;
}

module.exports = { name: 'rss', fetchLeads, parseFeed, feeds, DEFAULT_FEEDS };
