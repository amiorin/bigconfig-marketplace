# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

A marketplace for "bigconfig" packages built as a single Docker image that bundles a PocketBase backend with a statically-built Astro frontend served from `pb_public`.

- **`web/`** — Astro 5 static site (Tailwind v4 via Vite plugin). `astro.config.mjs` outputs to `../pocketbase/pb_public` so `astro build` writes directly into PocketBase's static-serve directory. Talks to PocketBase at `PUBLIC_PB_URL` via the `pocketbase` JS SDK (`web/src/lib/pb.ts`).
- **`pocketbase/`** — PocketBase v0.23+ (tested on v0.37.4). Schema is defined in `pb_migrations/`; server-side logic lives in `pb_hooks/` as JSVM scripts.
- **`Caddyfile`** — Dev reverse proxy: `/api*` and `/_*` to PocketBase (`:8090`), everything else to the Astro dev server (`:4321`).
- **`Caddyfile.prod`** — Production Caddy config copied into the image as `/etc/caddy/Caddyfile`. Listens on `:80`, serves `GET /up` for ONCE, and reverse-proxies everything else to PocketBase on `:8090`.
- **`Procfile`** — Runs `pb`, `web` (astro dev), and `caddy` together via `hivemind`.
- **`Procfile.prod`** — Production process list copied into the image as `/app/Procfile`: Caddy plus `entrypoint.sh`.
- **`entrypoint.sh`** — Creates `/storage/pb_data`, restores SQLite from Litestream if needed, optionally upserts a PocketBase superuser with explicit production directories, then runs PocketBase under `litestream replicate -exec`.
- **`litestream.yml`** — S3 replica config for `/storage/pb_data/data.db`.
- **`Dockerfile`** — Two stages: build the Astro site with `PUBLIC_PB_URL` baked in (default `''`), then assemble an ONCE-compatible Alpine image with latest Caddy, PocketBase, Litestream, Hivemind, migrations, hooks, and the built static site.

### Packages collection (the core domain)

`pb_migrations/1714000000_init_packages.js` defines the `packages` collection. Reading the rules and `pb_hooks/packages.pb.js` together is required to understand the submission flow:

- **Submission flow**: a signed-in user POSTs `{ github_url, description, tags }`. `onRecordCreateRequest` derives `name` from the URL via `parseGithubName`, force-sets `status = "pending"`, `stars = 0`, `submitter = e.auth.id`. After save, `onRecordAfterCreateSuccess` calls the GitHub API to enrich `description`, `stars`, `default_branch`, `pushed_at`, `og_image`.
- **Protected fields** (`pb_hooks/utils.js` `PROTECTED_FIELDS`): non-superusers cannot modify `github_url`, `name`, `submitter`, `status`, `stars`, `default_branch`, `pushed_at`, `og_image` — `onRecordUpdateRequest` reverts them from `original()`. Only superusers (admins) approve packages by flipping `status` to `approved`.
- **List/view rules** restrict visibility to approved records OR the submitter's own records, so unapproved submissions are private to the submitter.
- **Static site rebuild**: `dispatchRebuild()` POSTs a `repository_dispatch` (`event_type: rebuild-site`) to `DISPATCH_REPO`. No workflow is committed here yet; when CI is added, wire it to that event. Requires `DISPATCH_REPO` and `DISPATCH_PAT` env vars; otherwise it logs and skips. Triggers fire on approved-record create, any update, approved-record delete, and a nightly cron (`0 3 * * *`) that refreshes GitHub stats.

### Hook authoring constraint

PocketBase's JSVM does not share top-level scope with hook callbacks. Helpers in `pb_hooks/utils.js` must be `require()`'d *inside* each callback — see existing pattern in `packages.pb.js`. Don't hoist requires to the top.

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

`PUBLIC_PB_URL` is inlined into the static bundle. The Dockerfile defaults it to `''` for same-origin production requests. Pass a public PB URL only when the static build should fetch live approved records.

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

- `PUBLIC_PB_URL` — frontend → PocketBase URL (build-time, baked into static bundle).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth for PocketBase (configured in admin UI, sourced from env).
- `GITHUB_TOKEN` — optional, raises rate limit for the GitHub API enrichment in `utils.js`.
- `DISPATCH_REPO` (e.g. `owner/repo`) and `DISPATCH_PAT` — required for `dispatchRebuild` to trigger the rebuild workflow. Without them, hooks log and skip.
- `LITESTREAM_BUCKET`, `LITESTREAM_PATH`, `LITESTREAM_REGION`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` — required in the production container.
- `LITESTREAM_ENDPOINT` — optional S3-compatible endpoint.
- `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` — optional; when both are set, the container upserts the PocketBase superuser on start.
