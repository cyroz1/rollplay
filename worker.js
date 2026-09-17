const CANONICAL_HOST = "rollplay.cc";
const WWW_HOST = `www.${CANONICAL_HOST}`;
const LEGACY_PATHS = new Set(["/index", "/index/", "/index.html", "/index.php"]);

function isHttpRequest(request, url) {
  if (url.protocol === "http:") return true;

  try {
    return JSON.parse(request.headers.get("CF-Visitor") ?? "{}").scheme === "http";
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const needsCanonicalHost =
      url.hostname === WWW_HOST ||
      (url.hostname === CANONICAL_HOST && isHttpRequest(request, url));

    if (needsCanonicalHost || LEGACY_PATHS.has(url.pathname)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      if (LEGACY_PATHS.has(url.pathname)) url.pathname = "/";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
