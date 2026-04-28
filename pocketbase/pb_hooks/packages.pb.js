/// <reference path="../pb_data/types.d.ts" />

// Hooks for the `packages` collection. Targets PocketBase v0.22.x.
//
// Responsibilities:
//   1. On create — derive `name` from `github_url`, force status=pending,
//      set submitter from the authed user.
//   2. After create — fetch GitHub metadata and persist it.
//   3. On update — strip protected fields from non-admin requests.
//   4. After create / update / delete of an approved record — POST a
//      `repository_dispatch` to GitHub to rebuild the static site.
//   5. Nightly cron — refresh GitHub metadata for all approved records.

const PROTECTED_FIELDS = [
  "github_url",
  "name",
  "submitter",
  "status",
  "stars",
  "default_branch",
  "pushed_at",
  "og_image",
];

function parseGithubName(url) {
  if (!url) return null;
  const m = String(url).match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i
  );
  if (!m) return null;
  let repo = m[2];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  return m[1] + "/" + repo;
}

function fetchGithubMeta(name) {
  const headers = { "User-Agent": "bigconfig-marketplace" };
  const token = $os.getenv("GITHUB_TOKEN");
  if (token) headers["Authorization"] = "Bearer " + token;
  try {
    const res = $http.send({
      url: "https://api.github.com/repos/" + name,
      method: "GET",
      headers: headers,
      timeout: 10,
    });
    if (res.statusCode !== 200) return null;
    const j = res.json;
    return {
      description: j.description || "",
      stars: j.stargazers_count || 0,
      default_branch: j.default_branch || "",
      pushed_at: j.pushed_at || "",
      og_image:
        "https://opengraph.githubassets.com/1/" + name,
    };
  } catch (err) {
    console.log("[packages] github fetch failed for " + name + ": " + err);
    return null;
  }
}

function dispatchRebuild(reason) {
  const repo = $os.getenv("DISPATCH_REPO"); // e.g. "amiorin/bigconfig-marketplace"
  const pat = $os.getenv("DISPATCH_PAT");
  if (!repo || !pat) {
    console.log(
      "[packages] dispatch skipped (DISPATCH_REPO or DISPATCH_PAT unset): " +
        reason
    );
    return;
  }
  try {
    $http.send({
      url: "https://api.github.com/repos/" + repo + "/dispatches",
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + pat,
        "User-Agent": "bigconfig-marketplace",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "rebuild-site",
        client_payload: { reason: reason },
      }),
      timeout: 10,
    });
    console.log("[packages] dispatch sent: " + reason);
  } catch (err) {
    console.log("[packages] dispatch failed: " + err);
  }
}

// ---- 1. Before create: derive name, force pending, assign submitter ----

onRecordBeforeCreateRequest((e) => {
  const url = e.record.getString("github_url");
  const name = parseGithubName(url);
  if (!name) {
    throw new BadRequestError(
      "github_url must be a public GitHub repo URL like https://github.com/owner/repo"
    );
  }
  e.record.set("name", name);
  e.record.set("status", "pending");
  e.record.set("stars", 0);
  const auth = e.httpContext.get("authRecord");
  if (!auth) {
    throw new BadRequestError("must be signed in");
  }
  e.record.set("submitter", auth.id);
}, "packages");

// ---- 2. After create: enrich from GitHub ----

onRecordAfterCreateRequest((e) => {
  const meta = fetchGithubMeta(e.record.getString("name"));
  if (!meta) return;
  if (!e.record.getString("description") && meta.description) {
    e.record.set("description", meta.description);
  }
  e.record.set("stars", meta.stars);
  e.record.set("default_branch", meta.default_branch);
  if (meta.pushed_at) e.record.set("pushed_at", meta.pushed_at);
  if (meta.og_image) e.record.set("og_image", meta.og_image);
  $app.dao().saveRecord(e.record);
}, "packages");

// ---- 3. Before update: strip protected fields from non-admin requests ----

onRecordBeforeUpdateRequest((e) => {
  // Admin updates (no auth record on httpContext but admin token) bypass.
  const admin = e.httpContext.get("admin");
  if (admin) return;

  const original = e.record.original();
  for (const field of PROTECTED_FIELDS) {
    e.record.set(field, original.get(field));
  }
}, "packages");

// ---- 4. Dispatch on changes that affect the public listing ----

onRecordAfterCreateRequest((e) => {
  if (e.record.getString("status") === "approved") {
    dispatchRebuild("create:" + e.record.getString("name"));
  }
}, "packages");

onRecordAfterUpdateRequest((e) => {
  const status = e.record.getString("status");
  const original = e.record.original();
  const wasApproved = original.getString("status") === "approved";
  if (status === "approved" || wasApproved) {
    dispatchRebuild("update:" + e.record.getString("name"));
  }
}, "packages");

onRecordAfterDeleteRequest((e) => {
  if (e.record.getString("status") === "approved") {
    dispatchRebuild("delete:" + e.record.getString("name"));
  }
}, "packages");

// ---- 5. Nightly GitHub metadata refresh ----

cronAdd("packages-github-refresh", "0 3 * * *", () => {
  const records = $app
    .dao()
    .findRecordsByFilter("packages", 'status = "approved"', "-pushed_at", 0, 0);
  let touched = 0;
  for (const rec of records) {
    const meta = fetchGithubMeta(rec.getString("name"));
    if (!meta) continue;
    rec.set("stars", meta.stars);
    if (meta.default_branch) rec.set("default_branch", meta.default_branch);
    if (meta.pushed_at) rec.set("pushed_at", meta.pushed_at);
    if (meta.og_image) rec.set("og_image", meta.og_image);
    try {
      $app.dao().saveRecord(rec);
      touched++;
    } catch (err) {
      console.log(
        "[packages refresh] failed to save " + rec.getString("name") + ": " + err
      );
    }
  }
  console.log("[packages refresh] refreshed " + touched + " records");
  if (touched > 0) dispatchRebuild("nightly-refresh");
});
