'use strict';

const { db } = require('../db/knex');

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value.createdAt || !value.id) throw new Error('bad cursor');
    return value;
  } catch {
    const error = new Error('Invalid pagination cursor.');
    error.status = 400;
    error.code = 'invalid_cursor';
    throw error;
  }
}

function postSelection(viewerId) {
  return [
    'p.id', 'p.user_id', 'p.body', 'p.image_url', 'p.image_key', 'p.created_at', 'p.updated_at',
    'u.username', 'u.display_name', 'u.avatar_url',
    db.raw('(SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count'),
    db.raw('(SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count'),
    db.raw('EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me', [viewerId || -1])
  ];
}

async function fetchPosts({ where, viewerId = null, cursor = null, limit = 15 }) {
  const decoded = decodeCursor(cursor);
  const query = db('posts as p')
    .join('users as u', 'u.id', 'p.user_id')
    .select(postSelection(viewerId))
    .modify((builder) => { if (where) where(builder); })
    .modify((builder) => {
      if (decoded) builder.where((nested) => nested.where('p.created_at', '<', decoded.createdAt).orWhere((equal) => equal.where('p.created_at', '=', decoded.createdAt).andWhere('p.id', '<', decoded.id)));
    })
    .orderBy('p.created_at', 'desc')
    .orderBy('p.id', 'desc')
    .limit(limit + 1);
  const rows = await query;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
}

async function getPublicProfile(username, viewerId = null) {
  const user = await db('users as u')
    .select('u.id', 'u.username', 'u.display_name', 'u.bio', 'u.avatar_url', 'u.created_at')
    .select(db.raw('(SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count'))
    .select(db.raw('(SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count'))
    .select(db.raw('(SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count'))
    .select(db.raw('EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS followed_by_me', [viewerId || -1]))
    .where({ 'u.username': username.toLowerCase() }).first();
  return user || null;
}

async function getPostById(id, viewerId = null) {
  return db('posts as p').join('users as u', 'u.id', 'p.user_id')
    .select(postSelection(viewerId)).where('p.id', id).first();
}

module.exports = { encodeCursor, decodeCursor, fetchPosts, getPublicProfile, getPostById };
