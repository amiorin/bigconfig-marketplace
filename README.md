# bigconfig marketplace

A "Made with BigConfig" site: a curated, public index of GitHub repos that are
[BigConfig](https://bigconfig.it) packages. Visitors browse and search;
signed-in users submit and edit their own packages.

Inspired by [madewithpocketbase.com](https://www.madewithpocketbase.com/).

## Stack

- **PocketBase** — auth (Google SSO), SQLite, admin UI, JS hooks, static file
  server. Single Go binary.
- **Astro** — static site generator. Builds into `pocketbase/pb_public/`, served
  same-origin by PocketBase.
- **Tailwind CSS v4** — styling, via the Vite plugin.
- **Caddy** — local dev reverse proxy that fronts both servers under
  `https://localhost`; production edge proxy on `:80`.
- **Litestream** — restores PocketBase SQLite from S3 on cold boot and streams
  changes continuously.
- **Hivemind + Tini** — run Caddy and Litestream-supervised PocketBase in the
  production container.

Single-origin in production: Caddy listens on `:80`, serves `/up` for ONCE, and
proxies everything else to PocketBase on `:8090`. PocketBase serves `/api/*`,
`/_/*`, and the baked static site from `/pb/pb_public`.

## Layout

```
.
├── pocketbase/
│   ├── pb_migrations/              # collection schema as code (committed)
│   ├── pb_hooks/                   # JS hooks: enrichment, dispatch, rules
│   └── pb_public/                  # ← Astro build output (gitignored)
├── web/                            # Astro project (outDir → ../pocketbase/pb_public)
├── Caddyfile                       # dev reverse proxy
├── Caddyfile.prod                  # production Caddy config copied into image
├── Procfile                        # pb + web + caddy
├── Procfile.prod                   # production caddy + litestream process list
├── entrypoint.sh                   # restore DB, upsert superuser, run PB via Litestream
├── litestream.yml                  # S3 replica config
└── Dockerfile                      # ONCE-compatible runtime image
```

## Prerequisites

- [direnv](https://direnv.net/) — loads `.envrc`
- [Node.js 22+](https://nodejs.org/) — for the Astro build
- [PocketBase](https://github.com/pocketbase/pocketbase/releases)
- [Caddy](https://caddyserver.com/)
- A Procfile runner: [hivemind](https://github.com/DarthSim/hivemind)

## Setup

```sh
direnv allow                              # load .envrc
cd web && npm install && cd ..
```

Edit `.envrc` for your environment. Required vars:

- `PUBLIC_PB_URL` — absolute origin (scheme + host) where the browser/SDK
  reaches PocketBase. `https://localhost` in dev (via Caddy); the deployed
  origin in prod. Must not be `''` or relative — see the **Build** section
  for why.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials.
  Not consumed as env vars; paste them into PB admin → Settings → Auth
  providers → Google. The `.envrc.example` entries exist as a reference
  holder.

Optional:

- `GITHUB_TOKEN` — raises rate limit for hook-side GitHub enrichment.
- `DISPATCH_REPO` (`owner/repo`) and `DISPATCH_PAT` — required for hooks to
  trigger the rebuild workflow. Without them, hooks log and skip.

## Develop

```sh
hivemind                                  # runs pb + web + caddy
```

That gives you:

- Astro dev server on `:4321`
- PocketBase on `:8090` (admin at `http://127.0.0.1:8090/_/`)
- Caddy on `https://localhost` proxying `/api*` and `/_*` to PB, the rest to
  Astro

Or run them individually:

```sh
cd pocketbase && ./pocketbase serve
cd web && npm run dev
caddy run
```

PocketBase auto-applies migrations from `pb_migrations/` on startup. To create
a new one:

```sh
cd pocketbase && ./pocketbase migrate create <name>
```

## Build

```sh
cd web && npm run build                   # writes to ../pocketbase/pb_public
```

`PUBLIC_PB_URL` is **inlined into the static bundle at build time** and must
be the absolute origin (scheme + host) where the browser will reach
PocketBase. The Dockerfile defaults it to `https://localhost` (suitable for
SSH-tunnel + local Caddy testing); for prod, override with
`--build-arg PUBLIC_PB_URL=<your-origin>`. An empty or relative value makes
the PocketBase SDK emit page-path-relative URLs at runtime — e.g. on
`/login` it calls `/login/api/...` instead of `/api/...` — which breaks
Google SSO.

## Docker

```sh
docker build -t bigconfig-marketplace .
docker run -p 80:80 \
  -v bigconfig-marketplace-data:/storage \
  -e LITESTREAM_BUCKET=my-bucket \
  -e LITESTREAM_PATH=bigconfig-marketplace/data.db \
  -e LITESTREAM_REGION=us-east-1 \
  -e LITESTREAM_ACCESS_KEY_ID=... \
  -e LITESTREAM_SECRET_ACCESS_KEY=... \
  bigconfig-marketplace
```

The image is ONCE-compatible: it listens on `:80`, responds to `GET /up`, and
stores persistent PocketBase data under `/storage/pb_data`. The static site is
baked into the image at `/pb/pb_public`; only the SQLite data directory moved to
`/storage`.

### PocketBase directories

Development keeps PocketBase's conventional project-local layout:

- data: `pocketbase/pb_data`
- public files: `pocketbase/pb_public`
- hooks: `pocketbase/pb_hooks`
- migrations: `pocketbase/pb_migrations`

Production uses explicit absolute paths because
[ONCE-compatible applications](https://github.com/basecamp/once#making-a-once-compatible-application)
must serve HTTP on port `80`, expose `/up`, and keep persistent data under
`/storage`. The container starts PocketBase with:

```sh
pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/storage/pb_data \
  --publicDir=/pb/pb_public \
  --hooksDir=/pb/pb_hooks \
  --migrationsDir=/pb/pb_migrations
```

`SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD`, when set, use the same explicit
directory flags for `pocketbase superuser upsert`.

Required Litestream runtime variables:

- `LITESTREAM_BUCKET`
- `LITESTREAM_PATH`
- `LITESTREAM_REGION`
- `LITESTREAM_ACCESS_KEY_ID`
- `LITESTREAM_SECRET_ACCESS_KEY`

Optional runtime variables:

- `LITESTREAM_ENDPOINT` — custom S3-compatible endpoint for R2, MinIO, etc.
- `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` — upserted on container start when
  both are set.

## How it works

When a signed-in user submits a `github_url`, hooks in
`pocketbase/pb_hooks/packages.pb.js`:

1. derive `name` from the URL, force `status = pending`, set `submitter`;
2. fetch the repo metadata from the GitHub API (description, stars, default
   branch, pushed_at, OG image) and save it back;
3. lock down protected fields (`github_url`, `name`, `submitter`, `status`,
   `stars`, `default_branch`, `pushed_at`, `og_image`) so only superusers can
   modify them — in particular, only a superuser can flip `status` to
   `approved`;
4. on approve / update / nightly cron (`0 3 * * *` refreshes GitHub stats),
   fire a `repository_dispatch` (`event_type: rebuild-site`) to rebuild and
   republish the image. Requires `DISPATCH_REPO` and `DISPATCH_PAT`; otherwise
   logs and skips.

List/view rules expose only `approved` records publicly; submitters can also
see and edit their own pending records.

### Hook authoring constraint

PocketBase's JSVM does not share top-level scope with hook callbacks. Helpers
in `pb_hooks/utils.js` must be `require()`'d **inside** each callback — see
the existing pattern in `packages.pb.js`. Don't hoist requires to the top.

## License

MIT
