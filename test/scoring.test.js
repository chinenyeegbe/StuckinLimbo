'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { scoreLead, scoreFreshness, scoreIntent } = require('../lib/scoring');
const { dedupSignals, mergeDuplicates } = require('../lib/store');

const now = Date.now();
const day = 86400000;
const mkSignal = (daysAgo, type, tier, title = 't') => ({
  id: `${type}-${daysAgo}`, type, tier, title, date: new Date(now - daysAgo * day).toISOString(),
});

test('residential leads are hard-disqualified to 0', () => {
  const lead = {
    segment: 'developer', market: 'Lagos, Nigeria', projectType: 'residential',
    signals: [mkSignal(0, 'site_search', 'highest')],
  };
  const r = scoreLead(lead, now);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.disqualified, true);
});

test('commercial + emerging market + fresh site-search scores hot', () => {
  const lead = {
    segment: 'developer', market: 'Lagos, Nigeria', projectType: 'fuel_ev',
    signals: [mkSignal(0, 'site_search', 'highest')],
  };
  const r = scoreLead(lead, now);
  // 40 relevance + ~30 fresh + 30 intent
  assert.ok(r.score >= 95, `expected >=95, got ${r.score}`);
  assert.ok(/scouting|window/i.test(r.whyNow));
});

test('freshness halves roughly weekly', () => {
  const today = scoreFreshness([mkSignal(0, 'listing', 'highest')], now).points;
  const week = scoreFreshness([mkSignal(7, 'listing', 'highest')], now).points;
  assert.ok(Math.abs(today - 30) < 0.5);
  assert.ok(Math.abs(week - 15) < 0.5, `expected ~15 got ${week}`);
});

test('intent takes the hottest signal', () => {
  const r = scoreIntent([
    mkSignal(0, 'incorporation', 'context'),
    mkSignal(3, 'rfp', 'highest'),
  ]);
  assert.strictEqual(r.topSignal.type, 'rfp');
  assert.ok(r.points >= 28);
});

test('dedupSignals collapses identical signals and sorts newest-first', () => {
  const s = dedupSignals([
    mkSignal(5, 'listing', 'highest', 'A'),
    mkSignal(5, 'listing', 'highest', 'A'),
    mkSignal(0, 'rfp', 'highest', 'B'),
  ]);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].title, 'B'); // newest first
});

test('mergeDuplicates merges one human into one card', () => {
  const merged = mergeDuplicates([
    { name: 'Jane Doe', org: 'Acme', signals: [mkSignal(1, 'rfp', 'highest', 'X')] },
    { name: 'jane  doe', org: 'ACME', signals: [mkSignal(2, 'listing', 'highest', 'Y')] },
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].signals.length, 2);
});
