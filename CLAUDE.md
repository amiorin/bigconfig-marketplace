# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

A marketplace for "bigconfig" packages and ONCE-compatible applications, built as a single Docker image that bundles a PocketBase backend with a statically-built Astro frontend served from `pb_public`.

- **`web/`** — Astro 6 static site (Tailwind v4 via PostCSS plugin). `astro.config.mjs` outputs to `../pocketbase/pb_public` so `astro build` writes directly into PocketBase's static-serve directory. Talks to PocketBase at `PUBLIC_PB_URL` via the `pocketbase` JS SDK (`web/src/lib/pb.ts`).
- **`pocketbase/`** — PocketBase v0.23+ (tested on v0.37.4). Schema is defined in `pb_migrations/`; server-side logic lives in `pb_hooks/` as JSVM scripts.
- **`Caddyfile`** — Dev reverse proxy: `/api*` and `/_*` to PocketBase (`:8090`), everything else to the Astro dev server (`:4321`).
- **`Caddyfile.prod`** — Production Caddy config copied into the image as `/etc/caddy/Caddyfile`. Listens on `:80`, serves `GET /up` for ONCE, and reverse-proxies everything else to PocketBase on `:8090`.
- **`Procfile`** — Runs `pb` (via `entrypoint.dev.sh`, which wraps PocketBase in Litestream), `web` (astro dev), and `caddy` together via `hivemind`.
- **`Procfile.prod`** — Production process list copied into the image as `/app/Procfile`: Caddy plus `entrypoint.sh`.
- **`entrypoint.sh`** — Production entrypoint. Creates `/storage/pb_data`, restores SQLite from Litestream if needed, optionally upserts a PocketBase superuser with explicit production directories, then runs PocketBase under `litestream replicate -exec`. Sets `LITESTREAM_DB_PATH=/storage/pb_data/data.db` for `litestream.yml` to consume.
- **`entrypoint.dev.sh`** — Dev counterpart. `cd`s into `pocketbase/`, sets `LITESTREAM_DB_PATH=$PWD/pb_data/data.db`, runs the same `litestream restore -if-db-not-exists -if-replica-exists` then `litestream replicate -exec "pocketbase serve --dev"`. Exercises the prod boot path locally against each developer's S3 dev bucket.
- **`litestream.yml`** — S3 replica config; `path:` is parameterized as `${LITESTREAM_DB_PATH}` so dev and prod share one config. The entrypoint scripts set `LITESTREAM_DB_PATH` per-environment.
- **`Dockerfile`** — Two stages: build the Astro site with `PUBLIC_PB_URL` baked in (default `https://localhost`), then assemble an ONCE-compatible Alpine image with latest Caddy, PocketBase, Litestream, Hivemind, migrations, hooks, and the built static site.
- **`plans/`** — Numbered markdown planning documents capturing design decisions.

## Data Collections

### Packages collection

`pb_migrations/1714000000_init_packages.js` defines the `packages` collection. Reading the rules and `pb_hooks/packages.pb.js` together is required to understand the submission flow:

- **Submission flow**: a signed-in user POSTs `{ github_url, description, tags }`. `onRecordCreateRequest` derives `name` from the URL via `parseGithubName`, force-sets `status = "pending"`, `stars = 0`, `submitter = e.auth.id`. After save, `onRecordAfterCreateSuccess` calls the GitHub API to enrich `description`, `stars`, `default_branch`, `pushed_at`, `og_image`.
- **Protected fields** (`pb_hooks/utils.js` `PROTECTED_FIELDS`): non-superusers cannot modify `github_url`, `name`, `submitter`, `status`, `stars`, `default_branch`, `pushed_at`, `og_image` — `onRecordUpdateRequest` reverts them from `original()`. Only superusers (admins) approve packages by flipping `status` to `approved`.
- **List/view rules** restrict visibility to approved records OR the submitter's own records, so unapproved submissions are private to the submitter.
- **Static site rebuild**: `dispatchRebuild()` POSTs a `repository_dispatch` (`event_type: rebuild-site`) to `DISPATCH_REPO`. No workflow is committed here yet; when CI is added, wire it to that event. Requires `DISPATCH_REPO` and `DISPATCH_PAT` env vars; otherwise it logs and skips. Triggers fire on approved-record create, any update, approved-record delete, and a nightly cron (`0 3 * * *`) that refreshes GitHub stats.

