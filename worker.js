const CANONICAL_HOST = "rollplay.cc";
const WWW_HOST = `www.${CANONICAL_HOST}`;
const LEGACY_PATHS = new Set(["/index", "/index/", "/index.html", "/index.php"]);
// The Worker source is never a public asset (.assetsignore excludes it);
// refuse it here too so the boundary holds even if an upload included it.
const BLOCKED_PATHS = new Set(["/worker.js"]);

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function withSecurityHeaders(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}

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

    if (BLOCKED_PATHS.has(url.pathname)) {
      return withSecurityHeaders(new Response("Not found", { status: 404 }));
    }

    const needsCanonicalHost =
      url.hostname === WWW_HOST ||
      (url.hostname === CANONICAL_HOST && isHttpRequest(request, url));

    if (needsCanonicalHost || LEGACY_PATHS.has(url.pathname)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      url.port = "";
      url.username = "";
      url.password = "";
      if (LEGACY_PATHS.has(url.pathname)) url.pathname = "/";
      return new Response(null, {
        status: 301,
        headers: { Location: url.toString(), ...SECURITY_HEADERS },
      });
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
