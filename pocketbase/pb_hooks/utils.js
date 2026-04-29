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
  "docker_image",
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

// Parse `[registry/]repo[:tag]` into { registry, repo, tag }.
// Defaults: Docker Hub registry, `latest` tag, `library/` prefix for single-segment Hub repos.
function parseDockerImage(image) {
  if (!image) return null;
  let s = String(image).trim();
  if (!s) return null;

  let registry = "registry-1.docker.io";
  let rest = s;
  const slash = s.indexOf("/");
  if (slash !== -1) {
    const head = s.slice(0, slash);
    if (head.indexOf(".") !== -1 || head.indexOf(":") !== -1 || head === "localhost") {
      registry = head;
      rest = s.slice(slash + 1);
    }
  }

  let tag = "latest";
  const colon = rest.lastIndexOf(":");
  const slashAfter = rest.lastIndexOf("/");
  if (colon !== -1 && colon > slashAfter) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }

  let repo = rest;
  if (registry === "registry-1.docker.io" && repo.indexOf("/") === -1) {
    repo = "library/" + repo;
  }

  if (!repo || !tag) return null;
  return { registry: registry, repo: repo, tag: tag };
}

// Validate that a public Docker image is reachable (manifest exists).
// Throws BadRequestError if the image is unreachable or the registry requires auth.
function validateDockerImage(image) {
  const parsed = parseDockerImage(image);
  if (!parsed) {
    throw new BadRequestError(
      "docker_image must look like [registry/]repo[:tag], e.g. ghcr.io/owner/app:v1"
    );
  }

  const accept =
    "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json";

  let token = "";
  if (parsed.registry === "registry-1.docker.io") {
    try {
      const tr = $http.send({
        url:
          "https://auth.docker.io/token?service=registry.docker.io&scope=repository:" +
          parsed.repo +
          ":pull",
        method: "GET",
        headers: { "User-Agent": "bigconfig-marketplace" },
        timeout: 10,
      });
      if (tr.statusCode === 200 && tr.json && tr.json.token) {
        token = tr.json.token;
      }
    } catch (err) {
      // fall through and let the manifest call surface the error
    }
  }

  const headers = {
    "User-Agent": "bigconfig-marketplace",
    Accept: accept,
  };
  if (token) headers["Authorization"] = "Bearer " + token;

  let res;
  try {
    res = $http.send({
      url:
        "https://" +
        parsed.registry +
        "/v2/" +
        parsed.repo +
        "/manifests/" +
        parsed.tag,
      method: "GET",
      headers: headers,
      timeout: 15,
    });
  } catch (err) {
    throw new BadRequestError(
      "could not reach registry for " + image + ": " + err
    );
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new BadRequestError(
      "docker_image is not publicly pullable (registry requires auth): " + image
    );
  }
  if (res.statusCode === 404) {
    throw new BadRequestError("docker_image not found: " + image);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new BadRequestError(
      "docker_image check failed (HTTP " + res.statusCode + "): " + image
    );
  }
}

module.exports = {
  PROTECTED_FIELDS,
  parseGithubName,
  fetchGithubMeta,
  dispatchRebuild,
  isSuperuser,
  parseDockerImage,
  validateDockerImage,
};
