import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

function stubEnv(body = "asset-body") {
  return {
    ASSETS: {
      fetch: async () => new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    },
  };
}

function assertSecurityHeaders(response) {
  assert.match(response.headers.get("Strict-Transport-Security") || "", /max-age=31536000/);
  assert.equal(response.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
}

test("canonical redirects carry security headers and drop port and userinfo", async () => {
  const response = await worker.fetch(new Request("http://www.rollplay.cc:8080/index.html"), stubEnv());
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://rollplay.cc/");
  assertSecurityHeaders(response);
});

test("asset responses pass through with security headers added", async () => {
  const response = await worker.fetch(new Request("https://rollplay.cc/"), stubEnv());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset-body");
  assertSecurityHeaders(response);
});

test("the worker source itself is never served as an asset", async () => {
  const response = await worker.fetch(new Request("https://rollplay.cc/worker.js"), stubEnv("worker-source"));
  assert.equal(response.status, 404);
  assert.notEqual(await response.text(), "worker-source");
  assertSecurityHeaders(response);
});
