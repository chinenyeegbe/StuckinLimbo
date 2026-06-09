'use strict';

const fs = require('fs');
const { ALERTS_FILE } = require('./store');

/**
 * Slack alerts.
 * -------------
 * Real-time ping when a lead crosses a score threshold or a top-tier signal
 * fires (new RFP, active site-search post, fund close). One message: name,
 * segment, score, why-now, deep link to the card.
 *
 * If a Slack incoming-webhook URL is configured (SLACK_WEBHOOK_URL env or set
 * via the UI), we POST to it. Either way we record every alert to an in-app
 * feed so the founder has a durable log even with no webhook / no network.
 */

const TOP_TIER_TYPES = new Set(['rfp', 'site_search', 'fund_close']);

function config() {
  return {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || readConfig().webhookUrl || null,
    threshold: Number(process.env.SLACK_SCORE_THRESHOLD || readConfig().threshold || 75),
  };
}

const CONFIG_FILE = ALERTS_FILE.replace('alerts-log.json', 'alerts-config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  const merged = { ...readConfig(), ...cfg };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function appendLog(entry) {
  const log = readLog();
  log.unshift(entry);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(log.slice(0, 200), null, 2));
}

/** Should this scored lead trigger an alert right now? */
function shouldAlert(scored, threshold) {
  if (scored.disqualified) return null;
  if (scored.score >= threshold) {
    return `score ${scored.score} ≥ threshold ${threshold}`;
  }
  if (scored.topSignal && TOP_TIER_TYPES.has(scored.topSignal.type)) {
    // Only alert on genuinely fresh top-tier fires (within 2 days).
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
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚨 *${lead.name}* · ${lead.org || ''}\n*${seg}* · score *${scored.score}*  _(triggered: ${reason})_\n${scored.whyNow}\n<${link}|Open card →>`,
        },
      },
    ],
  };
}

/**
 * Fire alerts for any newly-qualifying leads. `seen` is a Set of lead ids we've
 * already alerted on this cycle (caller persists it). Returns alert entries.
 */
async function dispatch(scoredLeads, { baseUrl, seen } = {}) {
  const { webhookUrl, threshold } = config();
  const fired = [];
  for (const { lead, scored } of scoredLeads) {
    if (seen && seen.has(lead.id)) continue;
    const reason = shouldAlert(scored, threshold);
    if (!reason) continue;

    const msg = formatMessage(lead, scored, reason, baseUrl);
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
          body: JSON.stringify(msg),
        });
        entry.delivered = res.ok;
        if (!res.ok) entry.error = `Slack responded ${res.status}`;
      } catch (err) {
        entry.error = `delivery failed: ${err.message}`;
      }
    } else {
      entry.error = 'no webhook configured — logged to in-app feed only';
    }

    appendLog(entry);
    fired.push(entry);
    if (seen) seen.add(lead.id);
  }
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
