'use strict';

/**
 * Scheduled ingestion (Netlify Scheduled Function).
 * Runs on the cron defined in netlify.toml ([functions."ingest-cron"].schedule)
 * — pulls fresh leads from every public source and merges them into Blobs, so
 * the morning digest is populated without anyone clicking a button.
 *
 * Scheduled functions run server-side only (no public HTTP trigger).
 */

const { runIngestion } = require('../../lib/ingest');

exports.handler = async () => {
  try {
    const result = await runIngestion({ timespan: '2d', maxrecords: 75, sinceDays: 2 });
    // eslint-disable-next-line no-console
    console.log('[ingest-cron] done:', JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ingest-cron] failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
