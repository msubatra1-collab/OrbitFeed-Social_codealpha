'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { db } = require('../db/knex');

const SESSION_COOKIE = 'orbitfeed_session';
const CSRF_COOKIE = 'orbitfeed_csrf';
const cookieSecure = process.env.COOKIE_SECURE !== 'false';
const cookieSameSite = cookieSecure ? 'none' : 'lax';

function getJwtSecret() {
  if (!process.env.ORBITFEED_SESSION_SECRET || Buffer.byteLength(process.env.ORBITFEED_SESSION_SECRET) < 32) {
    throw new Error('ORBITFEED_SESSION_SECRET must be set to at least 32 bytes.');
  }
  return process.env.ORBITFEED_SESSION_SECRET;
}

function issueSession(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, getJwtSecret(), {
    algorithm: 'HS256',
    issuer: 'orbitfeed',
    audience: 'orbitfeed-web',
    expiresIn: '7d'
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/'
  });
}

function issueCsrf(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  return token;
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || cookie.length !== header.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return res.status(403).json({ error: 'csrf_failed', message: 'Refresh the page and retry the action.' });
  }
  next();
}

async function attachOptionalUser(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'], issuer: 'orbitfeed', audience: 'orbitfeed-web'
    });
    const user = await db('users').select('id', 'username', 'display_name', 'avatar_url').where({ id: payload.sub }).first();
    if (user) req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return next();
    next(error);
  }
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required', message: 'Sign in to continue.' });
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.name === 'ZodError') {
    return res.status(400).json({ error: 'validation_error', message: 'Check the submitted fields.', details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
  }
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
    return res.status(409).json({ error: 'conflict', message: 'That value is already in use.' });
  }
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large', message: 'Images must be 5 MB or smaller.' });
  if (error.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'invalid_upload', message: 'Upload one image file at a time.' });
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.code || 'request_error', message: error.message });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong. Please try again.' });
}

module.exports = { SESSION_COOKIE, issueSession, clearSession, issueCsrf, csrfProtection, attachOptionalUser, requireUser, asyncRoute, errorHandler };
