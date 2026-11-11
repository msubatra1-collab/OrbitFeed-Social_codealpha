# OrbitFeed — Implementation and Design Plan

## Scope and approach

Build the requested complete social application with browser-native HTML/CSS/JavaScript and a Node.js/Express REST API. The website serves its own static client and API from one stateless Express process. The API implements registration/login/logout, user profiles, posts with optional images, comments, likes, follows, user search, Explore, and a home feed with cursor pagination. Every list has a bounded page size. SQL reads aggregate social counts instead of issuing per-post N+1 queries.

Use bcryptjs for password hashes, signed 7-day HS256 JWTs in an HttpOnly cookie, a separate double-submit CSRF cookie/header, Zod request validation, ownership checks, Helmet, gzip, `express-rate-limit`, parameterized Knex queries, and unique database constraints. The application's signing key is named `ORBITFEED_SESSION_SECRET` so it never shadows Manus's platform-owned `JWT_SECRET`/`MANUS_JWT_SECRET` aliases. For Cloud Preview's cross-site HTTPS iframe, cookies use `SameSite=None; Secure`; local plain HTTP can explicitly opt into `COOKIE_SECURE=false` through `.env`.

Use PostgreSQL through `DATABASE_URL` with a bounded `pg` pool when a reachable PostgreSQL service is available. The current project has server capability enabled but the managed Manus database (MySQL-compatible) is disabled; its storage option is not substituted for the user's explicit PostgreSQL/SQLite choice. The earlier configured Supabase hostname did not resolve in this environment, and there is no working PostgreSQL DSN available to the project. Consequently, local/test startup uses SQLite in WAL mode as the requested fallback. Production startup intentionally refuses SQLite because the hosted container filesystem is ephemeral. A durable public deployment requires a reachable PostgreSQL `DATABASE_URL` and `ORBITFEED_SESSION_SECRET`; do not claim a production deployment or PostgreSQL capacity result until configured.

Validate image type using both allowed MIME type and file signature, cap files at 5 MB, and write user uploads to platform presigned object storage using `MANUS_API_URL` / `MANUS_API_KEY` in managed runtime. Save the stable `/manus-storage/<key>` address and key, not a short-lived presign URL. Local development without platform storage uses a local-only upload directory; production rejects that fallback.

## Project structure

- `server.js`: Express bootstrap, secure headers, compression, API/static routing, `/healthz`, startup migrations, and graceful shutdown.
- `src/routes/api.js`: REST route map, authentication gates, CSRF protection, and auth rate limits.
- `src/controllers/api.js`: account, profile, feed, post, comment, like, follow, search, and image-upload endpoint behavior.
- `src/middleware/security.js`: JWT cookie sessions, double-submit CSRF, auth helpers, and common JSON errors.
- `src/middleware/validation.js`: Zod schemas and bounded image upload parser.
- `src/db/knex.js`: PostgreSQL/SQLite selection, bounded pool, SQLite WAL pragmas, and migration execution.
- `src/db/migrations/001_initial.js`: users, posts, comments, likes, follows, cascading foreign keys, uniqueness, and indexes.
- `src/models/social.js`: bounded cursor pagination, profile/feed queries, and aggregated counts.
- `src/services/storage.js`: image signature checks, platform presigned upload, and local-only development fallback.
- `public/`: `index.html`, mobile-first editorial-zine design, dark/light theme, vanilla app logic, favicon, and route manifest.
- `scripts/`: local startup, migration runner, isolated dataset seed, and isolated API test runner.
- `tests/`: API tests against a disposable SQLite database; never run them against real project data.
- `load/`: 300-connection mixed-endpoint workload and generated result summary.
- `Dockerfile`, `.env.example`, `README.md`, and `TODO.md`: deployment shell, configuration guide, operator instructions, and requirement tracking.

## Design direction

