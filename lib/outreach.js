'use strict';

const { relativeTime } = require('./scoring');

/**
 * Outreach draft generator.
 * --------------------------
 * Short, human, permission-less first-touch drafts that reference the ACTUAL
 * triggering signal — never generic. Tone: fun-but-professional, witty where it
 * lands, zero corporate sludge, no fake urgency. Tuned per segment.
 *
 * DRAFTS ONLY. A human approves and sends. Nothing here auto-sends.
 */

function firstName(name) {
  return (name || 'there').trim().split(/\s+/)[0];
}

function marketShort(market) {
  if (!market) return 'your market';
  return market.split(',')[0].trim();
}

/**
 * Build a draft for a lead given its hottest signal (topSignal) and score.
 * Returns { subject, body, segment }.
 */
function buildDraft(lead, topSignal, now = Date.now()) {
  const fn = firstName(lead.name);
  const mkt = marketShort(lead.market);
  const when = topSignal ? relativeTime(Date.parse(topSignal.date), now) : 'recently';
  const signalQuote = topSignal ? `"${topSignal.title}"` : 'your recent activity';

  let subject;
  let body;

  switch (lead.segment) {
    case 'developer':
      subject = `First-pass read on the ground in ${mkt}`;
      body =
`Hi ${fn},

Saw you're scouting ${mkt} — ${signalQuote} (${when}). Before you commit to a parcel, we can hand you a first-pass read on the ground: access, power, flood and zoning exposure, and the stuff that quietly kills a site after you've signed.

Cuespaces does the boring-but-decisive diligence in hours, not weeks, so you reach a defensible go/no-go faster. Happy to run your top shortlisted site as a free back-test — no strings.

Worth a quick look?

— Cuespaces`;
      break;

    case 'agent':
      subject = `A credibility-boosting first-pass score for ${mkt}`;
      body =
`Hi ${fn},

Noticed ${signalQuote} (${when}). When you put a commercial parcel in front of a client, a first-pass site score from Cuespaces does some heavy lifting for you — access, power, flood, zoning, and buildability, all linked to sources.

It's the difference between "trust me, it's a great site" and handing them defensible ground intel on day one. Want me to score your latest listing so you can see the format?

— Cuespaces`;
      break;

    case 'investor':
      subject = `De-risking the ground before the committee meets`;
      body =
`Hi ${fn},

If you're underwriting ${mkt} — ${signalQuote} (${when}) — the ground is usually the assumption nobody pressure-tests until it's expensive. Cuespaces delivers first-pass site truth (access, power, flood, zoning, buildability) so ground risk is on the table before the committee is.

We can run a back-test on a live deal in your pipeline so you can judge the signal-to-noise yourself. Open to it?

— Cuespaces`;
      break;

    default:
      subject = `First-pass site intelligence for ${mkt}`;
      body =
`Hi ${fn},

Saw ${signalQuote} (${when}). Cuespaces gives you a fast, defensible first-pass read on the ground so a high-stakes site decision doesn't rest on a hunch. Happy to run a free back-test on one site — interested?

— Cuespaces`;
  }

  const contacts = lead.contacts || [];
  const reachVia = lead.primaryContact || contacts[0] || null;

  return {
    subject,
    body,
    segment: lead.segment,
    reachVia,
    contacts,
    generatedAt: new Date(now).toISOString(),
  };
}

module.exports = { buildDraft, firstName, marketShort };
