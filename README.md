# OrbitFeed Social

OrbitFeed is a mobile-first mini social platform built with vanilla HTML/CSS/JavaScript, Node.js, Express, and a SQL data layer. It includes accounts, editable profiles, image uploads, posts, comments, likes, follows, cursor-paginated home and Explore feeds, user search, theme switching, API tests, and isolated seed/load tooling.

## Requirements

- Node.js 20 or newer and pnpm 11.25.0.
- For production, a reachable PostgreSQL database exposed as `DATABASE_URL` with the TLS settings required by that provider.
- Webdev's server runtime for hosted use. User media uploads use platform project storage when the server runtime supplies `MANUS_API_URL` and `MANUS_API_KEY`.

SQLite in WAL mode is used only as a local/test fallback when PostgreSQL is not configured. Hosted containers have temporary filesystems, so production startup intentionally refuses SQLite rather than risk losing account data. Do not treat the local fallback as a persistent production database.

## Project structure

- `src/routes/` — REST route map and middleware wiring.
- `src/controllers/` — request validation, authorization, and endpoint orchestration.
- `src/models/` — feed/profile/search queries and aggregated database reads.
- `src/db/` — PostgreSQL/SQLite connection setup and repeatable migrations.
- `src/middleware/` — JWT sessions, CSRF protection, input validation, and common errors.
- `src/services/` — durable platform image storage and local-only media support.
- `public/` — vanilla-JS client, styles, HTML shell, favicon, and page-route manifest.
- `scripts/`, `tests/`, and `load/` — migration/seeding, isolated API tests, and load testing.

## Local setup

```bash
corepack enable
pnpm install
cp .env.example .env
```

For local sessions that survive server restarts, set the app-owned signing key (at least 32 bytes). `pnpm dev` generates a process-only key if this variable is unset; that temporary key invalidates local sessions when the process restarts. Production must use a stable protected secret.

```bash
export ORBITFEED_SESSION_SECRET="$(openssl rand -hex 32)"
```

For local HTTP, set `COOKIE_SECURE=false` in `.env`. This setting must not be used for public HTTPS. Then start the app:

```bash
pnpm dev
```

Open `http://localhost:3000`. The server runs the additive Knex migration at startup. If `DATABASE_URL` is absent, it creates `data/orbitfeed.sqlite` and enables foreign keys, WAL journaling, and a busy timeout. `pnpm migrate` runs the migration separately.

For PostgreSQL, set `DATABASE_URL` to a PostgreSQL DSN before startup. The application uses a bounded Knex/pg connection pool. The default pool maximum is 10 and can be changed with `DB_POOL_MAX`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Production PostgreSQL connection string. If absent outside production, the app uses SQLite WAL. |
| `DB_POOL_MAX` | Maximum pooled PostgreSQL connections; defaults to 10. |
| `SQLITE_FILE` | Path to the local/test SQLite file. |
| `ORBITFEED_SESSION_SECRET` | Application-owned HS256 signing secret, at least 32 bytes. Required in all server runs; deliberately distinct from Manus's platform-owned `JWT_SECRET`. |
| `COOKIE_SECURE` | Defaults to secure cookies and `SameSite=None`; set `false` only for local plain HTTP. |
| `PORT` / `HOST` | Server bind settings; defaults to `3000` / `0.0.0.0`. |
| `MANUS_API_URL` / `MANUS_API_KEY` | Provided by the Manus server runtime for durable user-image storage. Never put these in browser code. |

The platform's OAuth/session key is not used for OrbitFeed's explicit email/username-and-password login. OrbitFeed uses its own `orbitfeed_session` cookie.

Login and signup protection counts up to 10 unsuccessful attempts per normalized sign-in identifier (or signup email/handle pair) over 15 minutes. Successful authentication and `/api/auth/me` session checks do not consume that limit, so one busy shared network cannot lock out every account.

## API

