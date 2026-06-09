'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./lib/store');
const { scoreLead } = require('./lib/scoring');
const { buildDraft } = require('./lib/outreach');
const alerts = require('./lib/alerts');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory cache of leads; persisted on every mutation.
let LEADS = store.load();
// Track which leads we've already alerted on so we don't spam Slack.
const ALERTED = new Set();

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function scoreAll(now = Date.now()) {
  return LEADS.map((lead) => {
    const scored = scoreLead(lead, now);
    return { lead, scored };
  });
}

/** Lead shaped for the UI: enrichment + score + breakdown + staleness. */
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
    score: scored.score,
    disqualified: scored.disqualified,
    whyNow: scored.whyNow,
    breakdown: scored.breakdown,
    topSignal: scored.topSignal,
    stale: store.isStale(lead, now),
    signals: (lead.signals || []).slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
  };
}

function findLead(id) {
  return LEADS.find((l) => l.id === id);
}

function touch(lead) {
  lead.lastTouch = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

const api = {
  // GET /api/leads?segment=&market=&minScore=&stage=&q=&sort=
  'GET /api/leads': (req, res, url) => {
    const now = Date.now();
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const segment = url.searchParams.get('segment');
    const stage = url.searchParams.get('stage');
    const market = (url.searchParams.get('market') || '').toLowerCase();
    const minScore = Number(url.searchParams.get('minScore') || 0);
    const includeDQ = url.searchParams.get('includeDisqualified') === '1';

    let items = scoreAll(now)
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

    const sort = url.searchParams.get('sort') || 'score';
    if (sort === 'score') items.sort((a, b) => b.score - a.score);
    else if (sort === 'freshness') {
      items.sort((a, b) =>
        Date.parse(b.signals[0]?.date || 0) - Date.parse(a.signals[0]?.date || 0));
    }

    send(res, 200, { count: items.length, leads: items });
  },

  // GET /api/leads/:id
  'GET /api/lead': (req, res, url) => {
    const id = url.pathname.split('/').pop();
    const lead = findLead(id);
    if (!lead) return send(res, 404, { error: 'not found' });
    const scored = scoreLead(lead);
    send(res, 200, present(lead, scored));
  },

  // GET /api/digest — top new & re-scored leads, grouped by segment.
  'GET /api/digest': (req, res, url) => {
    const now = Date.now();
    const sinceDays = Number(url.searchParams.get('sinceDays') || 2);
    const cutoff = now - sinceDays * 86400000;

    const scored = scoreAll(now)
      .map(({ lead, scored }) => present(lead, scored, now))
      .filter((l) => !l.disqualified)
      // "New or re-scored since yesterday" == has a signal within the window.
      .filter((l) => (l.signals || []).some((s) => Date.parse(s.date) >= cutoff))
      .sort((a, b) => b.score - a.score);

    const segments = { developer: [], agent: [], investor: [] };
    for (const l of scored) (segments[l.segment] || (segments[l.segment] = [])).push(l);

    send(res, 200, {
      generatedAt: new Date(now).toISOString(),
      windowDays: sinceDays,
      total: scored.length,
      hottest: scored[0] || null,
      segments,
    });
  },

  // PATCH /api/lead/:id  { stage?, owner? } — Kanban move / assignment.
  'PATCH /api/lead': (req, res, url, body) => {
    const id = url.pathname.split('/').pop();
    const lead = findLead(id);
    if (!lead) return send(res, 404, { error: 'not found' });

    if (body.stage !== undefined) {
      if (!store.STAGES.includes(body.stage)) {
        return send(res, 400, { error: `invalid stage; one of ${store.STAGES.join(', ')}` });
      }
      lead.stage = body.stage;
      touch(lead);
    }
    if (body.owner !== undefined) {
      lead.owner = body.owner || null;
      touch(lead);
    }
    store.persist(LEADS);
    send(res, 200, present(lead, scoreLead(lead)));
  },

  // POST /api/lead/:id/draft — generate an outreach draft (never sends).
  'POST /api/draft': (req, res, url) => {
    const parts = url.pathname.split('/');
    const id = parts[parts.length - 2];
    const lead = findLead(id);
    if (!lead) return send(res, 404, { error: 'not found' });
    const scored = scoreLead(lead);
    const draft = buildDraft(lead, scored.topSignal);
    send(res, 200, { leadId: id, draft, note: 'Draft only — a human approves and sends.' });
  },

  // GET /api/board — leads grouped by Kanban column.
  'GET /api/board': (req, res) => {
    const now = Date.now();
    const columns = {};
    for (const s of store.STAGES) columns[s] = [];
    for (const { lead, scored } of scoreAll(now)) {
      if (scored.disqualified) continue;
      columns[lead.stage] = columns[lead.stage] || [];
      columns[lead.stage].push(present(lead, scored, now));
    }
    for (const s of store.STAGES) columns[s].sort((a, b) => b.score - a.score);
    send(res, 200, { stages: store.STAGES, columns });
  },

  // GET /api/alerts — in-app alert feed.
  'GET /api/alerts': (req, res) => {
    send(res, 200, { config: safeConfig(), alerts: alerts.readLog() });
  },

  // PUT /api/alerts/config  { webhookUrl?, threshold? }
  'PUT /api/alerts': (req, res, url, body) => {
    const cfg = {};
    if (typeof body.webhookUrl === 'string') cfg.webhookUrl = body.webhookUrl.trim() || null;
    if (body.threshold !== undefined) cfg.threshold = Number(body.threshold);
    const saved = alerts.writeConfig(cfg);
    send(res, 200, { config: { ...saved, webhookUrl: maskUrl(saved.webhookUrl) } });
  },

  // POST /api/alerts/run — evaluate all leads and fire any due alerts.
  'POST /api/alerts': async (req, res, url) => {
    const baseUrl = `http://localhost:${PORT}`;
    const fired = await alerts.dispatch(scoreAll(), { baseUrl, seen: ALERTED });
    send(res, 200, { fired: fired.length, alerts: fired });
  },
};

function safeConfig() {
  const c = alerts.config();
  return { threshold: c.threshold, webhookUrl: maskUrl(c.webhookUrl) };
}
function maskUrl(u) {
  if (!u) return null;
  return u.length > 24 ? `${u.slice(0, 20)}…(configured)` : '(configured)';
}

// ---------------------------------------------------------------------------
// Routing + static files
// ---------------------------------------------------------------------------

function routeKey(method, pathname) {
  // Collapse /api/lead/:id -> GET /api/lead, etc.
  if (pathname.startsWith('/api/leads')) return `${method} /api/leads`;
  if (pathname.startsWith('/api/lead/') && pathname.endsWith('/draft')) return `${method} /api/draft`;
  if (pathname.startsWith('/api/lead/')) return `${method} /api/lead`;
  if (pathname.startsWith('/api/digest')) return `${method} /api/digest`;
  if (pathname.startsWith('/api/board')) return `${method} /api/board`;
  if (pathname.startsWith('/api/alerts/run')) return `${method} /api/alerts`;
  if (pathname.startsWith('/api/alerts/config')) return `${method} /api/alerts`;
  if (pathname.startsWith('/api/alerts')) return `${method} /api/alerts`;
  return `${method} ${pathname}`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const key = routeKey(req.method, pathname);
    const handler = api[key];
    if (!handler) return send(res, 404, { error: `no route for ${key}` });
    try {
      const body = (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT')
        ? await readBody(req) : null;
      await handler(req, res, url, body);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[api] error:', err);
      send(res, 500, { error: 'internal error', detail: err.message });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

if (require.main === module) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Cuespaces Signal Radar → http://localhost:${PORT}`);
    console.log(`Loaded ${LEADS.length} leads (illustrative seed unless real sources wired).`);
  });
}

module.exports = { server, scoreAll, present };
