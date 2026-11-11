'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { db, prepareDatabase } = require('../src/db/knex');
const { app } = require('../server');

let first;
let second;
let csrfFirst;
let csrfSecond;
let userA;
let userB;
let postA;
let commentFromB;

before(async () => {
  await prepareDatabase();
  first = request.agent(app);
  second = request.agent(app);
  csrfFirst = (await first.get('/api/auth/csrf').expect(200)).body.token;
  csrfSecond = (await second.get('/api/auth/csrf').expect(200)).body.token;
});

after(async () => {
  await db.destroy();
});

test('auth, validation, profile, posts, comments, likes, follows, and pagination', async () => {
  const csrf = (agent, token) => agent.set('x-csrf-token', token);

  await first.post('/api/auth/register').send({ username: 'writer_one', displayName: 'Writer One', email: 'writer1@example.test', password: 'LongEnough-pass-1' }).expect(403);
  await csrf(first.post('/api/auth/register'), csrfFirst).send({ username: 'emoji_user', displayName: 'Emoji User', email: 'emoji@example.test', password: '😀'.repeat(20) }).expect(400);
  const registeredA = await csrf(first.post('/api/auth/register'), csrfFirst).send({ username: 'writer_one', displayName: 'Writer One', email: 'writer1@example.test', password: 'LongEnough-pass-1' }).expect(201);
  userA = registeredA.body.user;
  assert.equal(userA.username, 'writer_one');
  assert.equal('password_hash' in userA, false);
  assert.equal((await first.get('/api/auth/me').expect(200)).body.user.username, 'writer_one');

  const registeredB = await csrf(second.post('/api/auth/register'), csrfSecond).send({ username: 'reader_two', displayName: 'Reader Two', email: 'reader2@example.test', password: 'LongEnough-pass-2' }).expect(201);
  userB = registeredB.body.user;
  await csrf(first.post('/api/auth/register'), csrfFirst).send({ username: 'writer_one', displayName: 'Duplicate', email: 'duplicate@example.test', password: 'LongEnough-pass-3' }).expect(409);
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await csrf(first.post('/api/auth/login'), csrfFirst).send({ identifier: 'locked-user@example.test', password: 'wrong-password' });
    assert.equal(response.status, attempt < 10 ? 401 : 429);
  }
  assert.equal((await first.get('/api/auth/me').expect(200)).body.user.username, 'writer_one');
  await csrf(second.post('/api/auth/login'), csrfSecond).send({ identifier: 'reader_two', password: 'LongEnough-pass-2' }).expect(200);
  const search = await second.get('/api/users/search?q=writer').expect(200);
  assert.equal(search.body.users[0].username, 'writer_one');
  const searchFirstPage = await second.get('/api/users/search?q=er&limit=1').expect(200);
  assert.equal(searchFirstPage.body.users.length, 1);
  assert.ok(searchFirstPage.body.nextCursor);
  const searchSecondPage = await second.get(`/api/users/search?q=er&limit=1&cursor=${encodeURIComponent(searchFirstPage.body.nextCursor)}`).expect(200);
  assert.equal(searchSecondPage.body.users.length, 1);
  assert.notEqual(searchSecondPage.body.users[0].username, searchFirstPage.body.users[0].username);
  assert.equal(searchSecondPage.body.nextCursor, null);
  await second.get('/api/users/search?q=er&cursor=not-a-cursor').expect(400);
  await csrf(first.post('/api/uploads'), csrfFirst).attach('image', Buffer.from('not really a png'), { filename: 'fake.png', contentType: 'image/png' }).expect(415);

  const created = await csrf(first.post('/api/posts'), csrfFirst).send({ body: 'A real conversation starts with a small thought.' }).expect(201);
  postA = created.body.post;
  assert.equal(postA.like_count, 0);
  assert.equal(postA.comment_count, 0);
  const ownProfileAfterFirstPost = await first.get(`/api/users/${userA.username}`).expect(200);
  assert.equal(ownProfileAfterFirstPost.body.user.currentUser, true);
  assert.equal(Number(ownProfileAfterFirstPost.body.user.post_count), 1);
  assert.equal(String(ownProfileAfterFirstPost.body.posts.items[0].id), String(postA.id));
  await csrf(second.patch(`/api/posts/${postA.id}`), csrfSecond).send({ body: 'not mine' }).expect(403);

  await csrf(first.post(`/api/posts/${postA.id}/like`), csrfFirst).expect(200);
  await csrf(first.post(`/api/posts/${postA.id}/like`), csrfFirst).expect(200);
  const liked = (await first.get('/api/explore?limit=5').expect(200)).body.items.find((p) => String(p.id) === String(postA.id));
  assert.equal(Number(liked.like_count), 1);
  assert.equal(Boolean(liked.liked_by_me), true);
  await csrf(first.delete(`/api/posts/${postA.id}/like`), csrfFirst).expect(200);

  const comment = await csrf(second.post(`/api/posts/${postA.id}/comments`), csrfSecond).send({ body: 'That is a lovely thought.' }).expect(201);
  commentFromB = comment.body.comment;
  await csrf(first.delete(`/api/comments/${commentFromB.id}`), csrfFirst).expect(403);
  await csrf(second.delete(`/api/comments/${commentFromB.id}`), csrfSecond).expect(204);
  const ownComment = await csrf(first.post(`/api/posts/${postA.id}/comments`), csrfFirst).send({ body: 'Thanks for reading.' }).expect(201);
  await csrf(first.delete(`/api/comments/${ownComment.body.comment.id}`), csrfFirst).expect(204);

  await csrf(second.post(`/api/users/${userA.username}/follow`), csrfSecond).expect(200);
  await csrf(second.post(`/api/users/${userA.username}/follow`), csrfSecond).expect(200);
  await csrf(second.post(`/api/users/${userB.username}/follow`), csrfSecond).expect(400);
  const profile = await second.get(`/api/users/${userA.username}`).expect(200);
  assert.equal(Number(profile.body.user.follower_count), 1);
  assert.equal(Boolean(profile.body.user.followed_by_me), true);
  assert.equal(profile.body.posts.items.length, 1);
  const followers = await second.get(`/api/users/${userA.username}/followers?limit=1`).expect(200);
  assert.equal(followers.body.items[0].username, userB.username);

  await csrf(first.patch('/api/users/me'), csrfFirst).send({ displayName: 'Writer Updated', bio: 'A short profile.' }).expect(200);
  const feed = await first.get('/api/feed?limit=1').expect(200);
  assert.equal(feed.body.items.length, 1);
  assert.equal(Boolean(feed.body.nextCursor), false);
  const explore = await second.get('/api/explore?limit=1').expect(200);
  assert.equal(explore.body.items.length, 1);

  await csrf(first.delete(`/api/posts/${postA.id}`), csrfFirst).expect(204);
  await first.get('/api/posts/999999/comments').expect(404);
  await csrf(first.post('/api/auth/logout'), csrfFirst).expect(204);
  assert.equal((await first.get('/api/auth/me').expect(200)).body.user, null);
});
