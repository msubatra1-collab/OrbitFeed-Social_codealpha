'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const api = require('../controllers/api');
const { attachOptionalUser, requireUser, csrfProtection, asyncRoute } = require('../middleware/security');
const { imageUpload } = require('../middleware/validation');

const router = express.Router();
router.use(attachOptionalUser);
router.get('/auth/csrf', api.csrf);
router.use(csrfProtection);
const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator(req) {
    const parts = req.path.endsWith('/register')
      ? [req.body?.email, req.body?.username]
      : [req.body?.identifier];
    const identity = parts.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().toLowerCase()).join('|');
    return identity ? `auth:${crypto.createHash('sha256').update(identity).digest('hex')}` : `invalid:${crypto.randomUUID()}`;
  },
  message: { error: 'rate_limited', message: 'Too many unsuccessful attempts for this sign-in. Please wait 15 minutes and try again.' }
});

router.post('/auth/register', authAttemptLimiter, asyncRoute(api.register));
router.post('/auth/login', authAttemptLimiter, asyncRoute(api.login));
router.post('/auth/logout', asyncRoute(api.logout));
router.get('/auth/me', api.me);

router.get('/users/search', asyncRoute(api.searchUsers));
router.get('/users/:username/followers', asyncRoute(api.followers));
router.get('/users/:username/following', asyncRoute(api.following));
router.post('/users/:username/follow', requireUser, asyncRoute(api.follow));
router.delete('/users/:username/follow', requireUser, asyncRoute(api.unfollow));
router.get('/users/:username', asyncRoute(api.profile));
router.patch('/users/me', requireUser, asyncRoute(api.updateProfile));

router.get('/feed', requireUser, asyncRoute(api.feed));
router.get('/explore', asyncRoute(api.explore));
router.post('/uploads', requireUser, imageUpload.single('image'), asyncRoute(api.uploadImage));
router.post('/posts', requireUser, asyncRoute(api.createPost));
router.patch('/posts/:id', requireUser, asyncRoute(api.editPost));
router.delete('/posts/:id', requireUser, asyncRoute(api.deletePost));
router.get('/posts/:id/comments', asyncRoute(api.comments));
router.post('/posts/:id/comments', requireUser, asyncRoute(api.createComment));
router.delete('/comments/:id', requireUser, asyncRoute(api.deleteComment));
router.post('/posts/:id/like', requireUser, asyncRoute(api.like));
router.delete('/posts/:id/like', requireUser, asyncRoute(api.unlike));

module.exports = router;