All JSON endpoints are rooted at `/api`. Mutating requests require a `x-csrf-token` header matching the `orbitfeed_csrf` cookie. Fetch `GET /api/auth/csrf` first; the client helper does this automatically. Session cookies are HttpOnly. Every list endpoint, including people search, is bounded and cursor-paginated, with a `limit` capped at 30.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/auth/csrf` | Issue a CSRF token/cookie. |
| `POST` | `/api/auth/register` | Create an account and sign in. |
| `POST` | `/api/auth/login` | Sign in with email or username. |
| `POST` | `/api/auth/logout` | Clear the session cookie. |
| `GET` | `/api/auth/me` | Return the current account or `null`. |
| `GET` | `/api/feed` | Authenticated feed: followed accounts plus own posts. |
| `GET` | `/api/explore` | Public recent posts. |
| `GET` | `/api/users/search?q=...&limit=...&cursor=...` | Search usernames and display names, ordered by username, with an optional cursor for the next page. |
| `GET` | `/api/users/:username` | Public profile and paginated posts. |
| `PATCH` | `/api/users/me` | Edit own display name, bio, or avatar. |
| `GET` | `/api/users/:username/followers` | Paginated followers. |
| `GET` | `/api/users/:username/following` | Paginated accounts followed. |
| `POST` / `DELETE` | `/api/users/:username/follow` | Follow or unfollow; no self-follow or duplicates. |
| `POST` | `/api/uploads` | Upload a JPEG, PNG, WebP, or GIF up to 5 MB. Multipart field: `image`. |
| `POST` | `/api/posts` | Create a post of 1–500 characters; optional uploaded image URL/key. |
| `PATCH` / `DELETE` | `/api/posts/:id` | Edit or delete own post. |
| `GET` / `POST` | `/api/posts/:id/comments` | Paginated comments / create a reply. |
| `DELETE` | `/api/comments/:id` | Delete own comment. |
| `POST` / `DELETE` | `/api/posts/:id/like` | Idempotent like / unlike. |
| `GET` | `/healthz` | Unauthenticated readiness check. |

## Database schema

Knex migration `src/db/migrations/001_initial.js` creates five tables; `002_posts_user_created_desc.js` applies the requested descending timeline index. `users` contains normalized unique username/email, display name, bcrypt-compatible password hash, bio, avatar address, and join timestamp. `posts` references users and stores body, optional image, and timestamps. `comments` references posts and users. `likes` has a unique `(user_id, post_id)` constraint. `follows` has a unique `(follower_id, following_id)` constraint. All relationships cascade on parent deletion. Indexes cover username, `posts(user_id, created_at DESC)`, recent post ordering, comments by post/time, likes by post, and both follow directions.

The app aggregates like/comment/follow counts in bounded SQL queries and avoids per-post N+1 queries. User text is treated as text in the browser; server-side validation and authorization apply before writes.

## Seed, tests, and load test

The seed script is separate from app startup and refuses non-SQLite, production, or non-empty databases. Point it at a fresh temporary file and explicitly allow the run:

```bash
NODE_ENV=test SQLITE_FILE=/tmp/orbitfeed-seed.sqlite SEED_ALLOW=yes SEED_PASSWORD='Local-only-seed-pass-2026' pnpm seed
```

It creates 2,000 users, 10,000 posts, 20,000 comments, 30,000 likes, and 40,000 follow edges. The default test command creates its own disposable SQLite DB and exercises account, ownership, post, comments, likes, follows, profile, and pagination paths:

```bash
pnpm test
```

The load harness seeds a disposable SQLite file and runs 300 concurrent connections for 15 seconds against feed reads, post creates, likes, and comments:

```bash
pnpm load
```

It writes `load/results.md` and `load/results.json`. The harness elevates the general per-IP rate limit only for its local loopback run because all virtual clients share one IP. This fallback-path result is not production/PostgreSQL capacity proof; repeat the workload against an isolated PostgreSQL environment before making production capacity claims.

## Security and deployment

`helmet`, gzip compression, API and authentication rate limits, input schemas, CSRF double-submit tokens, parameterized Knex queries, session-cookie safeguards, ownership checks, image MIME/signature checks, upload size limits, and the unique constraints enforce the core safety rules. Public HTTPS cookies use `Secure; SameSite=None`; plain local HTTP uses `COOKIE_SECURE=false`. The application's `ORBITFEED_SESSION_SECRET` is separate from the platform-owned `JWT_SECRET` and `MANUS_JWT_SECRET` values.

Production uses Docker on port 3000 and `GET /healthz`. It requires PostgreSQL via `DATABASE_URL`; it does not run on ephemeral SQLite. Uploaded images use the platform's stable project storage address in hosted runtime. Replaced/deleted image records are removed from the app's view; the runtime storage interface does not expose object deletion, so physical cleanup is not promised.

Before publishing, configure a reachable PostgreSQL `DATABASE_URL`, a strong app `ORBITFEED_SESSION_SECRET`, and confirm that the project server runtime receives the documented media-storage credentials. Until then, local Preview works with SQLite fallback, but public production deployment and the required production-like 300-concurrent-user load report are not claimed as complete.