**Fields:** `github_url` (unique), `name` (unique), `description`, `tags` (max 10), `submitter` (relation to users), `status` (pending/approved/rejected), `stars`, `default_branch`, `pushed_at`, `og_image`, timestamps.

### Applications collection

`pb_migrations/1778200000_init_applications.js` mirrors `packages` with one addition:

- **Extra required field**: `docker_image` (unique) — the fully-qualified Docker image reference (e.g. `registry/repo:tag`). Defaults to Docker Hub if registry is omitted.
- **Submission flow**: a signed-in user POSTs `{ github_url, docker_image, description, tags }`. On create, `onRecordCreateRequest` in `pb_hooks/applications.pb.js` validates the Docker image is publicly pullable via OCI Distribution token-auth before saving.
- **Protected fields**: same as packages, plus `docker_image` is also protected (cannot be changed after submission).
- **Nightly cron**: `15 3 * * *` (15 min after the packages cron) refreshes GitHub stats for approved applications.

**Validation**: `validateDockerImage()` in `utils.js` performs a token-auth challenge against the registry's `/v2/` endpoint to verify the image is accessible without authentication.

### Users collection

`pb_migrations/1777369207_updated_users.js` enables OAuth2 on the built-in `_pb_users_auth_` collection. `pb_migrations/1777370000_users_public_view.js` makes users publicly listable (empty list/view rule) so submitter names can be displayed.

## Frontend Structure (`web/src/`)

### Library files (`src/lib/`)

- **`pb.ts`** — PocketBase client singleton, `PackageRecord` and `ApplicationRecord` TypeScript types, `formatPbError()` helper.
- **`packages.ts`** — Build-time fetch of all approved packages (used by static pages).
- **`applications.ts`** — Build-time fetch of all approved applications (used by static pages).
- **`tags.ts`** — Tag group definitions (`Providers`, `Tools`, `Category`, `License`) with validation. These are the allowed tag values for both collections.

### Layouts (`src/layouts/`)

- **`Layout.astro`** — Root layout: Header, Footer, Tailwind global CSS import, radial gradient background.

### Components (`src/components/`)

- **`Header.astro`** — Sticky nav with logo, links (Packages / Applications / Documentation), and user auth menu (Google OAuth sign-in or avatar with dropdown).
- **`Footer.astro`** — Copyright and BigConfig link.
- **`PackageCard.astro`** — Card displaying package name, stars, description, tags.
- **`ApplicationCard.astro`** — Card displaying app name, stars, description, `docker_image`, tags.
- **`TagChip.astro`** — Reusable tag badge.

### Pages (`src/pages/`)

| Page | Route | Notes |
|------|-------|-------|
| `index.astro` | `/` | Hero, stats, 6 recent mixed entries |
| `packages.astro` | `/packages` | Listing with client-side search + tag filter |
| `applications.astro` | `/applications` | Listing with client-side search + tag filter |
| `packages/[owner]/[repo].astro` | `/packages/:owner/:repo` | Detail with GitHub metadata, copy-to-clipboard bb.edn agent prompt |
| `applications/[owner]/[repo].astro` | `/applications/:owner/:repo` | Detail with ONCE contract sidebar, agent prompt |
| `documentation.astro` | `/documentation` | Long-form guide on BigConfig, bb.edn, ONCE |
| `login.astro` | `/login` | Google OAuth sign-in, avatar stored to localStorage |
| `submit.astro` | `/submit` | Submit a package (GitHub URL, description, tags) |
| `applications/submit.astro` | `/applications/submit` | Submit an application (GitHub URL, docker_image, description, tags) |
| `me/packages.astro` | `/me/packages` | Authenticated dashboard: user's own package submissions with status pills |
| `me/applications.astro` | `/me/applications` | Authenticated dashboard: user's own application submissions |
| `me/edit.astro` | `/me/edit` | Edit package description/tags (github_url locked) |
| `me/applications-edit.astro` | `/me/applications-edit` | Edit application description/tags (github_url + docker_image locked) |

