const CANONICAL_HOST = "rollplay.cc";
const WWW_HOST = `www.${CANONICAL_HOST}`;
const LEGACY_PATHS = new Set(["/index", "/index/", "/index.html", "/index.php"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const needsCanonicalHost =
      url.hostname === WWW_HOST ||
      (url.hostname === CANONICAL_HOST && url.protocol !== "https:");

    if (needsCanonicalHost || LEGACY_PATHS.has(url.pathname)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      if (LEGACY_PATHS.has(url.pathname)) url.pathname = "/";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
