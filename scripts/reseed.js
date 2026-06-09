'use strict';

// Regenerate the illustrative dataset with fresh relative dates.
// Usage: npm run seed
const fs = require('fs');
const { DATA_FILE } = require('../lib/store');

if (fs.existsSync(DATA_FILE)) {
  fs.unlinkSync(DATA_FILE);
  console.log('Removed existing data/leads.json');
}
// Re-loading the store regenerates and persists the seed.
const store = require('../lib/store');
const leads = store.load();
console.log(`Reseeded ${leads.length} illustrative leads with fresh relative dates.`);
