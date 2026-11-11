'use strict';

const bcrypt = require('bcryptjs');
const { db, prepareDatabase, isPostgres } = require('../src/db/knex');

const chunkSize = 200;
async function insertBatches(table, rows) {
  for (let i = 0; i < rows.length; i += chunkSize) await db.batchInsert(table, rows.slice(i, i + chunkSize), chunkSize);
}

async function seedDataset() {
  if (process.env.SEED_ALLOW !== 'yes') throw new Error('Set SEED_ALLOW=yes to confirm an isolated seed run.');
  if (isPostgres || process.env.NODE_ENV === 'production') throw new Error('Seeding is restricted to an isolated SQLite test database.');
  const existing = await db('users').count({ total: '*' }).first();
  if (Number(existing.total) !== 0) throw new Error('Refusing to seed a non-empty database; point SQLITE_FILE at a fresh isolated file.');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) throw new Error('Set SEED_PASSWORD (10+ characters) for the isolated seed accounts.');

  const passwordHash = await bcrypt.hash(password, 8);
  const now = Date.now();
  const users = Array.from({ length: 2000 }, (_, i) => ({
    username: `member${String(i + 1).padStart(4, '0')}`,
    email: `member${String(i + 1).padStart(4, '0')}@example.test`,
    display_name: ['Avery Chen', 'Noah Rivera', 'Mina Patel', 'Jules Martin', 'Sam Okafor', 'Rory Kim'][i % 6] + ` ${i + 1}`,
    password_hash: passwordHash,
    bio: ['Collecting small moments.', 'Here for thoughtful threads.', 'Coffee, books, and long walks.', 'Making things and taking notes.'][i % 4],
    created_at: new Date(now - (i % 365) * 86400000)
  }));
  console.log('Seeding 2,000 isolated users…');
  await insertBatches('users', users);

  const posts = Array.from({ length: 10000 }, (_, i) => ({
    user_id: (i * 17) % 2000 + 1,
    body: [
      'A small reminder: you do not have to make every day extraordinary for it to matter.',
      'What is one thing you learned this week that you wish you had known sooner?',
      'The best ideas usually arrive after I stop staring at the blank page.',
      'A good playlist can turn a routine walk into a tiny adventure.',
      'Taking a slower route home today. The sky deserves a second look.'
    ][i % 5] + ` (${i + 1})`,
    created_at: new Date(now - (i % 30) * 86400000 - (i % 1440) * 60000),
    updated_at: new Date(now - (i % 30) * 86400000 - (i % 1440) * 60000)
  }));
  console.log('Seeding 10,000 posts…');
  await insertBatches('posts', posts);

  const comments = Array.from({ length: 20000 }, (_, i) => ({
    post_id: Math.floor(i / 2) + 1,
    user_id: (i * 43 + 89) % 2000 + 1,
    body: ['That landed at exactly the right time.', 'I like this way of putting it.', 'Adding this to my notes.', 'Tell me more about what you mean here.'][i % 4],
    created_at: new Date(now - (i % 30) * 86400000 - (i % 900) * 60000)
  }));
  console.log('Seeding 20,000 comments…');
  await insertBatches('comments', comments);

  const likes = [];
  for (let postId = 1; postId <= 10000; postId++) {
    for (let offset = 0; offset < 3; offset++) {
      likes.push({ user_id: ((postId * 7 + offset * 613) % 2000) + 1, post_id: postId, created_at: new Date(now - (postId % 30) * 86400000) });
    }
  }
  console.log('Seeding 30,000 likes…');
  await insertBatches('likes', likes);

  const follows = [];
  for (let follower = 1; follower <= 2000; follower++) {
    for (let step = 1; step <= 20; step++) {
      follows.push({ follower_id: follower, following_id: ((follower - 1 + step * 73) % 2000) + 1, created_at: new Date(now - (step * 11) * 86400000) });
    }
  }
  console.log('Seeding 40,000 follow relationships…');
  await insertBatches('follows', follows);
  console.log('Seed complete: 2,000 users, 10,000 posts, 20,000 comments, 30,000 likes, 40,000 follows.');
}

if (require.main === module) {
  prepareDatabase().then(seedDataset).catch((error) => { console.error('Seed failed:', error.message); process.exitCode = 1; }).finally(() => db.destroy());
}

module.exports = { seedDataset };