## PocketBase Hooks

All hooks live in `pb_hooks/`. The key constraint is that PocketBase's JSVM does **not** share top-level scope with hook callbacks — helpers from `utils.js` must be `require()`'d **inside** each callback. Never hoist requires to module top level.

### `utils.js` — shared utilities

- `PROTECTED_FIELDS` — `['github_url', 'name', 'submitter', 'status', 'stars', 'default_branch', 'pushed_at', 'og_image', 'docker_image']`
- `parseGithubName(url)` — extracts `owner/repo` from a GitHub URL.
- `fetchGithubMeta(name)` — calls GitHub API; returns `{ description, stars, default_branch, pushed_at, og_image }`.
- `dispatchRebuild()` — POSTs `repository_dispatch` to `DISPATCH_REPO` via `DISPATCH_PAT`; no-ops if env vars are absent.
- `isSuperuser(e)` — checks whether the current auth is a superuser.
- `parseDockerImage(ref)` — parses a Docker image reference into `{ registry, repository, tag }` with Docker Hub defaults.
- `validateDockerImage(ref)` — performs OCI token-auth challenge to verify the image is publicly pullable; throws on failure.
- `parseBearerChallenge(header)` — parses `WWW-Authenticate: Bearer ...` headers.

### `packages.pb.js` — packages collection hooks

| Hook | Action |
|------|--------|
| `onRecordCreateRequest` | Validates GitHub URL, sets `name`/`status`/`stars`/`submitter`, blocks unauthenticated |
| `onRecordAfterCreateSuccess` | Enriches record with GitHub metadata via `fetchGithubMeta`; dispatches rebuild if approved |
| `onRecordUpdateRequest` | Reverts protected fields to original values for non-superusers |
| `onRecordAfterUpdateSuccess` | Dispatches rebuild |
| `onRecordAfterDeleteSuccess` | Dispatches rebuild if record was approved |
| Cron `0 3 * * *` | Nightly refresh of GitHub stats for all approved packages |

### `applications.pb.js` — applications collection hooks

Mirrors `packages.pb.js` with two differences:

- `onRecordCreateRequest` also calls `validateDockerImage()` before saving.
- Nightly cron runs at `15 3 * * *` (staggered after packages).

### `google_oauth.pb.js` — Google OAuth2 provider config

`onBootstrap` reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from the environment and overwrites the Google provider on `_pb_users_auth_` via `unmarshal()`. Runs on every PocketBase start, so rotating credentials only requires a container restart. Logs and skips if either env var is unset, leaving any existing provider config untouched.

## Commands

```sh
# Dev (run all three with hivemind):
hivemind

# Or individually:
cd web && npm run dev                # Astro dev server on :4321
cd pocketbase && pocketbase serve    # PocketBase on :8090
caddy run                            # reverse proxy on :443 (localhost)

# Production build:
cd web && npm run build              # writes to ../pocketbase/pb_public

# Docker build:
docker build -t bigconfig-marketplace .

# PocketBase migrations are auto-applied on `pocketbase serve`. To create a new one:
cd pocketbase && pocketbase migrate create <name>
```

The `pocketbase` binary is gitignored — download from https://github.com/pocketbase/pocketbase/releases and place at `pocketbase/pocketbase`.

`PUBLIC_PB_URL` is inlined into the static bundle at build time and must be the absolute origin (scheme + host) where the browser will reach PocketBase. The Dockerfile defaults it to `https://localhost`; override with `--build-arg PUBLIC_PB_URL=<your-origin>` for prod. Empty or relative values make the PocketBase SDK emit page-path-relative URLs at runtime — e.g. on `/login` it calls `/login/api/...` instead of `/api/...` — which breaks Google SSO.

