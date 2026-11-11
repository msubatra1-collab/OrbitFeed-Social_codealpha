'use strict';

exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS posts_user_created_idx');
  await knex.raw('CREATE INDEX IF NOT EXISTS posts_user_created_desc_idx ON posts (user_id ASC, created_at DESC)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS posts_user_created_desc_idx');
  await knex.raw('CREATE INDEX IF NOT EXISTS posts_user_created_idx ON posts (user_id ASC, created_at ASC)');
};
