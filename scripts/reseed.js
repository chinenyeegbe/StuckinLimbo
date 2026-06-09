'use strict';

// Regenerate the illustrative dataset with fresh relative dates.
// Usage: npm run seed   (file backend only — for local development)
const { generateSeedLeads } = require('../lib/signals');
const store = require('../lib/store');

(async () => {
  const leads = store.mergeDuplicates(generateSeedLeads());
  await store.saveLeads(leads);
  console.log(`Reseeded ${leads.length} illustrative leads with fresh relative dates.`);
})();
