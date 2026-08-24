import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
    if (relative.startsWith("..")) throw new Error("Invalid path");
    const file = await readFile(join(root, relative));
    response.writeHead(200, {
      "Content-Type": `${types[extname(relative)] || "application/octet-stream"}; charset=utf-8`,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cache-Control": "no-store",
    });
    response.end(file);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "0.0.0.0", () => console.log(`ROLLPLAY available at http://localhost:${port}`));
