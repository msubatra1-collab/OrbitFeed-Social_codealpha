'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.bigIncrements('id').primary();
    table.string('username', 30).notNullable().unique();
    table.string('email', 254).notNullable().unique();
    table.string('display_name', 60).notNullable();
    table.string('password_hash', 100).notNullable();
    table.string('bio', 160).notNullable().defaultTo('');
    table.string('avatar_url', 2048);
    table.string('avatar_key', 256);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['username'], 'users_username_idx');
  });

  await knex.schema.createTable('posts', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('body', 500).notNullable();
    table.string('image_url', 2048);
    table.string('image_key', 256);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'created_at'], 'posts_user_created_idx');
    table.index(['created_at', 'id'], 'posts_created_id_idx');
  });

  await knex.schema.createTable('comments', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('post_id').notNullable().references('id').inTable('posts').onDelete('CASCADE');
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('body', 500).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['post_id', 'created_at'], 'comments_post_created_idx');
  });

  await knex.schema.createTable('likes', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.bigInteger('post_id').notNullable().references('id').inTable('posts').onDelete('CASCADE');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'post_id'], 'likes_user_post_unique');
    table.index(['post_id'], 'likes_post_idx');
  });

  await knex.schema.createTable('follows', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('follower_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.bigInteger('following_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['follower_id', 'following_id'], 'follows_pair_unique');
    table.index(['follower_id'], 'follows_follower_idx');
    table.index(['following_id'], 'follows_following_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('follows');
  await knex.schema.dropTableIfExists('likes');
  await knex.schema.dropTableIfExists('comments');
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('users');
};
