'use strict';

/**
 * Shared API core.
 * ----------------
 * Transport-agnostic request handler used by BOTH the local Node server
 * (`server.js`) and the Netlify Function (`netlify/functions/api.js`). It takes
 * a plain request shape and returns `{ status, json }` — no req/res coupling —
 * so the exact same domain logic runs locally and serverless.
 *
 *   handleRequest({ method, path, query, body, baseUrl }) -> { status, json }
 */

const store = require('./store');
const { scoreLead } = require('./scoring');
const { buildDraft } = require('./outreach');
const alerts = require('./alerts');
const { runIngestion } = require('./ingest');

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function present(lead, scored, now = Date.now()) {
  return {
    id: lead.id,
    name: lead.name,
    org: lead.org,
    role: lead.role,
    segment: lead.segment,
    secondarySegment: lead.secondarySegment || null,
    market: lead.market,
    projectType: lead.projectType,
    estProjectScale: lead.estProjectScale,
    stage: lead.stage,
    owner: lead.owner || null,
    lastTouch: lead.lastTouch || null,
    sample: !!lead.sample,
    source: lead.source || 'manual',
    needsReview: !!lead.needsReview,
    score: scored.score,
    disqualified: scored.disqualified,
    whyNow: scored.whyNow,
    breakdown: scored.breakdown,
    topSignal: scored.topSignal,
    stale: store.isStale(lead, now),
    signals: (lead.signals || []).slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
  };
}

function scoreAll(leads, now = Date.now()) {
  return leads.map((lead) => ({ lead, scored: scoreLead(lead, now) }));
}

function ok(json, status = 200) { return { status, json }; }
function err(status, message) { return { status, json: { error: message } }; }

// ---------------------------------------------------------------------------
// Route handlers (all async)
// ---------------------------------------------------------------------------

