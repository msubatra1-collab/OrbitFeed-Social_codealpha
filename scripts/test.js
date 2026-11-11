'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const sqlite = path.join(os.tmpdir(), `orbitfeed-tests-${process.pid}.sqlite`);
for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(sqlite + suffix); } catch {} }
const env = {
  ...process.env,
  NODE_ENV: 'test',
  COOKIE_SECURE: 'false',
  ORBITFEED_SESSION_SECRET: crypto.randomBytes(48).toString('base64url'),
  SQLITE_FILE: sqlite,
  API_RATE_LIMIT_MAX: '100000'
};
delete env.DATABASE_URL;
const result = spawnSync(process.execPath, ['--test', 'tests/api.test.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
