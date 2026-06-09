'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const gdelt = require('../lib/sources/gdelt');

// A fixture shaped exactly like a GDELT DOC 2.0 ArtList response.
const FIXTURE = {
  articles: [
    {
      url: 'https://example-news.test/dangote-dc',
      title: 'Dangote Group to build hyperscale data center in Lagos',
      seendate: '20260607T101500Z',
      domain: 'example-news.test',
      language: 'English',
      sourcecountry: 'Nigeria',
    },
    {
      url: 'https://example-news.test/sahel-fund',
      title: 'Sahel Capital closes $200M infrastructure fund for logistics buildout',
      seendate: '20260606T080000Z',
      domain: 'example-news.test',
      language: 'English',
      sourcecountry: 'Ivory Coast',
    },
    {
      url: 'https://example-listings.test/warehouse',
      title: 'Prime 20,000 sqm warehouse now leasing in Nairobi',
      seendate: '20260605T120000Z',
      domain: 'example-listings.test',
      sourcecountry: 'Kenya',
    },
    {
      url: 'https://example-news.test/lane-homes',
      title: 'Lane Homes seeks land for new residential housing estate',
      seendate: '20260604T120000Z',
      domain: 'example-news.test',
      sourcecountry: 'Nigeria',
    },
  ],
};

test('parseSeendate converts GDELT timestamps to ISO', () => {
  assert.strictEqual(gdelt.parseSeendate('20260607T101500Z'), '2026-06-07T10:15:00.000Z');
});

test('classify maps headlines to type/project/segment', () => {
  const dc = gdelt.classify('Dangote Group to build hyperscale data center in Lagos');
  assert.strictEqual(dc.projectType, 'data_center');
  assert.strictEqual(dc.type, 'expansion');

  const fund = gdelt.classify('Sahel Capital closes $200M infrastructure fund for logistics buildout');
  assert.strictEqual(fund.type, 'fund_close');
  assert.strictEqual(fund.segment, 'investor');

  const lease = gdelt.classify('Prime 20,000 sqm warehouse now leasing in Nairobi');
  assert.strictEqual(lease.type, 'listing');
  assert.strictEqual(lease.segment, 'agent');

  const res = gdelt.classify('Lane Homes seeks land for new residential housing estate');
  assert.strictEqual(res.projectType, 'residential'); // scoring will disqualify
});

test('extractOrg pulls a proper-noun org from the headline', () => {
  assert.strictEqual(gdelt.extractOrg('Dangote Group to build hyperscale data center'), 'Dangote Group');
  assert.strictEqual(gdelt.extractOrg('the market expands'), null);
});

test('articlesToLeads builds source-traceable, review-flagged leads', () => {
  const leads = gdelt.articlesToLeads(FIXTURE.articles);
  assert.strictEqual(leads.length, 4);
  for (const l of leads) {
    assert.strictEqual(l.sample, false);
    assert.strictEqual(l.needsReview, true);
    assert.strictEqual(l.source, 'gdelt');
    assert.ok(l.signals.length >= 1);
    assert.ok(l.signals[0].sourceUrl, 'every signal carries a real URL');
    assert.ok(l.signals[0].date, 'every signal is dated');
  }
});

test('buildUrl produces a valid GDELT DOC query', () => {
  const url = gdelt.buildUrl({ timespan: '3d', maxrecords: 50 });
  assert.ok(url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc?'));
  assert.ok(url.includes('mode=ArtList'));
  assert.ok(url.includes('format=json'));
  assert.ok(decodeURIComponent(url).includes('"data center"'));
});
