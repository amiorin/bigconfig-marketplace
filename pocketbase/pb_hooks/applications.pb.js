/// <reference path="../pb_data/types.d.ts" />

// Hooks for the `applications` collection. Mirrors packages.pb.js plus
// blocking docker_image validation on submit.
//
// Helpers live in ./utils.js and are required() inside each callback because
// PB's JSVM does not share the file's top-level scope with hook callbacks.

onRecordCreateRequest((e) => {
  const { parseGithubName, validateDockerImage } = require(`${__hooks}/utils.js`);
  if (!e.auth) {
    throw new BadRequestError("must be signed in");
  }
  const url = e.record.getString("github_url");
  const name = parseGithubName(url);
  if (!name) {
    throw new BadRequestError(
      "github_url must be a public GitHub repo URL like https://github.com/owner/repo"
    );
  }
  validateDockerImage(e.record.getString("docker_image"));
  e.record.set("name", name);
  e.record.set("status", "pending");
  e.record.set("stars", 0);
  e.record.set("submitter", e.auth.id);
  e.next();
}, "applications");

onRecordAfterCreateSuccess((e) => {
  const { fetchGithubMeta, dispatchRebuild } = require(`${__hooks}/utils.js`);
  const meta = fetchGithubMeta(e.record.getString("name"));
  if (meta) {
    if (!e.record.getString("description") && meta.description) {
      e.record.set("description", meta.description);
    }
    e.record.set("stars", meta.stars);
    e.record.set("default_branch", meta.default_branch);
    if (meta.pushed_at) e.record.set("pushed_at", meta.pushed_at);
    if (meta.og_image) e.record.set("og_image", meta.og_image);
    try {
      e.app.save(e.record);
    } catch (err) {
      console.log("[applications] enrichment save failed: " + err);
    }
  }
  if (e.record.getString("status") === "approved") {
    dispatchRebuild("create:application:" + e.record.getString("name"));
  }
}, "applications");

onRecordUpdateRequest((e) => {
  const { isSuperuser, PROTECTED_FIELDS } = require(`${__hooks}/utils.js`);
  if (isSuperuser(e.auth)) {
    e.next();
    return;
  }
  const original = e.record.original();
  for (const field of PROTECTED_FIELDS) {
    e.record.set(field, original.get(field));
  }
  e.next();
}, "applications");

onRecordAfterUpdateSuccess((e) => {
  const { dispatchRebuild } = require(`${__hooks}/utils.js`);
  dispatchRebuild("update:application:" + e.record.getString("name"));
}, "applications");

onRecordAfterDeleteSuccess((e) => {
  const { dispatchRebuild } = require(`${__hooks}/utils.js`);
  if (e.record.getString("status") === "approved") {
    dispatchRebuild("delete:application:" + e.record.getString("name"));
  }
}, "applications");

cronAdd("applications-github-refresh", "15 3 * * *", () => {
  const { fetchGithubMeta, dispatchRebuild } = require(`${__hooks}/utils.js`);
  const records = $app.findRecordsByFilter(
    "applications",
    "status = 'approved'",
    "-pushed_at",
    0,
    0
  );
  let touched = 0;
  for (const rec of records) {
    const meta = fetchGithubMeta(rec.getString("name"));
    if (!meta) continue;
    rec.set("stars", meta.stars);
    if (meta.default_branch) rec.set("default_branch", meta.default_branch);
    if (meta.pushed_at) rec.set("pushed_at", meta.pushed_at);
    if (meta.og_image) rec.set("og_image", meta.og_image);
    try {
      $app.save(rec);
      touched++;
    } catch (err) {
      console.log(
        "[applications refresh] failed to save " +
          rec.getString("name") +
          ": " +
          err
      );
    }
  }
  console.log("[applications refresh] refreshed " + touched + " records");
  if (touched > 0) dispatchRebuild("nightly-refresh:applications");
});
