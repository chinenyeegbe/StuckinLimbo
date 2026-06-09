'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const reddit = require('../lib/sources/reddit');
const hn = require('../lib/sources/hackernews');
const rss = require('../lib/sources/rss');
const { buildLead } = require('../lib/sources/classify');

test('reddit.parseListing normalizes posts and captures author', () => {
  const json = {
    data: {
      children: [
        { data: {
          title: 'Looking for 2 acres for a new logistics warehouse near Lagos',
          selftext: 'Need serviced industrial land, ~2 acres.',
          permalink: '/r/commercialrealestate/comments/abc/looking/',
          author: 'sitehunter', created_utc: 1781000000,
        } },
        { data: { title: '', permalink: '/r/x/empty/', author: 'nobody', created_utc: 1781000000 } },
      ],
    },
  };
  const items = reddit.parseListing(json, 'commercialrealestate');
  assert.strictEqual(items.length, 1); // empty-title dropped
  assert.strictEqual(items[0].social, true);
  assert.strictEqual(items[0].author, 'u/sitehunter');
  assert.ok(items[0].url.startsWith('https://www.reddit.com/r/'));

  const lead = buildLead(items[0]);
  assert.ok(lead);
  assert.strictEqual(lead.name, 'u/sitehunter');
  assert.strictEqual(lead.signals[0].projectType, 'logistics'); // "logistics warehouse" → logistics
});

test('hackernews.parseHits normalizes stories and falls back to HN url', () => {
  const json = {
    hits: [
      { title: 'Acme breaks ground on new gigafactory', url: 'https://acme.test/news',
        author: 'pg', created_at: '2026-06-07T10:00:00Z', objectID: '1' },
      { title: 'Generic Show HN: my todo app', url: 'https://todo.test',
        author: 'someone', created_at: '2026-06-07T10:00:00Z', objectID: '2' },
      { title: 'No URL story', author: 'x', created_at: '2026-06-07T10:00:00Z', objectID: '3' },
    ],
  };
  const items = hn.parseHits(json, 'gigafactory');
  assert.strictEqual(items.length, 3);
  assert.ok(items[2].url.includes('news.ycombinator.com/item?id=3')); // url fallback

  const leads = items.map(buildLead).filter(Boolean);
  // gigafactory → manufacturing (ICP fit); todo app → dropped as noise
  assert.ok(leads.some((l) => l.signals[0].projectType === 'manufacturing'));
  assert.ok(!leads.some((l) => /todo app/i.test(l.signals[0].title)));
});

test('rss.parseFeed handles RSS 2.0 items', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[New RFP: lenders sought for coastal LNG import terminal]]></title>
      <link>https://tenders.test/lng-rfp</link>
      <description>Pre-qualification notice for project finance.</description>
      <pubDate>Sat, 07 Jun 2026 09:00:00 GMT</pubDate>
    </item>
    <item><title>Town fair this weekend</title><link>https://news.test/fair</link></item>
  </channel></rss>`;
  const items = rss.parseFeed(xml, 'tenders.test');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, 'New RFP: lenders sought for coastal LNG import terminal');
  assert.strictEqual(items[0].url, 'https://tenders.test/lng-rfp');

  const leads = items.map(buildLead).filter(Boolean);
  assert.strictEqual(leads.length, 1); // town fair dropped as noise
  assert.strictEqual(leads[0].signals[0].type, 'rfp');
});

test('rss.parseFeed handles Atom entries', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Acme opening 10 new logistics hubs across Kenya</title>
      <link href="https://press.test/acme-hubs"/>
      <updated>2026-06-06T08:00:00Z</updated>
      <summary>Expansion into East African distribution.</summary>
    </entry>
  </feed>`;
  const items = rss.parseFeed(xml, 'press.test');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].url, 'https://press.test/acme-hubs');
  const lead = buildLead(items[0]);
  assert.ok(lead);
  assert.strictEqual(lead.signals[0].projectType, 'logistics');
});
