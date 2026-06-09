'use strict';

/**
 * Contact derivation — every lead ships with concrete reach-out methods.
 * -----------------------------------------------------------------------
 * Public info only. Three confidence levels, never guessed:
 *   'direct'  — published by the person themselves (email/phone in the post,
 *               an open DM channel, replying on their own thread)
 *   'profile' — the author's public profile page
 *   'lookup'  — deterministic search links (LinkedIn / Google) that find the
 *               right person at the org; clearly labeled as lookups
 *
 * Contact shape: { method, label, value, url, confidence }
 */

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
// Phones must start with + or 00 (international form) to avoid matching money,
// dates, and IDs in headlines.
const PHONE_RE = /(?:\+|\b00)\d{1,3}[\s().-]?\d(?:[\d\s().-]{6,13})\d/g;

const JUNK_EMAIL_RE = /(example\.|@example|\.png$|\.jpe?g$|\.gif$|@2x\.|sentry|noreply|no-reply|donotreply)/i;

function extractEmails(text) {
  const out = new Set();
  for (const m of String(text || '').match(EMAIL_RE) || []) {
    const e = m.toLowerCase();
    if (!JUNK_EMAIL_RE.test(e)) out.add(e);
  }
  return [...out];
}

function extractPhones(text) {
  const out = new Set();
  for (const m of String(text || '').match(PHONE_RE) || []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) out.add(m.trim());
  }
  return [...out];
}

function contact(method, label, value, url, confidence) {
  return { method, label, value, url, confidence };
}

/**
 * Derive every reach-out method we can stand behind for a source item.
 * item: { source, social, author, url, title, summary, fullText? }
 * ctx:  { org?, name? } from the built lead.
 */
function deriveContacts(item, ctx = {}) {
  const out = [];
  const text = [item.title, item.summary, item.fullText].filter(Boolean).join('\n');

  // 1) Direct: contact details the person published themselves.
  for (const e of extractEmails(text)) {
    out.push(contact('email', `Email ${e}`, e, `mailto:${e}`, 'direct'));
  }
  for (const p of extractPhones(text)) {
    out.push(contact('phone', `Call/WhatsApp ${p}`, p, `tel:${p.replace(/[^\d+]/g, '')}`, 'direct'));
  }

  // 2) Direct/profile: the author's open channels per platform.
  const author = (item.author || '').trim();
  if (/^reddit\//.test(item.source || '') && author) {
    const u = author.replace(/^u\//, '');
    out.push(contact('dm', `DM u/${u} on Reddit`, `u/${u}`,
      `https://www.reddit.com/message/compose/?to=${encodeURIComponent(u)}`, 'direct'));
    out.push(contact('thread', 'Reply on their thread', item.url, item.url, 'direct'));
    out.push(contact('profile', `Reddit profile u/${u}`, `u/${u}`,
      `https://www.reddit.com/user/${encodeURIComponent(u)}`, 'profile'));
  } else if ((item.source || '') === 'hackernews' && author) {
    const u = author.replace(/^@/, '');
    out.push(contact('thread', 'Reply on the HN thread', item.url, item.url, 'direct'));
    out.push(contact('profile', `HN profile ${u} (email often in bio)`, u,
      `https://news.ycombinator.com/user?id=${encodeURIComponent(u)}`, 'profile'));
  }

  // 3) Lookup: deterministic search links to land on the right person.
  const org = (ctx.org || '').trim();
  if (org && org.length > 2) {
    out.push(contact('linkedin', `Find decision-maker at ${org} on LinkedIn`, org,
      `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${org} real estate expansion development`)}`,
      'lookup'));
    out.push(contact('search', `Find ${org} contact details`, org,
      `https://www.google.com/search?q=${encodeURIComponent(`"${org}" contact email site OR expansion OR "real estate"`)}`,
      'lookup'));
  }

  return dedupContacts(out).slice(0, 8);
}

function contactKey(c) {
  return `${c.method}::${(c.value || c.url || '').toLowerCase()}`;
}

function dedupContacts(contacts) {
  const seen = new Set();
  const out = [];
  for (const c of contacts || []) {
    if (!c || (!c.url && !c.value)) continue;
    const k = contactKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Reach-out priority: a published email beats a DM beats a profile beats a lookup.
const METHOD_PRIORITY = ['email', 'phone', 'dm', 'thread', 'profile', 'linkedin', 'search'];

function bestContact(contacts) {
  const list = dedupContacts(contacts);
  if (!list.length) return null;
  return list.slice().sort((a, b) => {
    const pa = METHOD_PRIORITY.indexOf(a.method);
    const pb = METHOD_PRIORITY.indexOf(b.method);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  })[0];
}

module.exports = {
  deriveContacts,
  dedupContacts,
  bestContact,
  extractEmails,
  extractPhones,
  METHOD_PRIORITY,
};
