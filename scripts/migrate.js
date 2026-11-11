'use strict';

const { db, prepareDatabase, isPostgres } = require('../src/db/knex');

prepareDatabase()
  .then(() => console.log(`Migrations are current (${isPostgres ? 'PostgreSQL' : 'SQLite WAL'}).`))
  .catch((error) => { console.error('Migration failed:', error.message); process.exitCode = 1; })
  .finally(() => db.destroy());
