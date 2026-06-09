# Cuespaces Signal Radar 📡

> A private, single-tenant demand-sourcing workspace that finds people in the
> **pre-conviction window** of a high-stakes CRE / infrastructure site decision —
> and routes them to Cuespaces *before* they commit to bad ground.

North-star metric: **Time to Conviction** — how fast a decision-maker moves from
"we're considering this site" to a defensible go / no-go. This workspace shrinks
the gap between *"they have a site question"* and *"Cuespaces answered it."*

This is a sourcing engine for **buyers in motion**, not a company database.
A name with no live signal is noise.

---

## Quick start

No dependencies to install — it runs on the Node standard library only.

```bash
node server.js          # → http://localhost:3000
npm test                # run the scoring / dedup unit tests
npm run seed            # regenerate the illustrative dataset with fresh dates
```

Open `http://localhost:3000` and you land on the **Daily Digest**.

---

## What's in the box (the six outputs)

| Tab | What it does |
|-----|--------------|
| **☀️ Daily Digest** | One morning brief. Top new & re-scored leads since yesterday, grouped by segment, hottest first, each with score, the triggering signal, source link and a one-line *why now*. Skimmable in 90 seconds. |
| **📥 Inbox** | Every lead as a card. Full-text search + filters by segment, stage, market, min-score, and sort by score/freshness. Deduped aggressively — one human, one card, signals merged. |
| **🗂️ Kanban** | Venture-CRM board: New → Researching → Outreach Sent → In Conversation → Demo/Back-test → Won → Parked. Drag-and-drop, owner assignment, last-touch date, and a **staleness flag** when a card sits too long. |
| **✍️ Outreach Drafts** | Per-segment, signal-specific first-touch drafts (in the lead drawer). **Draft only — a human approves and sends. Never auto-sent.** |
| **🔔 Slack Alerts** | Ping when a lead crosses a score threshold or a top-tier signal fires (RFP, active site-search, fund close). Posts to a Slack webhook if configured; always logs to an in-app feed. |
| **CRM** | Inbox + Kanban + lead detail drawer. Founder-operable, no 40-field enterprise sludge. |

---

## The three segments we hunt

Every lead carries one primary segment (and optionally a secondary):

1. **🏗️ Developers / Site-Seekers** — operators expanding (QSR, fitness, fuel/EV,
   logistics, data centers, manufacturing, LPG/energy…), corporate real-estate &
   expansion leads, and site-selection consultants. *Commercial & infrastructure only — never residential.*
2. **🏢 Agents / Brokers** — commercial/industrial brokers, tenant-rep & buy-side
   brokers, listing agents (each fresh listing is a signal).
3. **💰 Investors / Financiers** — project-finance bankers, DFIs, infra debt desks,
   real-asset funds, PE real estate, family offices underwriting physical buildout.

---

## The ranking model (`lib/scoring.js`)

Each lead scores **0–100**, recomputed on every request. Nothing is a black box —
every component returns its contribution *and* a human-readable reason, surfaced
in the lead drawer.

- **Relevance (0–40)** — segment fit + project type Cuespaces actually scores
  (commercial/infra) + market fit (emerging / high-stakes markets are the bullseye).
  **Residential hard-zeroes the lead.**
- **Freshness (0–30)** — decays from the most recent signal: full today, halves
  weekly (`30 × 0.5^(days/7)`). Stale signals drop out of the digest.
- **Intent / decision-stage (0–30)** — maps to the signal tiers below; we take the
  hottest single live signal. Active site search beats vague expansion talk beats
  "company exists."

Each score ships with a **why now**: the exact signal, its date, and a one-liner.

### Signal tiers

| Tier | Signals | Intent |
|------|---------|--------|
| **Highest** (act today) | active site-search posts, RFPs/tenders/pre-quals, permit/zoning filings, site-acquisition job postings, fresh commercial listings, buildout-tied fund closes | 30 |
| **Strong** (warm) | expansion announcements, capital raises for land/facilities, conference panels on site selection / project finance | 18 |
| **Context** (build the file) | new incorporations, leadership changes in RE/project functions | 8 |

---

## Architecture

```
server.js              HTTP server + JSON API + static hosting (Node stdlib only)
lib/scoring.js         the 0–100 ranking model + "why now" generator
lib/signals.js         source-adapter registry + ingestion + illustrative seed
lib/store.js           JSON persistence, aggressive dedup/merge, staleness
lib/outreach.js        per-segment, signal-specific draft generator (draft-only)
lib/alerts.js          Slack webhook dispatch + in-app alert feed
public/                vanilla-JS single-page CRM (Digest / Inbox / Kanban / Alerts)
test/                  node:test unit tests for scoring + dedup
scripts/reseed.js      regenerate the demo dataset with fresh relative dates
```

### API

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/digest?sinceDays=` | Daily digest, grouped by segment |
| `GET` | `/api/leads?q=&segment=&stage=&market=&minScore=&sort=` | Searchable, filterable inbox |
| `GET` | `/api/lead/:id` | Full lead detail + score breakdown |
| `PATCH` | `/api/lead/:id` | `{ stage?, owner? }` — Kanban move / assignment |
| `POST` | `/api/lead/:id/draft` | Generate an outreach draft (never sends) |
| `GET` | `/api/board` | Leads grouped by Kanban column |
| `GET` | `/api/alerts` | Alert config + in-app feed |
| `PUT` | `/api/alerts/config` | `{ webhookUrl?, threshold? }` |
| `POST` | `/api/alerts/run` | Evaluate all leads and fire due alerts |

---

## Wiring real sources

The workspace ships with a **clearly-labeled illustrative dataset** (every sample
lead is flagged `sample: true`, with relative dates so the demo stays alive) so a
founder can drive the full pipeline on day one. The data layer is built for live
ingestion:

1. Implement an adapter in `lib/signals.js` with an async `fetch({ since })` that
   returns `Signal[]` from a **publicly accessible** source (LinkedIn-style posts &
   job boards, company press/news, government planning & tender portals, public CRE
   listing pages, fund/capital-raise announcements, industry event sites).
2. Register it in the `SOURCES` array.
3. The orchestrator dedups and merges signals into leads automatically.

Slack alerts go live the moment you set a webhook (UI → Slack Alerts, or the
`SLACK_WEBHOOK_URL` env var).

---

## Guardrails (enforced, not aspirational)

- **Public signals only** — no authenticated scraping, no paywalls, no buying personal data. Adapters must respect robots.txt and rate limits.
- **Commercial & infrastructure only — never residential.** Residential leads are hard-disqualified to score 0 (`scoring.js`), demonstrated by sample lead `L-013`.
- **Drafts not sends** — the outreach generator only drafts; a human approves every outbound. There is no send path.
- **No hallucinated leads** — every card traces to a real, dated, linkable signal. The shipped seed is explicitly marked sample data; live ingestion must carry a source URL or the signal doesn't exist.
- **Dedup & freshness discipline** — duplicates merge into one card; stale signals decay out of the digest automatically.
- **Privacy** — store only what's publicly posted and professionally relevant; no personal/sensitive data in URLs.
