'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../lib/sources/classify');

test('classify maps text to type / project / segment', () => {
  const dc = c.classify('Acme to build hyperscale data center campus in Lagos');
  assert.strictEqual(dc.projectType, 'data_center');

  const fund = c.classify('Sahel Capital closes $200M infrastructure fund for logistics buildout');
  assert.strictEqual(fund.type, 'fund_close');
  assert.strictEqual(fund.segment, 'investor');

  const lease = c.classify('Prime 20,000 sqm warehouse now leasing in Nairobi');
  assert.strictEqual(lease.type, 'listing');
  assert.strictEqual(lease.segment, 'agent');

  const job = c.classify('We are hiring a Site Acquisition Manager for our retail rollout');
  assert.strictEqual(job.type, 'job_posting');
});

test('isICPFit accepts active CRE/infra intent, rejects noise and residential', () => {
  assert.ok(c.isICPFit('Looking for 2 acres for a new logistics warehouse in Lagos'));
  assert.ok(c.isICPFit('RFP issued for a 40MW data center campus'));
  assert.ok(!c.isICPFit('My cat knocked over a plant pot today')); // generic chatter
  assert.ok(!c.isICPFit('Seeking land for a 120-unit residential housing estate')); // residential
});

test('buildLead drops non-ICP and residential items, keeps real signals', () => {
  assert.strictEqual(c.buildLead({ source: 'x', title: 'random meme', url: 'https://a.test/1' }), null);
  assert.strictEqual(c.buildLead({
    source: 'x', title: 'Seeking land for residential housing estate', url: 'https://a.test/2',
  }), null);

  const lead = c.buildLead({
    source: 'reddit/r/commercialrealestate', social: true, author: 'u/devguy',
    title: 'Scouting locations for a new 15,000 sqft warehouse in Accra',
    url: 'https://www.reddit.com/r/x/abc', date: '2026-06-08T00:00:00Z',
  });
  assert.ok(lead);
  assert.strictEqual(lead.name, 'u/devguy');       // social → author is candidate person
  assert.strictEqual(lead.role, 'Social post author');
  assert.strictEqual(lead.needsReview, true);
  assert.strictEqual(lead.signals[0].projectType, 'warehouse');
  assert.strictEqual(lead.signals[0].sourceUrl, 'https://www.reddit.com/r/x/abc');
});

test('extractOrg pulls a proper-noun org or returns null', () => {
  assert.strictEqual(c.extractOrg('Dangote Group to build a data center'), 'Dangote Group');
  assert.strictEqual(c.extractOrg('the market expands'), null);
});