async function getLeads(query) {
  const now = Date.now();
  const leads = await store.loadLeads();
  const q = (query.q || '').toLowerCase();
  const segment = query.segment;
  const stage = query.stage;
  const market = (query.market || '').toLowerCase();
  const minScore = Number(query.minScore || 0);
  const includeDQ = query.includeDisqualified === '1';

  let items = scoreAll(leads, now)
    .map(({ lead, scored }) => present(lead, scored, now))
    .filter((l) => includeDQ || !l.disqualified)
    .filter((l) => l.score >= minScore)
    .filter((l) => !segment || l.segment === segment || l.secondarySegment === segment)
    .filter((l) => !stage || l.stage === stage)
    .filter((l) => !market || (l.market || '').toLowerCase().includes(market))
    .filter((l) => {
      if (!q) return true;
      const hay = [
        l.name, l.org, l.role, l.market, l.projectType, l.estProjectScale, l.whyNow,
        ...(l.signals || []).flatMap((s) => [s.title, s.summary, s.sourceName]),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });

  const sort = query.sort || 'score';
  if (sort === 'score') items.sort((a, b) => b.score - a.score);
  else if (sort === 'freshness') {
    items.sort((a, b) => Date.parse(b.signals[0]?.date || 0) - Date.parse(a.signals[0]?.date || 0));
  }
  return ok({ count: items.length, leads: items });
}

async function getLead(id) {
  const leads = await store.loadLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return err(404, 'not found');
  return ok(present(lead, scoreLead(lead)));
}

async function getDigest(query) {
  const now = Date.now();
  const sinceDays = Number(query.sinceDays || 2);
  const cutoff = now - sinceDays * 86400000;
  const leads = await store.loadLeads();

  const scored = scoreAll(leads, now)
    .map(({ lead, scored }) => present(lead, scored, now))
    .filter((l) => !l.disqualified)
    .filter((l) => (l.signals || []).some((s) => Date.parse(s.date) >= cutoff))
    .sort((a, b) => b.score - a.score);

  const segments = { developer: [], agent: [], investor: [] };
  for (const l of scored) (segments[l.segment] || (segments[l.segment] = [])).push(l);

  return ok({
    generatedAt: new Date(now).toISOString(),
    windowDays: sinceDays,
    total: scored.length,
    hottest: scored[0] || null,
    segments,
  });
}

async function patchLead(id, body) {
  const leads = await store.loadLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return err(404, 'not found');

  if (body.stage !== undefined) {
    if (!store.STAGES.includes(body.stage)) {
      return err(400, `invalid stage; one of ${store.STAGES.join(', ')}`);
    }
    lead.stage = body.stage;
    lead.lastTouch = new Date().toISOString();
  }
  if (body.owner !== undefined) {
    lead.owner = body.owner || null;
    lead.lastTouch = new Date().toISOString();
  }
  await store.saveLeads(leads);
  return ok(present(lead, scoreLead(lead)));
}

async function makeDraft(id) {
  const leads = await store.loadLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return err(404, 'not found');
  const scored = scoreLead(lead);
  const draft = buildDraft(lead, scored.topSignal);
  return ok({ leadId: id, draft, note: 'Draft only — a human approves and sends.' });
}

async function getBoard() {
  const now = Date.now();
  const leads = await store.loadLeads();
  const columns = {};
  for (const s of store.STAGES) columns[s] = [];
  for (const { lead, scored } of scoreAll(leads, now)) {
    if (scored.disqualified) continue;
    (columns[lead.stage] = columns[lead.stage] || []).push(present(lead, scored, now));
  }
  for (const s of store.STAGES) columns[s].sort((a, b) => b.score - a.score);
  return ok({ stages: store.STAGES, columns });
}

async function getAlerts() {
  const cfg = await alerts.config();
  return ok({
    config: { threshold: cfg.threshold, webhookUrl: maskUrl(cfg.webhookUrl) },
    alerts: await alerts.readLog(),
  });
}

async function putAlertsConfig(body) {
  const patch = {};
  if (typeof body.webhookUrl === 'string') patch.webhookUrl = body.webhookUrl.trim() || null;
  if (body.threshold !== undefined) patch.threshold = Number(body.threshold);
  const saved = await alerts.writeConfig(patch);
  return ok({ config: { threshold: saved.threshold, webhookUrl: maskUrl(saved.webhookUrl) } });
}

async function runAlerts(baseUrl) {
  const leads = await store.loadLeads();
  const fired = await alerts.dispatch(scoreAll(leads), { baseUrl });
  return ok({ fired: fired.length, alerts: fired });
}

async function ingest(body) {
  const result = await runIngestion(body || {});
  return ok(result);
}

function maskUrl(u) {
  if (!u) return null;
  return u.length > 24 ? `${u.slice(0, 20)}…(configured)` : '(configured)';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest({ method, path, query = {}, body = {}, baseUrl = '' }) {
  // Normalize: strip trailing slash (except root).
  const p = path.length > 1 ? path.replace(/\/$/, '') : path;
  const seg = p.split('/').filter(Boolean); // e.g. ['api','lead','L-001','draft']

  if (seg[0] !== 'api') return err(404, 'not an api route');

  // /api/leads
  if (p === '/api/leads') return getLeads(query);
  // /api/digest
  if (p === '/api/digest') return getDigest(query);
  // /api/board
  if (p === '/api/board') return getBoard();
  // /api/ingest
  if (p === '/api/ingest') return method === 'POST' ? ingest(body) : err(405, 'use POST');
  // /api/alerts , /api/alerts/config , /api/alerts/run
  if (p === '/api/alerts') return getAlerts();
  if (p === '/api/alerts/config') return method === 'PUT' ? putAlertsConfig(body) : err(405, 'use PUT');
  if (p === '/api/alerts/run') return method === 'POST' ? runAlerts(baseUrl) : err(405, 'use POST');
  // /api/lead/:id  and  /api/lead/:id/draft
  if (seg[1] === 'lead' && seg[2]) {
    const id = seg[2];
    if (seg[3] === 'draft') return method === 'POST' ? makeDraft(id) : err(405, 'use POST');
    if (method === 'GET') return getLead(id);
    if (method === 'PATCH') return patchLead(id, body);
    return err(405, 'method not allowed');
  }

  return err(404, `no route for ${method} ${p}`);
}

module.exports = { handleRequest, present, scoreAll };
