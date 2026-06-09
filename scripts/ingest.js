'use strict';

// Pull fresh leads from real sources and merge into the store.
// Usage: npm run ingest        (default 3-day window)
//        node scripts/ingest.js 7d 100
const { runIngestion } = require('../lib/ingest');

const timespan = process.argv[2] || '3d';
const maxrecords = Number(process.argv[3] || 75);

runIngestion({ timespan, maxrecords }).then((r) => {
  console.log('Ingestion report:', JSON.stringify(r, null, 2));
  if (r.added === 0 && r.fetched === 0) {
    console.log('\nNo new leads. If sources are unreachable, the host may be');
    console.log('outside this environment\'s egress allowlist — see README.');
  }
});
