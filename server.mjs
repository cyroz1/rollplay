import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const rootPath = await realpath(root);
const port = Number(process.env.PORT || 4173);
// Loopback by default: this server exists to preview the public site, so
// it must not expose the checkout to the local network. Set HOST only if
// you deliberately want other devices to reach it.
const host = process.env.HOST || "127.0.0.1";
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

// Mirror the production publication boundary (.assetsignore): dotfiles
// and dot-directories (.git/, .wrangler/, .env*), server-only code, tool
// configuration, and tests are never served, even on loopback.
const blockedSegments = new Set(["tests", "node_modules"]);
const blockedFiles = new Set([
  "server.mjs",
  "worker.js",
  "package.json",
  "package-lock.json",
  "wrangler.json",
  "wrangler.jsonc",
  "README.md",
  ".assetsignore",
  ".gitignore",
]);

function isPublicPath(relative) {
  const segments = relative.split(/[\\/]/);
  return !segments.some(segment => segment.startsWith(".") || blockedSegments.has(segment))
    && !blockedFiles.has(segments.at(-1));
}

createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
    if (relative.startsWith("..") || !isPublicPath(relative)) throw new Error("Invalid path");
    // Resolve symlinks and require the target to stay inside the root, so
    // a link planted in the checkout cannot serve files outside it.
    const filePath = await realpath(join(rootPath, relative));
    if (filePath !== rootPath && !filePath.startsWith(rootPath + sep)) throw new Error("Invalid path");
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": `${types[extname(relative)] || "application/octet-stream"}; charset=utf-8`,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Content-Language": "en",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-store",
    });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, host, () => console.log(`ROLLPLAY available at http://${host}:${port}`));
