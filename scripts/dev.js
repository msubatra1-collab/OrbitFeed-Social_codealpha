'use strict';

const crypto = require('node:crypto');
process.env.NODE_ENV ||= 'development';
process.env.ORBITFEED_SESSION_SECRET ||= crypto.randomBytes(48).toString('base64url');
if (!process.env.DATABASE_URL && !process.env.SQLITE_FILE) process.env.SQLITE_FILE = './data/orbitfeed.sqlite';
require('../server').start().catch((error) => { console.error('Development server failed:', error.message); process.exit(1); });
