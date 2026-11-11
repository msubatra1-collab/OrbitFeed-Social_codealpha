'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const knexFactory = require('knex');

const configuredUrl = process.env.DATABASE_URL || '';
const isPostgres = /^postgres(?:ql)?:\/\//i.test(configuredUrl);
if (process.env.NODE_ENV === 'production' && !isPostgres) {
  throw new Error('Production requires a reachable PostgreSQL DATABASE_URL; SQLite is a local/test fallback only.');
}
const sqliteFile = path.resolve(process.env.SQLITE_FILE || path.join(process.cwd(), 'data', 'orbitfeed.sqlite'));

if (!isPostgres) fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });

const db = knexFactory({
  client: isPostgres ? 'pg' : 'better-sqlite3',
  connection: isPostgres ? configuredUrl : { filename: sqliteFile },
  useNullAsDefault: !isPostgres,
  pool: isPostgres
    ? { min: 2, max: Number(process.env.DB_POOL_MAX || 10), acquireTimeoutMillis: 15000, idleTimeoutMillis: 30000 }
    : {
        min: 1,
        max: 1,
        afterCreate(connection, done) {
          try {
            connection.pragma('foreign_keys = ON');
            connection.pragma('journal_mode = WAL');
            connection.pragma('busy_timeout = 10000');
            done(null, connection);
          } catch (error) {
            done(error, connection);
          }
        }
      },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
    extension: 'js'
  }
});

async function prepareDatabase() {
  if (!isPostgres) {
    await db.raw('PRAGMA foreign_keys = ON');
    await db.raw('PRAGMA journal_mode = WAL');
    await db.raw('PRAGMA busy_timeout = 10000');
  }
  await db.migrate.latest();
}

module.exports = { db, prepareDatabase, isPostgres, sqliteFile };
