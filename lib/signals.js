'use strict';

/**
 * Signal ingestion layer.
 * ------------------------
 * In production each `source` is an adapter that pulls PUBLICLY ACCESSIBLE
 * signals (LinkedIn-style posts & job boards, company press/news, government
 * planning & tender portals, public CRE listing pages, fund/capital-raise
 * announcements, industry event sites) — never behind auth or paywalls,
 * always honoring robots.txt and rate limits.
 *
 * Each adapter exposes:  async fetch({ since }) -> Signal[]
 *
 * For this single-tenant workspace we ship a clearly-labeled ILLUSTRATIVE
 * dataset so the founder can drive the full pipeline immediately. Every sample
 * lead is flagged `sample: true` and its signals are dated relative to "now"
 * so the digest stays alive. Wiring a real adapter is a drop-in replacement:
 * implement `fetch` and register it in `SOURCES`.
 */

const SIGNAL_TYPES = [
  'site_search', 'rfp', 'permit', 'job_posting', 'listing',
  'fund_close', 'expansion', 'capital_raise', 'conference',
  'incorporation', 'leadership',
];

// Tier per signal type — proximity to an active, undecided ground choice.
const TYPE_TIER = {
  site_search: 'highest',
  rfp: 'highest',
  permit: 'highest',
  job_posting: 'highest',
  listing: 'highest',
  fund_close: 'highest',
  expansion: 'strong',
  capital_raise: 'strong',
  conference: 'strong',
  incorporation: 'context',
  leadership: 'context',
};

/**
 * Source-adapter registry. Real adapters go here. Each must return Signal[]
 * with shape: { type, title, summary, sourceName, sourceUrl, date, market,
 * projectType, estScale }. The orchestrator dedups & merges into leads.
 *
 * Left intentionally empty of live adapters — this workspace runs on its
 * illustrative seed until a source is wired. See README "Wiring real sources".
 */
const SOURCES = [
  // { name: 'gov_tenders', fetch: async ({ since }) => [...] },
  // { name: 'cre_listings', fetch: async ({ since }) => [...] },
  // { name: 'job_boards',   fetch: async ({ since }) => [...] },
];

/**
 * Run every registered adapter and return a flat, de-duplicated signal list.
 * Adapter failures are isolated so one bad source never sinks the run.
 */