மூன்று visual directions சுருக்கமாக மதிப்பீடு செய்யப்பட்டன: **neo-editorial social zine** (0.06), **utilitarian monochrome terminal** (0.03), **soft skeuomorphic diary** (0.02). தேர்ந்தெடுத்தது: **neo-editorial social zine**.

- **Design Movement:** சமகால editorial typography-யையும் independent print-magazine composition-ஐயும் இணைக்கும் வடிவம்.
- **Core Principles:** வாசிக்க எளிதான feed; அளவான ஆனால் தனித்துவமான typography; போதிய whitespace; ஒவ்வொரு action-க்கும் உடனடி feedback.
- **Color Philosophy:** வெப்பமுள்ள paper மற்றும் ஆழமான ink நீண்ட வாசிப்புக்கு ஏற்றவை; cobalt action-களை அடையாளப்படுத்தும்; கட்டுப்படுத்தப்பட்ட citrus highlight புதிய/செயலில் உள்ள அம்சங்களைச் சுட்டும். Dark mode தூய கருப்புக்கு பதிலாக charcoal பயன்படுத்தும்.
- **Layout Paradigm:** desktop-ல் மெல்லிய navigation rail, குறுகிய reading column, people-search rail; mobile-ல் இவை compact header மற்றும் கீழ் navigation-ஆக மாறும்.
- **Signature Elements:** பெரிய issue-style section headings; மெலிந்த editorial rules மற்றும் cobalt buttons; CSS/SVG orbit mark மற்றும் citrus accent.
- **Interaction Philosophy:** like/follow-கள் தெளிவான, மீண்டும் மாற்றக்கூடிய actions; loading/empty/error நிலைகள் வெளிப்படையாக இருக்கும்; keyboard focus காட்டப்படும்.
- **Animation:** cards மெதுவாகத் தோன்றுதல் மற்றும் குறுகிய hover/reaction transitions மட்டும்; தொடர்ச்சியான அலங்கார இயக்கமில்லை; `prefers-reduced-motion` மதிக்கப்படும்.
- **Typography System:** DM Sans UI மற்றும் DM Serif Display headings; responsive அளவுகள், uppercase metadata, body content-க்கு தெளிவான வாசிப்பு அளவு.
- **Brand Essence:** அன்றாட உரையாடல்களுக்கு அமைதியான, வெளிப்பாட்டுள்ள social corner; **curious, warm, direct**.
- **Brand Voice:** இயல்பான, குறிப்பான microcopy. எடுத்துக்காட்டுகள்: “What’s on your mind?” மற்றும் “A good conversation starts somewhere.”
- **Wordmark & Logo:** orbit-and-speech motif கொண்ட CSS/SVG mark-ஐ OrbitFeed wordmark-உடன் இணைத்தல்; default-font wordmark மட்டும் அல்ல.
- **Signature Brand Color:** தனித்துவமான electric cobalt.

## Serving, runtime, and dependencies

Pin Node and pnpm; use Express, Knex, `pg`, `better-sqlite3`, bcryptjs, jsonwebtoken, cookie-parser, dotenv, Helmet, express-rate-limit, compression, Multer, Zod, supertest, and autocannon. Production reads database and app-owned session secrets at runtime; credentials are never embedded in client code or used during the image build. The app serves on `PORT` (default 3000) and `0.0.0.0`, uses relative browser URLs, and serves the `/manus-routes.json` page manifest. Docker exposes port 3000 and reports readiness via `/healthz`. The application schema is created through a deterministic Knex migration; the isolated seed script is never invoked during ordinary app startup.

## Delivery boundary

The local SQLite path, API tests, and local benchmark are executable without external database credentials. The requested production guarantee (durable records and proof for 300 concurrent users) cannot be established using an ephemeral container filesystem or a local SQLite benchmark. Configure a reachable production PostgreSQL URL and app-owned signing secret through the protected project-secret flow before publishing; then re-run the workload against an isolated PostgreSQL database and durable project image storage.
