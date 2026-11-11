'use strict';

require('dotenv').config();
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { db, prepareDatabase, isPostgres } = require('./src/db/knex');
const apiRoutes = require('./src/routes/api');
const { resolveLocalMedia } = require('./src/services/storage');
const { errorHandler } = require('./src/middleware/security');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https:', 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: null
    }
  }
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.API_RATE_LIMIT_MAX || 180), standardHeaders: 'draft-7', legacyHeaders: false }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.get('/healthz', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.status(200).json({ status: 'ok', database: isPostgres ? 'postgres' : 'sqlite' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.get('/media/:filename', async (req, res, next) => {
  try {
    const filePath = await resolveLocalMedia(req.params.filename);
    if (!filePath) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (error) { next(error); }
});
app.use('/api', apiRoutes);
app.get(['/','/explore','/profile/:username'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'That page or API endpoint does not exist.' }));
app.use(errorHandler);

async function start() {
  await prepareDatabase();
  if (!process.env.ORBITFEED_SESSION_SECRET || Buffer.byteLength(process.env.ORBITFEED_SESSION_SECRET) < 32) {
    throw new Error('Set ORBITFEED_SESSION_SECRET to at least 32 bytes before starting the server.');
  }
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => console.log(`OrbitFeed listening on ${host}:${port} (${isPostgres ? 'PostgreSQL' : 'SQLite WAL'})`));
  const shutdown = () => server.close(async () => { await db.destroy(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start().catch((error) => { console.error('Startup failed:', error.message); process.exit(1); });

module.exports = { app, start };
