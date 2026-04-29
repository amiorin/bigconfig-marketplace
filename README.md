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
  `https://localhost`.

Single-origin in production: PocketBase serves `/api/*` and the static site
`/*`. No CORS, no separate hosting.

## Layout

```
.
├── .github/workflows/rebuild.yml   # repository_dispatch → build & push image
├── pocketbase/
│   ├── pb_migrations/              # collection schema as code (committed)
│   ├── pb_hooks/                   # JS hooks: enrichment, dispatch, rules
│   └── pb_public/                  # ← Astro build output (gitignored)
├── web/                            # Astro project (outDir → ../pocketbase/pb_public)
├── Caddyfile                       # dev reverse proxy
├── Procfile                        # pb + web + caddy
└── Dockerfile                      # PB binary + migrations + hooks + built site
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

- `PUBLIC_PB_URL` — where the browser/SDK reaches PocketBase. In dev,
  `https://localhost` (via Caddy). In CI, the prod PB URL. In the deployed
  image, `''` (same-origin).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth, configured in PB admin.

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

`PUBLIC_PB_URL` is **inlined into the static bundle at build time**, so the
build must know the deploy target. The Dockerfile takes it as a build arg.

## Docker

```sh
docker build --build-arg PUBLIC_PB_URL=https://example.com -t bigconfig-marketplace .
docker run -p 8090:8090 -v $PWD/pb_data:/pb/pb_data bigconfig-marketplace
```

CI (`.github/workflows/rebuild.yml`) builds and pushes to GHCR on every push to
`main`, on `workflow_dispatch`, and on `repository_dispatch` events of type
`rebuild-site` (sent by PB hooks when packages are approved, updated, or
nightly-refreshed).

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
