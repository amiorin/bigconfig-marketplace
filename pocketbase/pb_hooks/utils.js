// Helpers for the packages hooks. Imported via require() inside each hook
// callback because PB's JSVM does not share top-level scope with callbacks.

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
      og_image: "https://opengraph.githubassets.com/1/" + name,
    };
  } catch (err) {
    console.log("[packages] github fetch failed for " + name + ": " + err);
    return null;
  }
}

function dispatchRebuild(reason) {
  const repo = $os.getenv("DISPATCH_REPO");
  const pat = $os.getenv("DISPATCH_PAT");
  if (!repo || !pat) {
    console.log(
      "[packages] dispatch skipped (DISPATCH_REPO/DISPATCH_PAT unset): " +
        reason
    );
    return;
  }
  try {
    $http.send({
      url: "https://api.github.com/repos/" + repo + "/dispatches",
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + pat,
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

function isSuperuser(auth) {
  try {
    return auth && auth.collection().name === "_superusers";
  } catch (err) {
    return false;
  }
}

module.exports = {
  PROTECTED_FIELDS,
  parseGithubName,
  fetchGithubMeta,
  dispatchRebuild,
  isSuperuser,
};
