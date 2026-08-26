import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("home page exposes crawlable SEO metadata and structured data", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /<title>ROLLPLAY - FLP Visualizer, MIDI &amp; MP4 Exporter<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/rollplay\.cc\/" \/>/);
  assert.match(html, /<meta name="robots" content="index,follow,/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta name="twitter:description"/);
  assert.match(html, /<h1[^>]*>Turn FL Studio projects/);

  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd, "JSON-LD block should be present");
  const graph = JSON.parse(jsonLd)["@graph"];
  assert.deepEqual(graph.map(item => item["@type"]), ["WebSite", "SoftwareApplication", "FAQPage"]);
  assert.equal(graph.find(item => item["@type"] === "FAQPage").mainEntity.length, 4);
});

test("crawler discovery files point to the canonical site", async () => {
  const robots = await readFile(new URL("robots.txt", root), "utf8");
  const sitemap = await readFile(new URL("sitemap.xml", root), "utf8");
  const llms = await readFile(new URL("llms.txt", root), "utf8");
  assert.match(robots, /Allow: \/\s+\s*Sitemap: https:\/\/rollplay\.cc\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/rollplay\.cc\/<\/loc>/);
  assert.match(llms, /^# ROLLPLAY/m);
  assert.match(llms, /https:\/\/rollplay\.cc\//);
});
