# Nerio

Next.js (App Router) port of the Nerio design prototypes: the reader site, the admin pipeline, the design-system reference and a breakpoints canvas.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
```

## Routes

| Route | Screen |
| --- | --- |
| `/` | Home: hero carousel, continue reading, trending, updates, genres |
| `/browse` | Catalog: search, genre/status filters, sort, pagination (`?q=&genre=&status=&sort=&page=`) |
| `/series/[id]` | Series detail and chapter list (`id` is the series slug) |
| `/read/[id]/[ch]` | Reader (shortcuts: ← → J K Space F S C H ? Esc) |
| `/profile?tab=…` | Overview, bookmarks, history, following, notifications, achievements, settings (`&page=N` on list tabs) |
| `/premium` | Bank-transfer Premium flow (info → pending → confirmed) |
| `/login`, `/register` | Sign in and create an account (`?next=` returns you to the page you came from) |
| `/admin/*` | Dashboard, series, chapters, upload, processing, translation queue, review (`/admin/review/[jobId]`), users & payments, reports, settings, audit log |
| `/admin/series/new`, `/admin/series/[id]` | Series editor: title, slug, alternative titles, description, author, artist, status, genres, tags, cover |
| `/admin/chapters?series=…`, `/admin/chapters/new`, `/admin/chapters/[id]` | Chapter list and editor: number, title, access, draft/published, publication date (future = scheduled), pages |
| `/design-system` | Tokens and component reference |
| `/breakpoints` | Live iframes of key screens at common widths |

## Structure

- `lib/catalog.ts`: client-safe display helpers for catalog DTOs (covers, status labels, number/time formatting).
- `lib/data.ts`: the original mock catalog, now only used by `npm run db:seed` and the design-system page.
- `components/ui.tsx`: shared primitives (Button, IconButton, Cover, Segmented, Switch, toasts).
- `components/site/*`: reader site; `store.tsx` holds the signed-in viewer, optimistic bookmark state, reader prefs and the (still mock) Premium payment flow.
- `components/admin/*`: admin screens, fed by server components under `app/admin/*`; `store.tsx` only holds toasts.
- `app/globals.css`: design tokens and shared classes. Area styles are in `app/(site)/site.css` and `app/admin/admin.css`.

Home, browse, search, series pages, the reader and the admin series/chapter screens read the database. The remaining screens still use mock data from `lib/`.

### Content

- **Images:** `series.cover_key` and `chapter_pages.source_key` hold either a public `https://` URL (entered in the admin) or an object-storage key. `server/storage.ts` resolves them; storage keys resolve to nothing until object storage is added, and the UI falls back to the generated cover / an empty page slot.
- **Chapter ZIP ingestion:** editors can upload numbered chapter ZIPs from `/admin/upload`. The server validates the ZIP signature and size, rejects unsafe entries, naturally sorts numbered image names, validates/decodes dimensions, normalizes orientation into high-quality PNG, and persists page metadata plus an idempotent processing job. `server/storage.ts` currently uses private local disk storage (`NERIO_STORAGE_DIR`); `/api/media/*` only serves images for published chapters or to editors. Configure limits with the `CHAPTER_*` variables in `.env.example`. Apply migration `0008_chapter_ingestion.sql` before using ZIP upload.
- **AI translation and typesetting pipeline:** editors run queued work from `/admin/processing`. Jobs move through queued, validating, processing images, OCR, translating, cleaning, typesetting, QA, then ready, published, or failed. Replaceable OCR, translation and image cleanup interfaces default to mock providers. After translation, the worker lays out Mongolian Cyrillic with the bundled OFL Noto Sans font, checks visual QA, and stores a lossless delivery PNG separately from the original master image. Configure real providers in `.env.local`; the cleanup provider defaults to mock, which deliberately prevents automatic publishing. Jobs auto-publish only when every page has a valid delivery image and there are no critical or unresolved QA flags. Other jobs wait for human review at `/admin/review/[jobId]`; processing logs, failure stage, and retry are available in `/admin/processing`. Apply migrations `0009_ai_translation_pipeline.sql`, `0010_visual_typesetting.sql`, and `0011_pipeline_state_logs.sql` before processing jobs.
- **Pages:** editors paste image URLs (one per line); the browser reads each image's size before saving. Pages can be reordered (drag or arrows, then *Save order*) and removed; page numbers are rewritten atomically.
- **Publishing:** a chapter is visible when `status = 'published'` and `published_at <= now()`, so a future date schedules it. Followers are notified when a chapter first goes live (scheduled chapters notify at save time only if already due).
- **Search:** title, author, artist, alternative titles and tag names, case-insensitive (`pg_trgm` indexes on title and author). `/api/search` serves the search overlay; `/api/series/[slug]/chapters` pages the chapter list.
- **Reader:** pages render as boxes with each image's exact aspect ratio, so nothing shifts while images arrive. Only the page under the reader, one page above and a lookahead below are loaded (4 pages; 2 on 3G, 1 with Save-Data/2G). Images are the uploaded originals (no recompression). Near the end of a chapter the next chapter's route and first two images are prefetched. Failed images retry twice with backoff, then offer a manual retry; errored pages also retry when the browser comes back online.
- **Reading progress:** saved per user and series (`reading_progress`: page, position within the page in ‰, percent) via `POST /api/progress`, debounced (2 s idle, at most every 15 s) and flushed with `sendBeacon` when the tab hides or closes. Reopening a chapter resumes at the saved position; signed-out readers resume from `localStorage`. Finished chapters reopen at the top.
- **Library:** bookmarks, follows (with per-series alert toggle), reading history, continue reading, notifications and the profile stats are read from the database by `server/data/library.ts`, `reading.ts` and `notifications.ts`. Every function scopes to the session's user (no user-id parameters), and mutations go through `server/actions/library.ts`. The profile page loads only the active tab, paginated. Achievements are derived from the same counts. Reader settings (width, gap, background, auto-hide) sync to `profiles.reader_settings`; signed-out readers keep them in `localStorage`.
- **Series deletion** is a soft delete (`deleted_at`); chapter and page deletion are hard deletes.

## Backend

PostgreSQL, accessed through [Drizzle ORM](https://orm.drizzle.team) with the `postgres` driver. Any managed Postgres works (Neon, Supabase, RDS) as long as `DATABASE_URL` points at it.

```bash
cp .env.example .env.local   # set DATABASE_URL
npm run db:migrate           # apply server/db/migrations
npm run db:seed              # optional: load the mock catalog (dev only)
npm run typecheck && npm run lint && npm run build
```

### Layout

| Path | Runs on | Purpose |
| --- | --- | --- |
| `server/env.ts` | server | The only reader of secret env vars (zod-validated, lazy). |
| `server/db/schema/*` | server | Tables, enums, indexes, check constraints, relations. |
| `server/db/migrations/*` | n/a | SQL migrations generated by drizzle-kit and committed. `0001_seed_roles.sql` inserts the fixed roles. |
| `server/db/client.ts` | server | Lazy pooled client. One pool is reused across dev hot reloads. |
| `server/auth/*` | server | Sessions, password hashing, rate limits, `getCurrentActor`/`requireRole`, page guards. See [Authentication](#authentication). |
| `server/actions/*` | server | Server Actions behind the forms (`'use server'`). |
| `server/data/*` | server | Data access layer: validates input, checks authorization, returns minimal DTOs, and writes audit rows in the same transaction. |
| `lib/validation` | both | Zod input schemas. Client forms can reuse them, and the server always re-validates. |

Every `server/` module imports `server-only`, so importing one from a Client Component fails the build. Pages and Server Actions should call `server/data/*` only, never `db()` directly. Only `NEXT_PUBLIC_*` variables reach the browser.

### Tables

`users`, `profiles` (1:1), `roles` + `user_roles`; `series`, `genres` + `series_genres`, `tags` + `series_tags`, `chapters`, `chapter_pages`; `reading_progress` (one row per user and series), `reading_history` (one row per user and chapter), `bookmarks`, `follows`, `notifications`; `translation_jobs`, `translation_segments`, `glossary_terms`, `characters`; `payment_records`; `admin_audit_logs` (append-only).

Conventions:

- UUID primary keys, except bigint identity keys on the high-volume logs.
- `created_at` and `updated_at` are `timestamptz`.
- Money is stored in cents.
- Storage keys stay server-side.
- Uniqueness is case-insensitive for emails and usernames.
- Notification links must be relative, which blocks open redirects.

Premium is paid by bank transfer; readers get a reference code and an admin confirms the transfer, which extends `profiles.premium_until`. Prices are fixed server-side in `server/data/billing.ts`.

### Admin

| Area | Data | Audited actions |
| --- | --- | --- |
| Dashboard | `server/data/dashboard.ts` (series, chapters, users, jobs, reviews, payments, reports, reads per day, top series) | — |
| Series, chapters, upload | `server/data/catalog.ts` | `series.*`, `chapter.*` (create, update, delete, publish, upload, pages) |
| Processing, queue, review | `server/data/pipeline.ts` | `translation_job.create/retry/cancel`, `review.send_back`, `review.publish` |
| Users & payments | `server/data/account.ts`, `billing.ts` | `user.role.grant/revoke`, `user.suspend/reactivate`, `payment.confirm/reject` |
| Reports | `server/data/reports.ts` (readers file them from the end of a chapter) | `report.resolve/dismiss` |
| Settings | `server/data/settings.ts` (`app_settings`, validated per key, defaults when unset) | `settings.update` with before/after values |
| Audit log | `server/data/audit.ts` | read-only, filter by area or actor |

Every admin page calls `requireAdminPage`, and every DAL function checks the role again (`requireRole`): `editor` for content and the pipeline, `translator` for segment review, `admin` for users, payments, settings and the audit log. Audit rows are written in the same transaction as the change. Suspending a user deletes their sessions. Resolving a report, confirming or rejecting a payment, and publishing a chapter notify the affected readers.

`server/db/sql.ts` exports `outer()`. Use it when a correlated subquery in a select field references the outer table: Drizzle renders a bare column there as an unqualified name, which the subquery resolves against its own table.

## Authentication

Email/password accounts and Sign in with Google, both backed by database sessions. No auth SDKs are used.

- **Passwords:** hashed with scrypt (N=2^15, r=8, p=3) and a random salt. The parameters are stored with each hash, so they can be raised later and old hashes upgrade on the next login. Passwords must be 8–128 characters.
- **Sessions:** the cookie holds a random 256-bit token, and the `sessions` table stores only its SHA-256 hash. The cookie is `__Host-nerio_session` (in dev: `nerio_session`), with HttpOnly, Secure, SameSite=Lax and Path=/. Sessions last 30 days and slide forward while in use. Logging in always issues a new token, and logging out deletes the session row on the server.
- **Roles:** registration always assigns `reader`. Roles are read from the database on every request and never from the cookie or the form. Grant the first admin from the command line:

  ```bash
  npm run auth:role -- grant admin you@example.com
  ```

- **Route protection:** `proxy.ts` redirects signed-out visitors away from `/profile` and `/admin` without querying the database. This check is optimistic only. The real checks run on the server:
  - `requireUserPage` and `requireAdminPage` in the pages and layouts;
  - `requireActor` and `requireRole` in every Server Action and DAL function.
- **Admin pages:** non-admins get a 404, so the admin area isn't revealed to them.
- **IDOR:** functions that touch the current user's data take no user id. They use the session's user, and form fields beyond the expected ones are ignored.
- **Google:** `/auth/google` starts an OpenID Connect authorization-code flow with PKCE (S256), `state` and `nonce`. `/auth/google/callback` checks the ID token's issuer, audience, expiry, nonce and `email_verified`, then:
  - an existing Google link signs into that account;
  - a matching email links to the existing account;
  - otherwise a new `reader` account is created.

  Accounts are linked by Google's stable `sub` id, never by email alone. If the matching account's email was never verified, its password and sessions are revoked when it's linked, so someone who pre-registered your address loses access. To set it up, create a Web OAuth client in Google Cloud Console with the redirect URI `<NEXT_PUBLIC_APP_URL>/auth/google/callback`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The button stays hidden until both are set.
- **Brute force:** login is limited to 10 attempts per email and 50 per IP per 15 minutes, and registration to 10 per IP per hour. The counters live in Postgres (`auth_rate_limits`). Unknown emails take as long as wrong passwords and return the same message.
- **CSRF:** Next.js rejects Server Action posts whose Origin doesn't match the host, and the cookie is SameSite=Lax.

Not built yet: email verification, password reset and changing your email address, since all of these need an email provider. Until verification exists, registration reveals whether an email address is already registered.

### Changing the schema

1. Edit `server/db/schema/*`.
2. Run `npm run db:generate -- --name <change>` and review the generated SQL.
3. Commit the migration, then run `npm run db:migrate` in each environment.

Use `npm run db:check` to verify that the migrations are consistent. Don't use `drizzle-kit push` against shared databases.
