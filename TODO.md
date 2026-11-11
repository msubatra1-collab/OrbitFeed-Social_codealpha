# OrbitFeed delivery outcomes

## 1. Complete responsive web client
- [x] Frontend: HTML, CSS, vanilla JavaScript only (no frameworks). Responsive, mobile-first, clean modern UI with a dark/light toggle.
- [x] It must be fully working end to end, with no placeholders, no mock data in the code, and no coming soon features. The client and API are implemented and serve in Preview; the production URL remains gated below.
- [x] Provide working Home feed, Explore, user search, profile, navigation, and loading/error/empty states on desktop and mobile. Desktop and 375px mobile layouts were visually inspected.

## 2. Authentication and user profiles
- [x] Authentication: register, login, logout. Passwords hashed with bcrypt, sessions via JWT in httpOnly cookies. Validate all input.
- [x] User profiles: username, display name, bio, avatar upload, join date, follower/following counts, a list of the user's posts. Users can edit their own profile.
- [x] Security: XSS-safe output escaping, CSRF protection, and authorization checks so users can only modify their own content.

## 3. Posts, image uploads, comments, likes, and follows
- [x] Posts: create, edit, delete own posts (text up to 500 chars, optional image upload with size/type validation).
- [x] On the signed-in user's empty profile, “Write the first post” must focus a working composer; after submitting, the new post appears on that profile and its post count updates.
- [x] Comments: add, delete own comments on any post. Show comment count.
- [x] Likes: like/unlike posts (one like per user per post, enforced by a DB unique constraint). Show like counts and whether the current user has liked.
- [x] Follow system: follow/unfollow users, followers/following lists, no self-follow, no duplicate follows.

## 4. Home feed, Explore, pagination, and capacity
- [x] Home feed: posts from followed users plus own posts, newest first, with cursor-based pagination and infinite scroll. Also an Explore page with all recent posts and a user search box.
- [ ] It must comfortably support at least 2,000 registered users and a few hundred concurrent users in Production; local SQLite fallback test evidence is below, but PostgreSQL capacity is not yet verified.
- [x] Paginate every list endpoint (never return unbounded results).
- [x] Avoid N+1 queries; use JOINs or aggregated queries for counts.
- [x] Add gzip compression, caching headers for static assets, and lazy-loaded images.
- [x] Rate limiting (express-rate-limit) and helmet for security headers.
- [x] Stateless server so it can run multiple instances.

## 5. Database, migrations, and query integrity
- [x] Database: PostgreSQL (use SQLite in WAL mode only if PostgreSQL is not available in the environment). Use a migration script to create the schema. PostgreSQL adapter and deterministic migrations are implemented; this environment has no reachable PostgreSQL DSN, so Preview/tests used the permitted SQLite WAL fallback.
- [x] Tables: users, posts, comments, likes, follows.
- [x] Proper foreign keys with ON DELETE CASCADE.
- [x] Unique constraints on (user_id, post_id) for likes and (follower_id, following_id) for follows.
- [x] Indexes on posts(user_id, created_at DESC), comments(post_id, created_at), likes(post_id), follows(follower_id), follows(following_id), users(username).
- [x] Use a connection pool. PostgreSQL pool is bounded; SQLite uses its serialized local connection.
- [x] Security: Parameterized queries only (no SQL injection).

## 6. Isolated seed data and 300-concurrent-user workload
- [x] Write a seed script that creates 2,000 users, 10,000 posts, 20,000 comments, 30,000 likes, and realistic follow relationships. Keep it separate from app code. The isolated run created 40,000 follow edges.
- [x] Run a load test (autocannon or k6) simulating 300 concurrent users on the feed, post, like, and comment endpoints. Report average latency and error rate, and fix any bottleneck found. Local SQLite WAL result: 300 connections / 15 sec; 3,512 requests; measured 234.14 requests/sec; average latency 143.44 ms, p50 80 ms, p99 746 ms; 0 errors, timeouts, or non-2xx responses; 0% error rate. This is not a production PostgreSQL capacity claim.

## 7. Automated API tests
- [x] Write automated API tests for auth, posts, comments, likes, and follows. The suite also checks profile ownership, search cursor pages, malformed cursors, fake image uploads, and pagination.

## 8. Production delivery and documentation
- [ ] Deploy the app and provide a public URL. Production is held until a reachable PostgreSQL URL and app-owned signing secret are supplied; the container intentionally refuses ephemeral SQLite.
- [x] Clean project structure (routes, controllers, models, middleware, public/).
- [x] README with setup steps, environment variables, API endpoint list, and database schema.
- [x] A short summary of the load test results is recorded in `load/results.md`.
- [x] Do not skip any feature, do not simplify to a demo, and do not ask me questions.

## Known production gate

- [ ] Configure a reachable PostgreSQL `DATABASE_URL` and app-owned `ORBITFEED_SESSION_SECRET` for Production through the protected project-secret flow; confirm runtime media storage before publishing. The Manus media API credentials are present in the development environment, but an upload object was not created during validation.
- [ ] Re-run the 300-concurrent-user workload against isolated PostgreSQL and record its results separately from the local SQLite fallback benchmark.