The runtime image is ONCE-compatible: Caddy listens on `:80`, `/up` returns `OK`, and only PocketBase data is persistent at `/storage/pb_data`. `pb_public` remains baked into `/pb/pb_public`.

Production deliberately uses different PocketBase paths than dev because ONCE-compatible applications must serve HTTP on port `80`, expose `/up`, and keep persistent data under `/storage` (see https://github.com/basecamp/once#making-a-once-compatible-application). Dev uses the default project-local layout under `pocketbase/`; production passes every PocketBase directory explicitly:

```sh
pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/storage/pb_data \
  --publicDir=/pb/pb_public \
  --hooksDir=/pb/pb_hooks \
  --migrationsDir=/pb/pb_migrations
```

Use the same explicit directory flags for `pocketbase superuser upsert`.

## Environment variables

- `PUBLIC_PB_URL` — absolute origin where the browser/SDK reaches PocketBase. Build-time, baked into the static bundle. Must not be `''` or relative (breaks Google SSO via page-path-relative URLs). Dockerfile default is `https://localhost`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials. Applied to `_pb_users_auth_` on every bootstrap by `pb_hooks/google_oauth.pb.js`; restart the container after rotating. If either is unset the hook logs and leaves the existing config untouched.
- `GITHUB_TOKEN` — optional, raises rate limit for the GitHub API enrichment in `utils.js`.
- `DISPATCH_REPO` — target repository in `owner/repo` form that receives the `repository_dispatch` event (`event_type: rebuild-site`).
- `DISPATCH_PAT` — GitHub Personal Access Token with `repo` scope on `DISPATCH_REPO`, used to POST `/repos/{owner}/{repo}/dispatches`. Without both vars `dispatchRebuild()` logs and skips.
- `LITESTREAM_BUCKET`, `LITESTREAM_PATH`, `LITESTREAM_REGION`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` — required in both the production container and local dev (the `pb` Procfile entry runs `entrypoint.dev.sh`, which invokes `litestream replicate -exec`). To run dev without Litestream, comment out the `pb:` line in `Procfile` and start PocketBase manually.
- `LITESTREAM_SYNC_INTERVAL` — required: WAL flush interval (e.g. `1s`, `10s`). `litestream.yml` substitutes it directly into `sync-interval`; an empty value fails duration parsing at startup.
- `LITESTREAM_ENDPOINT` — optional S3-compatible endpoint.
- `LITESTREAM_DB_PATH` — set automatically by `entrypoint.sh` (`/storage/pb_data/data.db`) and `entrypoint.dev.sh` (`pocketbase/pb_data/data.db`). Don't set it manually; `litestream.yml` reads it as the source DB path.
- `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` — optional; when both are set, the container upserts the PocketBase superuser on start.

## Key conventions

- **Tailwind v4**: configured via `@tailwindcss/postcss` PostCSS plugin (`postcss.config.mjs`), not `astro-tailwind`. Import with `@import "tailwindcss"` in CSS, not `@tailwind base/components/utilities` directives.
- **Static-first**: all pages are statically generated at build time (`output: 'static'`). Client-side interactivity (search, auth) is handled with vanilla JS `<script>` blocks in `.astro` files — no framework components.
- **Tag validation**: always import allowed tag values from `web/src/lib/tags.ts`. Do not hardcode tag strings in pages or components.
- **Auth state**: the PocketBase auth token is stored in `localStorage` by the PocketBase SDK. The avatar URL is stored separately as `user_avatar_url` in `localStorage` by the login page.
- **Adding a new collection**: create a numbered migration in `pocketbase/pb_migrations/`, add a corresponding hook file in `pb_hooks/` following the `packages.pb.js`/`applications.pb.js` pattern (require inside callbacks), add TypeScript types in `web/src/lib/pb.ts`, and create fetch helpers in `web/src/lib/`.
