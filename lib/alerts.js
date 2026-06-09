'use strict';

const kv = require('./kv');

/**
 * Slack alerts.
 * -------------
 * Real-time ping when a lead crosses a score threshold or a top-tier signal
 * fires (new RFP, active site-search post, fund close). One message: name,
 * segment, score, why-now, deep link to the card.
 *
 * Posts to a Slack incoming-webhook if configured (SLACK_WEBHOOK_URL env or the
 * UI), and always records every alert to a durable in-app feed (KV) so there's
 * a log even with no webhook / no network. State lives in KV so it works
 * identically locally and on Netlify.
 */

const CONFIG_KEY = 'alerts-config';
const LOG_KEY = 'alerts-log';
const TOP_TIER_TYPES = new Set(['rfp', 'site_search', 'fund_close']);
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // don't re-alert the same lead within 24h

async function readConfig() {
  return (await kv.get(CONFIG_KEY)) || {};
}

async function writeConfig(patch) {
  const merged = { ...(await readConfig()), ...patch };
  await kv.set(CONFIG_KEY, merged);
  return merged;
}

async function config() {
  const c = await readConfig();
  return {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || c.webhookUrl || null,
    threshold: Number(process.env.SLACK_SCORE_THRESHOLD || c.threshold || 75),
  };
}

async function readLog() {
  return (await kv.get(LOG_KEY)) || [];
}

async function appendLog(entries) {
  const log = await readLog();
  const next = [...entries, ...log].slice(0, 200);
  await kv.set(LOG_KEY, next);
}

function shouldAlert(scored, threshold) {
  if (scored.disqualified) return null;
  if (scored.score >= threshold) return `score ${scored.score} ≥ threshold ${threshold}`;
  if (scored.topSignal && TOP_TIER_TYPES.has(scored.topSignal.type)) {
    const days = (Date.now() - Date.parse(scored.topSignal.date)) / 86400000;
    if (days <= 2) return `top-tier signal: ${scored.topSignal.type}`;
  }
  return null;
}

function formatMessage(lead, scored, reason, baseUrl) {
  const link = `${baseUrl || ''}/#lead/${lead.id}`;
  const seg = (lead.segment || '').toUpperCase();
  return {
    text: `🚨 *${lead.name}* — ${lead.org || 'unknown org'} (${seg}) · score *${scored.score}*`,
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚨 *${lead.name}* · ${lead.org || ''}\n*${seg}* · score *${scored.score}*  _(triggered: ${reason})_\n${scored.whyNow}\n<${link}|Open card →>`,
      },
    }],
  };
}

/**
 * Fire alerts for newly-qualifying leads. Dedup is derived from the log
 * (same lead within 24h is skipped) so it's stateless across serverless calls.
 */
async function dispatch(scoredLeads, { baseUrl } = {}) {
  const { webhookUrl, threshold } = await config();
  const log = await readLog();
  const recent = new Set(
    log.filter((e) => Date.now() - Date.parse(e.at) < DEDUP_WINDOW_MS).map((e) => e.leadId),
  );

  const fired = [];
  for (const { lead, scored } of scoredLeads) {
    if (recent.has(lead.id)) continue;
    const reason = shouldAlert(scored, threshold);
    if (!reason) continue;

    const entry = {
      id: `alert-${Date.now()}-${lead.id}`,
      leadId: lead.id,
      name: lead.name,
      org: lead.org,
      segment: lead.segment,
      score: scored.score,
      whyNow: scored.whyNow,
      reason,
      at: new Date().toISOString(),
      delivered: false,
    };

    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formatMessage(lead, scored, reason, baseUrl)),
        });
        entry.delivered = res.ok;
        if (!res.ok) entry.error = `Slack responded ${res.status}`;
      } catch (err) {
        entry.error = `delivery failed: ${err.message}`;
      }
    } else {
      entry.error = 'no webhook configured — logged to in-app feed only';
    }

    fired.push(entry);
    recent.add(lead.id);
  }

  if (fired.length) await appendLog(fired);
  return fired;
}

module.exports = {
  dispatch,
  shouldAlert,
  readLog,
  readConfig,
  writeConfig,
  config,
  TOP_TIER_TYPES,
};
