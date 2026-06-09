'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const contacts = require('../lib/contacts');
const { buildLead, detectMarket } = require('../lib/sources/classify');
const { mergeDuplicates } = require('../lib/store');

test('extractEmails pulls real emails and drops junk', () => {
  const found = contacts.extractEmails('Reach me at dev@brightfuel.io or noreply@x.com, logo.png');
  assert.ok(found.includes('dev@brightfuel.io'));
  assert.ok(!found.includes('noreply@x.com'));
  assert.ok(!found.some((e) => /\.png/.test(e)));
});

test('extractPhones only accepts international-form numbers', () => {
  const found = contacts.extractPhones('Call +234 801 234 5678 — built in 2024 for $45 million');
  assert.ok(found.length === 1);
  assert.ok(found[0].replace(/\D/g, '').startsWith('234'));
});

test('deriveContacts builds direct + lookup methods for a reddit post', () => {
  const list = contacts.deriveContacts({
    source: 'reddit/r/commercialrealestate', social: true, author: 'u/sitehunter',
    url: 'https://www.reddit.com/r/x/abc', title: 'Scouting warehouse sites — email me dev@acme.io',
  }, { org: 'Acme Logistics' });
  const methods = list.map((c) => c.method);
  assert.ok(methods.includes('email'));      // published in the post
  assert.ok(methods.includes('dm'));         // reddit DM compose
  assert.ok(methods.includes('linkedin'));   // org lookup
  // The published email is the best contact (direct beats lookup).
  assert.strictEqual(contacts.bestContact(list).method, 'email');
});

test('buildLead attaches contacts and a primary contact', () => {
  const lead = buildLead({
    source: 'reddit/r/logistics', social: true, author: 'u/devguy',
    title: 'Scouting locations for a 15,000 sqft warehouse in Accra',
    url: 'https://www.reddit.com/r/x/abc', date: '2026-06-08T00:00:00Z',
  });
  assert.ok(lead.contacts.length >= 1);
  assert.ok(lead.primaryContact);
  assert.strictEqual(lead.enriched, true);
  assert.strictEqual(lead.market, 'Accra, Ghana'); // inferred from text
});

test('detectMarket maps cities and countries to display markets', () => {
  assert.strictEqual(detectMarket('warehouse search in Lagos'), 'Lagos, Nigeria');
  assert.strictEqual(detectMarket('expanding across Vietnam'), 'Vietnam');
  assert.strictEqual(detectMarket('a quiet day at home'), null);
});

test('mergeDuplicates unions reach-out methods across a person\'s signals', () => {
  const merged = mergeDuplicates([
    { name: 'Jane Doe', org: 'Acme', signals: [],
      contacts: [{ method: 'email', value: 'jane@acme.io', url: 'mailto:jane@acme.io', confidence: 'direct' }] },
    { name: 'jane doe', org: 'ACME', signals: [],
      contacts: [{ method: 'linkedin', value: 'Acme', url: 'https://linkedin.com/x', confidence: 'lookup' }] },
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].contacts.length, 2);
  assert.strictEqual(merged[0].primaryContact.method, 'email'); // best across both
});
