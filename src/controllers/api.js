'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { db } = require('../db/knex');
const { issueSession, clearSession, issueCsrf } = require('../middleware/security');
const { storeImage } = require('../services/storage');
const { fetchPosts, getPublicProfile, getPostById, decodeCursor, encodeCursor } = require('../models/social');
const { registerSchema, loginSchema, profileSchema, postSchema, commentSchema, listSchema, searchSchema } = require('../middleware/validation');

function safeUser(user) {
  if (!user) return null;
  const { id, username, email, display_name, bio, avatar_url, created_at } = user;
  return { id, username, email, displayName: display_name, bio: bio || '', avatarUrl: avatar_url || null, joinedAt: created_at };
}

function throwHttp(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function userId(req) { return req.user?.id; }
function parseId(raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throwHttp(400, 'invalid_id', 'Invalid item ID.');
  return value;
}
function validImageReference(value, id) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throwHttp(400, 'invalid_image', 'Invalid image URL.');
  const localOrStorage = value.startsWith('/media/') || value.startsWith(`/manus-storage/orbitfeed/${String(id)}/`);
  const external = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value);
  if (!localOrStorage && !external) throwHttp(400, 'invalid_image', 'Upload an image using the image upload endpoint first.');
  return value;
}

function cursorPage(rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null };
}

function encodeSearchCursor(user) {
  return Buffer.from(JSON.stringify({ username: user.username, id: Number(user.id) })).toString('base64url');
}

function decodeSearchCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const id = Number(value.id);
    if (typeof value.username !== 'string' || !/^[a-z0-9_]{3,30}$/.test(value.username) || !Number.isSafeInteger(id) || id < 1) throw new Error('bad cursor');
    return { username: value.username, id };
  } catch {
    throwHttp(400, 'invalid_cursor', 'Invalid pagination cursor.');
  }
}

async function getComments(postId, cursor, limit) {
  const decoded = decodeCursor(cursor);
  const query = db('comments as c').join('users as u', 'u.id', 'c.user_id')
    .select('c.id', 'c.post_id', 'c.body', 'c.created_at', 'c.user_id', 'u.username', 'u.display_name', 'u.avatar_url')
    .where('c.post_id', postId)
    .modify((builder) => {
      if (decoded) builder.where((nested) => nested.where('c.created_at', '<', decoded.createdAt).orWhere((equal) => equal.where('c.created_at', '=', decoded.createdAt).andWhere('c.id', '<', decoded.id)));
    })
    .orderBy('c.created_at', 'desc').orderBy('c.id', 'desc').limit(limit + 1);
  return cursorPage(await query, limit);
}

async function relationPage(username, direction, cursor, limit) {
  const profile = await db('users').select('id').where({ username }).first();
  if (!profile) throwHttp(404, 'not_found', 'Account not found.');
  const decoded = decodeCursor(cursor);
  const col = direction === 'followers' ? 'f.follower_id' : 'f.following_id';
  const filterCol = direction === 'followers' ? 'f.following_id' : 'f.follower_id';
  const query = db('follows as f').join('users as u', 'u.id', col)
    .select('u.id', 'u.username', 'u.display_name', 'u.bio', 'u.avatar_url', 'f.created_at')
    .where(filterCol, profile.id)
    .modify((builder) => {
      if (decoded) builder.where((nested) => nested.where('f.created_at', '<', decoded.createdAt).orWhere((equal) => equal.where('f.created_at', '=', decoded.createdAt).andWhere('u.id', '<', decoded.id)));
    })
    .orderBy('f.created_at', 'desc').orderBy('u.id', 'desc').limit(limit + 1);
  return cursorPage(await query, limit);
}

