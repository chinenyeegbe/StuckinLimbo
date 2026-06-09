'use strict';

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return node;
};
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  return res.json();
};
const SEG_LABEL = { developer: 'Developer', agent: 'Agent', investor: 'Investor' };
const SEG_ICON = { developer: '🏗️', agent: '🏢', investor: '💰' };
const STAGE_LABEL = {
  new: 'New', researching: 'Researching', outreach_sent: 'Outreach Sent',
  in_conversation: 'In Conversation', demo: 'Demo / Back-test', won: 'Won', parked: 'Parked / Not Now',
};
const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function scoreClass(s) { return s >= 75 ? 's-hot' : s >= 50 ? 's-warm' : 's-cool'; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Lead card (shared by digest + inbox)
// ---------------------------------------------------------------------------
function leadCard(l) {
  const tags = [
    el('span', { class: 'tag' }, l.market || '—'),
    el('span', { class: 'tag' }, (l.projectType || '').replace(/_/g, ' ')),
    l.estProjectScale ? el('span', { class: 'tag' }, l.estProjectScale) : null,
    el('span', { class: 'tag' }, `stage: ${STAGE_LABEL[l.stage] || l.stage}`),
    l.stale ? el('span', { class: 'tag stale' }, '⏳ stale') : null,
    l.sample ? el('span', { class: 'tag sample' }, 'sample') : null,
    l.needsReview ? el('span', { class: 'tag sample' }, '🔎 needs review') : null,
    l.source && l.source !== 'manual' && !l.sample ? el('span', { class: 'tag' }, `via ${l.source}`) : null,
  ];
  return el('div', { class: 'card', onclick: () => openDrawer(l.id) },
    el('div', { class: 'row1' },
      el('span', { class: `score ${scoreClass(l.score)}` }, String(l.score)),
      el('div', { class: 'who' },
        el('h3', {}, l.name),
        el('div', { class: 'org' }, `${l.role || ''}${l.org ? ' · ' + l.org : ''}`),
      ),
      el('span', { class: `seg ${l.segment}` }, SEG_LABEL[l.segment] || l.segment),
    ),
    el('div', { class: 'why' }, l.whyNow),
    el('div', { class: 'meta' }, tags),
  );
}

// ---------------------------------------------------------------------------
// View: Daily Digest
// ---------------------------------------------------------------------------
async function renderDigest(app) {
  app.append(el('div', { class: 'view-head' },
    el('div', {}, el('h2', {}, '☀️ Daily Digest'),
      el('div', { class: 'sub' }, 'Top new & re-scored leads since yesterday — read it in 90 seconds.')),
  ));
  const data = await api('/api/digest?sinceDays=3');

  if (!data.total) {
    app.append(el('div', { class: 'empty' }, 'No fresh signals in the window. Quiet morning.'));
    return;
  }

  if (data.hottest) {
    const h = data.hottest;
    app.append(el('div', { class: 'digest-hot', onclick: () => openDrawer(h.id) },
      el('div', { class: 'label' }, '🔥 Hottest right now'),
      el('div', { class: 'row1', style: 'margin-top:8px' },
        el('span', { class: `score ${scoreClass(h.score)}` }, String(h.score)),
        el('div', { class: 'who' },
          el('h3', {}, `${h.name} · ${h.org || ''}`),
          el('div', { class: 'org' }, h.whyNow)),
        el('span', { class: `seg ${h.segment}` }, SEG_LABEL[h.segment]),
      ),
    ));
  }

  for (const seg of ['developer', 'agent', 'investor']) {
    const list = (data.segments[seg] || []);
    if (!list.length) continue;
    const group = el('div', { class: 'seg-group' },
      el('h3', {}, `${SEG_ICON[seg]} ${SEG_LABEL[seg]}s `,
        el('span', { class: 'sub' }, `(${list.length})`)));
    const grid = el('div', { class: 'grid' });
    list.forEach((l) => grid.append(leadCard(l)));
    group.append(grid);
    app.append(group);
  }
}

// ---------------------------------------------------------------------------
// View: Inbox (search + filters)
// ---------------------------------------------------------------------------
const inboxState = { q: '', segment: '', stage: '', market: '', minScore: 0, sort: 'score' };

async function renderInbox(app) {
  app.append(el('div', { class: 'view-head' },
    el('div', {}, el('h2', {}, '📥 Searchable Inbox'),
      el('div', { class: 'sub' }, 'Every lead, deduped. One human, one card. Signals merged.'))));

  const search = el('input', { type: 'search', placeholder: 'Search name, org, signal, market…', value: inboxState.q });
  const segSel = filterSelect(['', 'developer', 'agent', 'investor'], inboxState.segment,
    (v) => v ? SEG_LABEL[v] : 'All segments');
  const stageSel = filterSelect(['', ...Object.keys(STAGE_LABEL)], inboxState.stage,
    (v) => v ? STAGE_LABEL[v] : 'All stages');
  const sortSel = filterSelect(['score', 'freshness'], inboxState.sort,
    (v) => v === 'score' ? 'Sort: Score' : 'Sort: Freshness');
  const minScore = el('input', { type: 'number', min: 0, max: 100, value: inboxState.minScore, style: 'width:70px' });

  const results = el('div', { class: 'grid' });
  const reload = async () => {
    inboxState.q = search.value;
    inboxState.segment = segSel.value;
    inboxState.stage = stageSel.value;
    inboxState.sort = sortSel.value;
    inboxState.minScore = minScore.value || 0;
    const qs = new URLSearchParams({
      q: inboxState.q, segment: inboxState.segment, stage: inboxState.stage,
      minScore: inboxState.minScore, sort: inboxState.sort,
    });
    const data = await api('/api/leads?' + qs);
    results.innerHTML = '';
    if (!data.count) { results.append(el('div', { class: 'empty' }, 'No leads match.')); return; }
    data.leads.forEach((l) => results.append(leadCard(l)));
  };

  [search, segSel, stageSel, sortSel, minScore].forEach((c) => {
    c.addEventListener('input', reload);
    c.addEventListener('change', reload);
  });

  app.append(el('div', { class: 'filters' },
    search, segSel, stageSel, sortSel,
    el('label', {}, 'min score', minScore)));
  app.append(results);
  reload();
}

function filterSelect(values, current, label) {
  const sel = el('select');
  values.forEach((v) => {
    const o = el('option', { value: v }, label(v));
    if (v === current) o.selected = true;
    sel.append(o);
  });
  return sel;
}

// ---------------------------------------------------------------------------
// View: Kanban
// ---------------------------------------------------------------------------
async function renderBoard(app) {
  app.append(el('div', { class: 'view-head' },
    el('div', {}, el('h2', {}, '🗂️ Deal-Flow Kanban'),
      el('div', { class: 'sub' }, 'Drag a card to move it. Staleness flags cards sitting too long.'))));

  const data = await api('/api/board');
  const board = el('div', { class: 'board' });

  for (const stage of data.stages) {
    const cards = data.columns[stage] || [];
    const body = el('div', { class: 'col-body' });
    cards.forEach((l) => body.append(kanbanCard(l)));

    const col = el('div', { class: 'column' },
      el('h4', {}, STAGE_LABEL[stage], el('span', { class: 'count' }, String(cards.length))),
      body);
    col.dataset.stage = stage;

    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/plain');
      await api(`/api/lead/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      route(); // re-render board
    });
    board.append(col);
  }
  app.append(board);
}

function kanbanCard(l) {
  const c = el('div', { class: 'kcard', draggable: 'true' },
    el('h5', {}, l.name),
    el('div', { class: 'ksub' }, l.org || ''),
    el('div', { class: 'kfoot' },
      el('span', { class: `score ${scoreClass(l.score)}`, style: 'min-width:34px;height:28px;font-size:13px' }, String(l.score)),
      el('span', { class: 'owner' }, l.owner ? `👤 ${l.owner}` : 'unassigned'),
    ),
    l.stale ? el('div', { class: 'ksub', style: 'color:var(--hot);margin-top:6px' }, '⏳ stale — needs a touch') : null,
  );
  c.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', l.id);
    c.classList.add('dragging');
  });
  c.addEventListener('dragend', () => c.classList.remove('dragging'));
  c.addEventListener('click', () => openDrawer(l.id));
  return c;
}

// ---------------------------------------------------------------------------
// View: Slack Alerts
// ---------------------------------------------------------------------------
async function renderAlerts(app) {
  app.append(el('div', { class: 'view-head' },
    el('div', {}, el('h2', {}, '🔔 Slack Alerts'),
      el('div', { class: 'sub' }, 'Ping when a lead crosses the threshold or a top-tier signal fires.'))));

  const data = await api('/api/alerts');
  const cfg = data.config || {};

  const webhook = el('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', value: '' });
  const threshold = el('input', { type: 'number', min: 0, max: 100, value: cfg.threshold ?? 75 });
  const saveBtn = el('button', { class: 'btn' }, 'Save config');
  const runBtn = el('button', { class: 'btn ghost' }, '▶ Run alert check now');
  const status = el('div', { class: 'hint' },
    cfg.webhookUrl ? `Webhook: ${cfg.webhookUrl}` : 'No webhook set — alerts log to this feed only.');

  saveBtn.addEventListener('click', async () => {
    const body = { threshold: Number(threshold.value) };
    if (webhook.value.trim()) body.webhookUrl = webhook.value.trim();
    await api('/api/alerts/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    route();
  });
  runBtn.addEventListener('click', async () => {
    const r = await api('/api/alerts/run', { method: 'POST' });
    runBtn.textContent = `Fired ${r.fired} alert(s)`;
    setTimeout(route, 900);
  });

  app.append(el('div', { class: 'config-box' },
    el('div', {}, el('label', {}, 'Slack incoming-webhook URL'), webhook),
    el('div', {}, el('label', {}, 'Score threshold'), threshold),
    el('div', { class: 'btn-row' }, saveBtn, runBtn),
    status,
  ));

  const feed = el('div', {});
  if (!data.alerts || !data.alerts.length) {
    feed.append(el('div', { class: 'empty' }, 'No alerts yet. Hit "Run alert check now".'));
  } else {
    data.alerts.forEach((a) => {
      feed.append(el('div', { class: 'alert-row', onclick: () => openDrawer(a.leadId) },
        el('span', { class: `dot ${a.delivered ? 'ok' : 'no'}` }),
        el('div', { class: 'a-body' },
          el('div', {}, el('b', {}, `${a.name} · ${a.org || ''}`),
            ` — ${SEG_LABEL[a.segment] || a.segment} · score ${a.score}`),
          el('div', { class: 'a-when' }, `${a.whyNow} · triggered: ${a.reason}`),
          a.error ? el('div', { class: 'a-when', style: 'color:var(--accent-warm)' }, a.error) : null,
        ),
        el('span', { class: 'a-when' }, fmtDate(a.at)),
      ));
    });
  }
  app.append(feed);
}

// ---------------------------------------------------------------------------
// Lead detail drawer
// ---------------------------------------------------------------------------
async function openDrawer(id) {
  const l = await api(`/api/lead/${id}`);
  const panel = $('#drawer-panel');
  panel.innerHTML = '';

  const close = el('button', { class: 'close', onclick: closeDrawer }, '×');

  // Stage + owner controls
  const stageSel = el('select', { class: 'stage-sel' });
  Object.keys(STAGE_LABEL).forEach((s) => {
    const o = el('option', { value: s }, STAGE_LABEL[s]);
    if (s === l.stage) o.selected = true;
    stageSel.append(o);
  });
  stageSel.addEventListener('change', async () => {
    await api(`/api/lead/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: stageSel.value }),
    });
  });

  const ownerInput = el('input', { type: 'text', class: 'owner-sel', placeholder: 'owner', value: l.owner || '' });
  ownerInput.addEventListener('change', async () => {
    await api(`/api/lead/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: ownerInput.value }),
    });
  });

  // Score breakdown
  const bd = l.breakdown;
  const comp = (name, c, cls) => el('div', { class: 'comp' },
    el('div', { class: 'top' }, el('span', {}, name),
      el('b', {}, `${Math.round(c.points)} / ${c.max}`)),
    el('div', { class: `bar ${cls}` }, el('span', { style: `width:${(c.points / c.max) * 100}%` })),
    el('ul', { class: 'reasons' }, ...(c.reasons || []).map((r) => el('li', {}, r))),
  );

  // Outreach draft
  const draftWrap = el('div', {});
  const draftBtn = el('button', { class: 'btn' }, '✍️ Generate outreach draft');
  draftBtn.addEventListener('click', async () => {
    draftBtn.textContent = 'Generating…';
    const r = await api(`/api/lead/${id}/draft`, { method: 'POST' });
    draftWrap.innerHTML = '';
    const d = r.draft;
    const pre = el('pre', {}, d.body);
    const copyBtn = el('button', { class: 'btn ghost', style: 'margin-top:10px' }, 'Copy to clipboard');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(`Subject: ${d.subject}\n\n${d.body}`);
      copyBtn.textContent = 'Copied ✓';
    });
    draftWrap.append(el('div', { class: 'draft-box' },
      el('div', { class: 'subj' }, `Subject: ${d.subject}`),
      pre,
      el('div', { class: 'draft-note' }, '⚠ Draft only — a human approves and sends. Never auto-sent.'),
      copyBtn,
    ));
    draftBtn.textContent = '✍️ Regenerate draft';
  });

  panel.append(
    close,
    el('div', { class: 'row1' },
      el('span', { class: `score ${scoreClass(l.score)}` }, String(l.score)),
      el('div', { class: 'who' },
        el('h2', {}, l.name),
        el('div', { class: 'org' }, `${l.role || ''}${l.org ? ' · ' + l.org : ''}`)),
      el('span', { class: `seg ${l.segment}` }, SEG_LABEL[l.segment] || l.segment),
    ),
    el('div', { class: 'why', style: 'margin-top:12px' }, '💡 ' + l.whyNow),
    el('dl', { class: 'kv' },
      el('dt', {}, 'Market'), el('dd', {}, l.market || '—'),
      el('dt', {}, 'Project type'), el('dd', {}, (l.projectType || '—').replace(/_/g, ' ')),
      el('dt', {}, 'Est. scale'), el('dd', {}, l.estProjectScale || '—'),
      el('dt', {}, 'Segment'), el('dd', {}, SEG_LABEL[l.segment] + (l.secondarySegment ? ` (+ ${SEG_LABEL[l.secondarySegment]})` : '')),
      el('dt', {}, 'Stage'), el('dd', {}, stageSel),
      el('dt', {}, 'Owner'), el('dd', {}, ownerInput),
      el('dt', {}, 'Last touch'), el('dd', {}, fmtDate(l.lastTouch)),
    ),
    el('div', { class: 'bd' },
      el('h4', {}, `Score breakdown — ${l.score}/100`),
      comp('Relevance', bd.relevance, 'relevance'),
      comp('Freshness', bd.freshness, 'freshness'),
      comp('Intent / decision-stage', bd.intent, 'intent'),
    ),
    el('div', { class: 'bd' },
      el('h4', {}, `Captured signals (${l.signals.length}) — newest first`),
      ...l.signals.map(signalCard),
    ),
    el('div', { class: 'bd' },
      el('h4', {}, 'Outreach draft'),
      draftBtn, draftWrap,
    ),
  );

  $('#drawer').classList.remove('hidden');
}

function signalCard(s) {
  return el('div', { class: `signal tier-${s.tier}` },
    el('div', { class: 'stype' }, `${(s.type || '').replace(/_/g, ' ')} · ${s.tier} intent`),
    el('h5', {}, s.title),
    s.summary ? el('p', {}, s.summary) : null,
    el('div', { class: 'when' }, `${s.sourceName || 'source'} · ${fmtDate(s.date)}`),
    s.sourceUrl ? el('a', { href: s.sourceUrl, target: '_blank', rel: 'noopener' }, '🔗 source link →') : null,
  );
}

function closeDrawer() { $('#drawer').classList.add('hidden'); }

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
let currentView = 'digest';
const VIEWS = { digest: renderDigest, inbox: renderInbox, board: renderBoard, alerts: renderAlerts };

async function route() {
  const app = $('#app');
  app.innerHTML = '';
  await VIEWS[currentView](app);
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentView = tab.dataset.view;
      route();
    });
  });
}

document.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeDrawer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// Deep links: /#lead/L-001
function checkHash() {
  const m = location.hash.match(/^#lead\/(.+)$/);
  if (m) openDrawer(m[1]);
}
window.addEventListener('hashchange', checkHash);

initTabs();
route();
checkHash();