async function ingest({ since } = {}) {
  const out = [];
  for (const src of SOURCES) {
    try {
      const sigs = await src.fetch({ since });
      for (const s of sigs) out.push({ ...s, source: src.name });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[signals] source "${src.name}" failed:`, err.message);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Illustrative seed generator (relative dates keep the demo alive)
// ---------------------------------------------------------------------------

const day = 24 * 60 * 60 * 1000;

function ago(days, now = Date.now()) {
  return new Date(now - days * day).toISOString();
}

function sig(daysAgo, type, title, summary, sourceName, sourceUrl, extra = {}, now = Date.now()) {
  return {
    id: `${type}-${Math.round(daysAgo)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    tier: TYPE_TIER[type] || 'context',
    title,
    summary,
    sourceName,
    sourceUrl,
    date: ago(daysAgo, now),
    ...extra,
  };
}

/**
 * Build the illustrative pipeline. Names/orgs are fictional-but-realistic and
 * the dataset is for product demonstration; the "no hallucinated leads" rule
 * applies to live ingestion, where every card must trace to a real, dated,
 * linkable signal. Hence `sample: true` on each.
 */
function generateSeedLeads(now = Date.now()) {
  const leads = [
    // ---------------- Developers / Site-Seekers ----------------
    {
      id: 'L-001',
      name: 'Amara Okonkwo',
      org: 'BrightFuel Energy',
      role: 'Head of Real Estate & Expansion',
      segment: 'developer',
      market: 'Lagos, Nigeria',
      projectType: 'fuel_ev',
      estProjectScale: '20 fuel/EV hubs, ~$45M',
      stage: 'new',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(0, 'site_search',
          'Scouting 1–2 acre corner plots for EV-ready fuel hubs across Lekki & Ikeja',
          'Public post: "We are actively looking for high-traffic corner sites, 1–2 acres, for our next 8 fuel/EV hubs. DM me leads in Lagos."',
          'Professional network', 'https://example-network.test/posts/brightfuel-site-search', {
            market: 'Lagos, Nigeria', projectType: 'fuel_ev', estScale: '8 sites',
          }, now),
        sig(12, 'expansion',
          'BrightFuel to add 20 fuel/EV hubs by 2027',
          'Press release announcing aggressive multi-state rollout funded by recent raise.',
          'Company press', 'https://example-news.test/brightfuel-expansion', {}, now),
      ],
    },
    {
      id: 'L-002',
      name: 'Daniel Mwangi',
      org: 'KukuFresh Dark Kitchens',
      role: 'Co-founder & COO',
      segment: 'developer',
      market: 'Nairobi, Kenya',
      projectType: 'dark_kitchen',
      estProjectScale: '6 cloud-kitchen sites',
      stage: 'researching',
      owner: 'Founder',
      lastTouch: ago(2, now),
      sample: true,
      signals: [
        sig(1, 'job_posting',
          'Hiring: Site Acquisition Manager — Cloud Kitchens (Nairobi)',
          'Job board listing for a site acquisition lead to secure 6 dark-kitchen locations in 9 months.',
          'Job board', 'https://example-jobs.test/kukufresh-site-acq', {
            market: 'Nairobi, Kenya', projectType: 'dark_kitchen',
          }, now),
      ],
    },
    {
      id: 'L-003',
      name: 'Priya Nair',
      org: 'Meridian Site Advisors',
      role: 'Principal, Site Selection',
      segment: 'developer',
      secondarySegment: 'agent',
      market: 'Bengaluru, India',
      projectType: 'data_center',
      estProjectScale: '40MW hyperscale shortlist',
      stage: 'outreach_sent',
      owner: 'Founder',
      lastTouch: ago(3, now),
      sample: true,
      signals: [
        sig(2, 'rfp',
          'RFP issued: power-adjacent land for 40MW data-center campus',
          'Tenant-rep consultancy running a site search for a hyperscale client; RFP to landowners and brokers.',
          'Gov/industry tender portal', 'https://example-tenders.test/meridian-dc-rfp', {
            market: 'Bengaluru, India', projectType: 'data_center', estScale: '40MW',
          }, now),
        sig(9, 'conference',
          'Panel: "De-risking ground for India\'s data-center boom"',
          'Speaker listing at an infrastructure summit.',
          'Industry event site', 'https://example-events.test/datacenter-india-panel', {}, now),
      ],
    },
    {
      id: 'L-004',
      name: 'Tunde Bakare',
      org: 'FitHub Gyms',
      role: 'Expansion Lead',
      segment: 'developer',
      market: 'Abuja, Nigeria',
      projectType: 'fitness',
      estProjectScale: '5 flagship gyms',
      stage: 'new',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(4, 'site_search',
          'Looking for 8,000–12,000 sqft retail space for flagship gyms in Abuja',
          'Public post seeking high-street retail space for a fitness rollout.',
          'Professional network', 'https://example-network.test/posts/fithub-space', {
            market: 'Abuja, Nigeria', projectType: 'fitness', estScale: '8–12k sqft',
          }, now),
      ],
    },
    {
      id: 'L-005',
      name: 'Sofia Marchetti',
      org: 'NordCold Logistics',
      role: 'Director of Network Development',
      segment: 'developer',
      market: 'Accra, Ghana',
      projectType: 'cold_storage',
      estProjectScale: '2 cold-chain DCs',
      stage: 'researching',
      owner: 'Founder',
      lastTouch: ago(5, now),
      sample: true,
      signals: [
        sig(6, 'permit',
          'Building-permit application filed: 14,000 sqm cold-storage facility',
          'New planning application lodged with the local authority (not yet approved).',
          'Gov planning portal', 'https://example-planning.test/nordcold-permit', {
            market: 'Accra, Ghana', projectType: 'cold_storage',
          }, now),
      ],
    },
    {
      id: 'L-006',
      name: 'Wei Chen',
      org: 'Volta Cells',
      role: 'VP Manufacturing & Sites',
      segment: 'developer',
      market: 'Ho Chi Minh City, Vietnam',
      projectType: 'manufacturing',
      estProjectScale: 'Battery plant, ~$120M',
      stage: 'new',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(15, 'expansion',
          'Volta Cells exploring Southeast Asia plant location',
          'Announcement of a CapEx commitment and a multi-market site search.',
          'Company press', 'https://example-news.test/volta-sea-plant', {
            market: 'Ho Chi Minh City, Vietnam', projectType: 'manufacturing',
          }, now),
      ],
    },
    // ---------------- Agents / Brokers ----------------
    {
      id: 'L-007',
      name: 'Grace Adeyemi',
      org: 'Pinnacle Commercial',
      role: 'Industrial & Land Broker',
      segment: 'agent',
      market: 'Lagos, Nigeria',
      projectType: 'industrial',
      estProjectScale: '6.5 acre industrial parcel',
      stage: 'new',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(0, 'listing',
          'New listing: 6.5-acre serviced industrial parcel, Agbara corridor',
          'Fresh commercial listing posted to a public CRE page.',
          'Public CRE listing', 'https://example-listings.test/pinnacle-agbara', {
            market: 'Lagos, Nigeria', projectType: 'industrial', estScale: '6.5 acres',
          }, now),
      ],
    },
    {
      id: 'L-008',
      name: 'Marcus Bell',
      org: 'Harbor & Vine',
      role: 'Tenant-Rep Broker',
      segment: 'agent',
      market: 'Cairo, Egypt',
      projectType: 'retail',
      estProjectScale: 'QSR pad search, 4 sites',
      stage: 'in_conversation',
      owner: 'Founder',
      lastTouch: ago(1, now),
      sample: true,
      signals: [
        sig(1, 'site_search',
          'Buy-side search: retail pads for a QSR client expanding into New Cairo',
          'Broker running a tenant-rep site search and asking for off-market pads.',
          'Professional network', 'https://example-network.test/posts/harborvine-qsr', {
            market: 'Cairo, Egypt', projectType: 'retail', estScale: '4 pads',
          }, now),
      ],
    },
    {
      id: 'L-009',
      name: 'Lerato Dlamini',
      org: 'Veld Property Partners',
      role: 'Commercial Broker',
      segment: 'agent',
      market: 'Johannesburg, South Africa',
      projectType: 'warehouse',
      estProjectScale: '22,000 sqm warehouse',
      stage: 'parked',
      owner: 'Founder',
      lastTouch: ago(20, now),
      sample: true,
      signals: [
        sig(18, 'listing',
          'Listing: 22,000 sqm distribution warehouse, Midrand',
          'Commercial listing posted publicly; aging signal.',
          'Public CRE listing', 'https://example-listings.test/veld-midrand', {
            market: 'Johannesburg, South Africa', projectType: 'warehouse',
          }, now),
      ],
    },
    // ---------------- Investors / Financiers ----------------
    {
      id: 'L-010',
      name: 'Hassan Diallo',
      org: 'Sahel Infrastructure Capital',
      role: 'Partner, Real Assets',
      segment: 'investor',
      market: 'Abidjan, Côte d\'Ivoire',
      projectType: 'infrastructure',
      estProjectScale: '$200M infra debt facility',
      stage: 'new',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(2, 'fund_close',
          'Sahel closes $200M facility earmarked for logistics & energy buildout',
          'Fund close explicitly tied to physical buildout pipeline.',
          'Fund announcement', 'https://example-news.test/sahel-fund-close', {
            market: 'Abidjan, Côte d\'Ivoire', projectType: 'infrastructure', estScale: '$200M',
          }, now),
      ],
    },
    {
      id: 'L-011',
      name: 'Elena Petrova',
      org: 'Greenfield Real Asset Fund',
      role: 'Investment Director',
      segment: 'investor',
      market: 'Nairobi, Kenya',
      projectType: 'logistics',
      estProjectScale: 'Underwriting 3 logistics parks',
      stage: 'demo',
      owner: 'Founder',
      lastTouch: ago(4, now),
      sample: true,
      signals: [
        sig(3, 'capital_raise',
          'Greenfield raising for East African logistics parks — proceeds to land & facilities',
          'Public capital-raise note where use of proceeds is physical assets.',
          'Fund announcement', 'https://example-news.test/greenfield-raise', {
            market: 'Nairobi, Kenya', projectType: 'logistics',
          }, now),
        sig(11, 'conference',
          'Speaking: "Underwriting ground risk in frontier logistics"',
          'Panelist at a project-finance forum.',
          'Industry event site', 'https://example-events.test/greenfield-panel', {}, now),
      ],
    },
    {
      id: 'L-012',
      name: 'James Whitfield',
      org: 'Atlas Project Finance',
      role: 'Director, Infrastructure Debt',
      segment: 'investor',
      market: 'Lagos, Nigeria',
      projectType: 'lpg_energy',
      estProjectScale: 'LPG terminal debt review',
      stage: 'new',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(5, 'rfp',
          'Pre-qualification notice: lenders for a coastal LPG import terminal',
          'Public pre-qual notice inviting financiers ahead of committee.',
          'Gov/industry tender portal', 'https://example-tenders.test/atlas-lpg-preq', {
            market: 'Lagos, Nigeria', projectType: 'lpg_energy', estScale: 'terminal',
          }, now),
      ],
    },
    // ---------------- Scope-guard example (should be disqualified) ----------------
    {
      id: 'L-013',
      name: 'Robert Lane',
      org: 'Lane Homes',
      role: 'Developer',
      segment: 'developer',
      market: 'Lagos, Nigeria',
      projectType: 'residential',
      estProjectScale: '120-unit estate',
      stage: 'parked',
      owner: null,
      lastTouch: null,
      sample: true,
      signals: [
        sig(1, 'site_search',
          'Seeking land for 120-unit residential estate',
          'Residential — captured to demonstrate the scope guard; must score 0.',
          'Professional network', 'https://example-network.test/posts/lane-homes', {
            market: 'Lagos, Nigeria', projectType: 'residential',
          }, now),
      ],
    },
  ];
  return leads;
}

module.exports = {
  ingest,
  generateSeedLeads,
  SIGNAL_TYPES,
  TYPE_TIER,
  SOURCES,
};