const api = {
  csrf(req, res) {
    res.json({ token: issueCsrf(res) });
  },

  async register(req, res) {
    const input = registerSchema.parse(req.body);
    const duplicate = await db('users').where({ email: input.email }).orWhere({ username: input.username }).first('id');
    if (duplicate) throwHttp(409, 'account_exists', 'That email or username is already registered.');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const [id] = await db('users').insert({
      username: input.username,
      email: input.email,
      display_name: input.displayName,
      password_hash: passwordHash,
      bio: ''
    }).returning('id');
    const user = await db('users').where({ id: typeof id === 'object' ? id.id : id }).first();
    issueSession(res, user.id);
    res.status(201).json({ user: safeUser(user) });
  },

  async login(req, res) {
    const input = loginSchema.parse(req.body);
    const identifier = input.identifier.toLowerCase();
    const user = await db('users').where('email', identifier).orWhere('username', identifier).first();
    const matched = user ? await bcrypt.compare(input.password, user.password_hash) : false;
    if (!matched) throwHttp(401, 'invalid_credentials', 'The email/username or password is incorrect.');
    issueSession(res, user.id);
    res.json({ user: safeUser(user) });
  },

  me(req, res) {
    res.json({ user: req.user ? { id: req.user.id, username: req.user.username, displayName: req.user.display_name, avatarUrl: req.user.avatar_url } : null });
  },

  logout(req, res) {
    clearSession(res);
    res.status(204).end();
  },

  async profile(req, res) {
    const username = String(req.params.username || '').toLowerCase();
    const user = await getPublicProfile(username, userId(req));
    if (!user) throwHttp(404, 'not_found', 'Account not found.');
    const pagination = listSchema.parse(req.query);
    const posts = await fetchPosts({ where: (q) => q.where('p.user_id', user.id), viewerId: userId(req), cursor: pagination.cursor, limit: pagination.limit });
    res.json({ user: { ...user, currentUser: String(user.id) === String(userId(req) || '') }, posts });
  },

  async updateProfile(req, res) {
    const data = profileSchema.parse(req.body);
    const patch = {};
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (data.bio !== undefined) patch.bio = data.bio;
    if (data.avatarUrl !== undefined) patch.avatar_url = validImageReference(data.avatarUrl, userId(req));
    if (data.avatarKey !== undefined) patch.avatar_key = data.avatarKey;
    if (Object.keys(patch).length) await db('users').where({ id: userId(req) }).update(patch);
    const user = await db('users').where({ id: userId(req) }).first();
    res.json({ user: safeUser(user) });
  },

  async follow(req, res) {
    const target = await db('users').select('id', 'username').where({ username: String(req.params.username).toLowerCase() }).first();
    if (!target) throwHttp(404, 'not_found', 'Account not found.');
    if (String(target.id) === String(userId(req))) throwHttp(400, 'self_follow', 'You cannot follow your own account.');
    await db('follows').insert({ follower_id: userId(req), following_id: target.id }).onConflict(['follower_id', 'following_id']).ignore();
    res.json({ following: true });
  },

  async unfollow(req, res) {
    const target = await db('users').select('id').where({ username: String(req.params.username).toLowerCase() }).first();
    if (!target) throwHttp(404, 'not_found', 'Account not found.');
    await db('follows').where({ follower_id: userId(req), following_id: target.id }).del();
    res.json({ following: false });
  },

  async followers(req, res) {
    const p = listSchema.parse(req.query);
    res.json(await relationPage(String(req.params.username).toLowerCase(), 'followers', p.cursor, p.limit));
  },

  async following(req, res) {
    const p = listSchema.parse(req.query);
    res.json(await relationPage(String(req.params.username).toLowerCase(), 'following', p.cursor, p.limit));
  },

  async searchUsers(req, res) {
    const p = searchSchema.parse(req.query);
    const decoded = decodeSearchCursor(p.cursor);
    const escaped = p.q.toLowerCase().replace(/[\\%_]/g, '\\$&');
    const rows = await db('users as u')
      .select('u.id', 'u.username', 'u.display_name', 'u.bio', 'u.avatar_url')
      .select(db.raw('(SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count'))
      .where((q) => q.whereRaw('LOWER(u.username) LIKE ? ESCAPE \'\\\'', [`%${escaped}%`]).orWhereRaw('LOWER(u.display_name) LIKE ? ESCAPE \'\\\'', [`%${escaped}%`]))
      .modify((builder) => {
        if (decoded) builder.where((next) => next.where('u.username', '>', decoded.username).orWhere((equal) => equal.where('u.username', '=', decoded.username).andWhere('u.id', '>', decoded.id)));
      })
      .orderBy('u.username', 'asc').orderBy('u.id', 'asc').limit(p.limit + 1);
    const hasMore = rows.length > p.limit;
    const users = hasMore ? rows.slice(0, p.limit) : rows;
    res.json({ users, nextCursor: hasMore ? encodeSearchCursor(users[users.length - 1]) : null });
  },

  async feed(req, res) {
    const p = listSchema.parse(req.query);
    const follows = await db('follows').select('following_id').where({ follower_id: userId(req) });
    const ids = [userId(req), ...follows.map((f) => f.following_id)];
    const result = await fetchPosts({ where: (q) => q.whereIn('p.user_id', ids), viewerId: userId(req), cursor: p.cursor, limit: p.limit });
    res.json(result);
  },

  async explore(req, res) {
    const p = listSchema.parse(req.query);
    res.json(await fetchPosts({ viewerId: userId(req), cursor: p.cursor, limit: p.limit }));
  },

  async createPost(req, res) {
    const input = postSchema.parse(req.body);
    const imageUrl = validImageReference(input.imageUrl, userId(req));
    const imageKey = input.imageKey || null;
    const [id] = await db('posts').insert({ user_id: userId(req), body: input.body, image_url: imageUrl, image_key: imageKey }).returning('id');
    const postId = typeof id === 'object' ? id.id : id;
    res.status(201).json({ post: await getPostById(postId, userId(req)) });
  },

  async editPost(req, res) {
    const id = parseId(req.params.id);
    const input = postSchema.partial().refine((v) => Object.keys(v).length > 0, 'Provide a field to update.').parse(req.body);
    const existing = await db('posts').where({ id }).first();
    if (!existing) throwHttp(404, 'not_found', 'Post not found.');
    if (String(existing.user_id) !== String(userId(req))) throwHttp(403, 'forbidden', 'You can only edit your own posts.');
    const patch = { updated_at: db.fn.now() };
    if (input.body !== undefined) patch.body = input.body;
    if (input.imageUrl !== undefined) patch.image_url = validImageReference(input.imageUrl, userId(req));
    if (input.imageKey !== undefined) patch.image_key = input.imageKey;
    await db('posts').where({ id }).update(patch);
    res.json({ post: await getPostById(id, userId(req)) });
  },

  async deletePost(req, res) {
    const id = parseId(req.params.id);
    const post = await db('posts').where({ id }).first();
    if (!post) throwHttp(404, 'not_found', 'Post not found.');
    if (String(post.user_id) !== String(userId(req))) throwHttp(403, 'forbidden', 'You can only delete your own posts.');
    await db('posts').where({ id }).del();
    res.status(204).end();
  },

  async comments(req, res) {
    const id = parseId(req.params.id);
    if (!await db('posts').select('id').where({ id }).first()) throwHttp(404, 'not_found', 'Post not found.');
    const p = listSchema.parse(req.query);
    res.json(await getComments(id, p.cursor, p.limit));
  },

  async createComment(req, res) {
    const postId = parseId(req.params.id);
    if (!await db('posts').select('id').where({ id: postId }).first()) throwHttp(404, 'not_found', 'Post not found.');
    const { body } = commentSchema.parse(req.body);
    const [inserted] = await db('comments').insert({ post_id: postId, user_id: userId(req), body }).returning('id');
    const id = typeof inserted === 'object' ? inserted.id : inserted;
    const comment = await db('comments as c').join('users as u', 'u.id', 'c.user_id').select('c.id', 'c.post_id', 'c.body', 'c.created_at', 'c.user_id', 'u.username', 'u.display_name', 'u.avatar_url').where('c.id', id).first();
    res.status(201).json({ comment });
  },

  async deleteComment(req, res) {
    const id = parseId(req.params.id);
    const comment = await db('comments').where({ id }).first();
    if (!comment) throwHttp(404, 'not_found', 'Comment not found.');
    if (String(comment.user_id) !== String(userId(req))) throwHttp(403, 'forbidden', 'You can only delete your own comments.');
    await db('comments').where({ id }).del();
    res.status(204).end();
  },

  async like(req, res) {
    const postId = parseId(req.params.id);
    if (!await db('posts').select('id').where({ id: postId }).first()) throwHttp(404, 'not_found', 'Post not found.');
    await db('likes').insert({ user_id: userId(req), post_id: postId }).onConflict(['user_id', 'post_id']).ignore();
    res.json({ liked: true });
  },

  async unlike(req, res) {
    const postId = parseId(req.params.id);
    await db('likes').where({ user_id: userId(req), post_id: postId }).del();
    res.json({ liked: false });
  },

  async uploadImage(req, res) {
    if (!req.file) throwHttp(400, 'missing_image', 'Choose an image file.');
    const image = await storeImage(userId(req), req.file.buffer);
    res.status(201).json(image);
  }
};

module.exports = api;
