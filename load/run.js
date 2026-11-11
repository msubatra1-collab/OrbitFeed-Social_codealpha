'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const sqlite = path.join(os.tmpdir(), `orbitfeed-load-${process.pid}.sqlite`);
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.ORBITFEED_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.PORT = '0';
process.env.SQLITE_FILE = sqlite;
process.env.API_RATE_LIMIT_MAX = '10000000';
process.env.SEED_ALLOW = 'yes';
process.env.SEED_PASSWORD = 'LoadTest-Local-Only-2026!';
delete process.env.DATABASE_URL;

const { db, prepareDatabase } = require('../src/db/knex');
const { seedDataset } = require('../scripts/seed');
const autocannon = require('autocannon');
const { start } = require('../server');

function cookiePair(line) { return String(line || '').split(';', 1)[0]; }
async function login(baseUrl) {
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfCookies = csrfResponse.headers.getSetCookie ? csrfResponse.headers.getSetCookie() : [csrfResponse.headers.get('set-cookie')];
  const csrfToken = (await csrfResponse.json()).token;
  const cookies = csrfCookies.map(cookiePair).filter(Boolean);
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.join('; '), 'x-csrf-token': csrfToken },
    body: JSON.stringify({ identifier: 'member0001', password: process.env.SEED_PASSWORD })
  });
  if (!loginResponse.ok) throw new Error(`Load-test login failed (${loginResponse.status}).`);
  const sessionCookies = loginResponse.headers.getSetCookie ? loginResponse.headers.getSetCookie() : [loginResponse.headers.get('set-cookie')];
  const allCookies = [...cookies, ...sessionCookies.map(cookiePair).filter(Boolean)];
  return { csrfToken, cookie: allCookies.join('; ') };
}
function benchmark(url, auth, requests) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      connections: 300,
      overallRate: 220,
      duration: 15,
      pipelining: 1,
      title: 'OrbitFeed local SQLite WAL 300-connection mixed API load',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      requests: requests.map((r) => ({ ...r, headers: { 'content-type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrfToken, ...(r.headers || {}) } }))
    }, (error, result) => error ? reject(error) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false });
  });
}
function summary(result) {
  const attempted = result.requests.total + result.errors + result.timeouts;
  const failed = result.errors + result.timeouts + result.non2xx;
  return {
    requests: result.requests.total,
    averageRequestsPerSecond: result.requests.average,
    averageLatencyMs: Number(result.latency.average.toFixed(2)),
    p50LatencyMs: Number(result.latency.p50.toFixed(2)),
    p99LatencyMs: Number(result.latency.p99.toFixed(2)),
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    errorRatePercent: Number((failed / Math.max(1, attempted) * 100).toFixed(2)),
    statusCodes: result.statusCodeStats
  };
}

(async () => {
  let server;
  try {
    await prepareDatabase();
    await seedDataset();
    server = await start();
    if (!server.listening) await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = await login(baseUrl);
    const result = await benchmark(baseUrl, auth, [
      { method: 'GET', path: '/api/feed?limit=15' },
      { method: 'POST', path: '/api/posts', body: JSON.stringify({ body: 'Load test post generated on an isolated temporary database.' }) },
      { method: 'POST', path: '/api/posts/1/like', body: '{}' },
      { method: 'POST', path: '/api/posts/1/comments', body: JSON.stringify({ body: 'Local load-test reply.' }) }
    ]);
    const measured = summary(result);
    const report = `# Local 300-connection load test\n\n- Database: SQLite in WAL mode on a disposable local file\n- Duration: 15 seconds\n- Connections: 300\n- Autocannon overallRate pacing target: 220 requests/sec (approximately 0.73 requests/sec per active connection)\n- Workload: feed read, post create, like, and comment create\n- General per-IP rate limit: elevated only for this isolated benchmark because all virtual clients share loopback IP\n- Requests: ${measured.requests}\n- Average throughput: ${measured.averageRequestsPerSecond} requests/sec (measured, not the pacing target)\n- Average latency: ${measured.averageLatencyMs} ms\n- p50 latency: ${measured.p50LatencyMs} ms\n- p99 latency: ${measured.p99LatencyMs} ms\n- Errors: ${measured.errors}\n- Timeouts: ${measured.timeouts}\n- Non-2xx responses: ${measured.non2xx}\n- Error rate: ${measured.errorRatePercent}%\n\nThis is a local fallback-path result, not production/PostgreSQL capacity proof. SQLite serializes writes; rerun against the configured PostgreSQL and durable storage before treating it as a deployment benchmark.\n`;
    await fs.writeFile(path.resolve(__dirname, 'results.md'), report);
    await fs.writeFile(path.resolve(__dirname, 'results.json'), JSON.stringify(measured, null, 2) + '\n');
    console.log(report);
  } catch (error) {
    console.error('Load test failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy().catch(() => {});
    for (const suffix of ['', '-wal', '-shm']) await fs.rm(sqlite + suffix, { force: true }).catch(() => {});
  }
})();
