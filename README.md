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
lib/core.js            transport-agnostic API router (shared by server + function)
lib/scoring.js         the 0–100 ranking model + "why now" generator
lib/signals.js         signal types + illustrative seed generator
lib/sources/gdelt.js   real signal source — GDELT DOC 2.0 news adapter
lib/ingest.js          ingestion orchestrator (merge real leads into the store)
lib/store.js           lead store (dedup/merge/staleness) over the KV layer
lib/kv.js              pluggable persistence: file (local) | Netlify Blobs (prod)
lib/outreach.js        per-segment, signal-specific draft generator (draft-only)
lib/alerts.js          Slack webhook dispatch + durable alert feed
server.js              local dev server: static SPA + delegates /api to core
netlify/functions/api.js   Netlify Function: delegates /api to the same core
netlify.toml           Netlify build/redirects/Blobs config
public/                vanilla-JS single-page CRM (Digest / Inbox / Kanban / Alerts)
test/                  node:test unit tests (scoring, dedup, GDELT parsing)
scripts/               reseed + ingest CLIs
```

The local server and the Netlify Function are thin wrappers around the same
`lib/core.js` — identical behavior in both. Persistence is abstracted behind
`lib/kv.js`, so state lives in `data/*.json` locally and in **Netlify Blobs** in
production with no code changes.

---

## Deploy to Netlify

The app is a static SPA (`public/`) + one serverless function (`netlify/functions/api.js`)
backed by **Netlify Blobs** — no external database, no build step, no secrets required.

**One-time:**
```bash
npm i -g netlify-cli      # if you don't have it
netlify login
netlify init              # link/create the site (or connect the GitHub repo in the UI)
```

**Deploy:**
```bash
netlify deploy --build --prod
```
…or just connect this repo in the Netlify dashboard — `netlify.toml` already sets
the publish dir, function dir, `STORE_BACKEND=blobs`, and the `/api/*` rewrite.
Netlify Blobs is enabled automatically for functions, so persistence works out of the box.

**Live ingestion works on Netlify.** Functions have open egress, so the "📡 Pull
fresh signals" button (and `POST /api/ingest`) will actually reach GDELT in
production — unlike the restricted build sandbox.

**Local dev that mirrors prod** (functions + Blobs emulation):
```bash
netlify dev              # serves SPA + functions on one port
```
Optional: set the Slack webhook as an env var in the Netlify UI
(`SLACK_WEBHOOK_URL`) or via the in-app Slack Alerts tab.

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

## Real signal sources (live)

Four public, **no-auth** sources are wired in and run in parallel on each
ingestion. All respect the "public signals only" guardrail (no login, no
paywalls, no authenticated scraping):

| Source | Lane | File |
|--------|------|------|
| **GDELT DOC 2.0** | worldwide news / company press (strong emerging-market coverage) | `lib/sources/gdelt.js` |
| **Reddit** (public JSON) | **public social posts** — people openly asking where to put something physical (ICP-fit detection; author captured as candidate contact) | `lib/sources/reddit.js` |
| **Hacker News** (Algolia API) | tech / infra / expansion stories & posts | `lib/sources/hackernews.js` |
| **RSS / Atom** (generic) | configurable public feeds — tender/planning portals, CRE listings, press, event sites | `lib/sources/rss.js` |

```bash
npm run ingest                  # pull last 3 days from all sources, merge
node scripts/ingest.js 7d 100   # custom window + max records
# or, at runtime:  POST /api/ingest  { "timespan": "3d", "maxrecords": 75 }
# or, in the UI:   Daily Digest → 📡 Pull fresh signals
```

**Shared pipeline (`lib/sources/classify.js`).** Every source normalizes its
raw items and runs them through one tested path:
- **ICP-fit gate** — only items reflecting an *active commercial/infra ground
  decision* become leads. Generic chatter is dropped; **residential is dropped**
  (commercial & infrastructure only). A name with no live signal is noise.
- **Classification** — type/tier (highest→context), project type, and segment
  (developer / agent / investor).
- **Review flag** — because a post/headline rarely confirms the decision-maker,
  every live lead is `needsReview: true` (🔎 badge). A human confirms ICP fit
  before any outreach. Each signal keeps a real URL + date (*no hallucinated leads*).
- **Market inference** — when a source carries no geo (e.g. social posts), the
  market is inferred from the text so the lead still scores, filters, and
  displays on place.
- **Contact enrichment (`lib/contacts.js`)** — every lead ships with concrete,
  **public** reach-out methods so you can act without a separate enrichment step.
  Three confidence levels, never guessed:
  `direct` (email/phone the person published, an open DM, a reply on their own
  thread) → `profile` (their public profile page) → `lookup` (deterministic
  LinkedIn / Google search links that land on the right person at the org). The
  best method is surfaced on the card; the Inbox has a **📇 contactable-only**
  filter and reachable leads break score ties. Generated outreach drafts include
  the send-via links.

**Volume.** Sources are tuned for high recall: GDELT runs ~50 intent phrases at
up to 250 records, Reddit sweeps 13 subreddit/intent searches, Hacker News runs
21 queries, and RSS ships emerging-market + Google-News feeds (all overridable
via `RSS_FEEDS`). The ICP-fit gate keeps precision high downstream.

**Configure RSS feeds without code** via the `RSS_FEEDS` env var
(comma-separated URLs) — point it at your target markets' tender, planning, and
listing feeds. Set it in the Netlify UI.

### Scheduled ingestion (Netlify)

`netlify/functions/ingest-cron.js` runs on a cron (`netlify.toml` →
`[functions."ingest-cron"].schedule = "0 6 * * *"`) so the morning digest is
populated automatically — no button press needed. Adjust the cron to taste.

> **Egress note:** these sources must be reachable from the host's network
> allowlist. If one is blocked it logs and returns cleanly — no source can break
> the app. *In the build sandbox the allowlist blocked all external hosts, so
> live ingestion no-ops there; it runs live on Netlify, whose functions have
> open egress.*

### Adding more sources

1. Add an adapter under `lib/sources/` exposing `async fetchLeads(opts)` that
   normalizes items and calls `buildLead()` from the shared classifier.
2. Register it in `LIVE_SOURCES` (`lib/ingest.js`). It runs in parallel and
   merges/dedups automatically.

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
