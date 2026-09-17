import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const outRoot = new URL("../out/", import.meta.url);

async function readOutput(path) {
  return readFile(new URL(path, outRoot), "utf8");
}

test("exports the public pages with SEO metadata", async () => {
  const [index, privacy, imprint, robots, sitemap] = await Promise.all([
    readOutput("index.html"),
    readOutput("privacy/index.html"),
    readOutput("imprint/index.html"),
    readOutput("robots.txt"),
    readOutput("sitemap.xml"),
  ]);

  assert.match(index, /<title>Kickuno/i);
  assert.match(index, /<link rel="canonical" href="https:\/\/kickuno\.meecode\.at\/"\/?>/i);
  assert.match(index, /<meta property="og:image" content="https:\/\/kickuno\.meecode\.at\/og\.png"\/?>/i);
  assert.match(index, /bestorganisiert/i);

  assert.match(privacy, /<title>Datenschutz \| Kickuno<\/title>/i);
  assert.match(privacy, /<link rel="canonical" href="https:\/\/kickuno\.meecode\.at\/privacy\/"\/?>/i);
  assert.match(privacy, /kickuno_cookie_notice/i);

  assert.match(imprint, /<title>Impressum \| Kickuno<\/title>/i);
  assert.match(imprint, /<link rel="canonical" href="https:\/\/kickuno\.meecode\.at\/imprint\/"\/?>/i);

  assert.match(robots, /Sitemap: https:\/\/kickuno\.meecode\.at\/sitemap\.xml/i);
  assert.match(sitemap, /<loc>https:\/\/kickuno\.meecode\.at\/privacy\/<\/loc>/i);
  assert.match(sitemap, /<loc>https:\/\/kickuno\.meecode\.at\/imprint\/<\/loc>/i);
});

test("build output is static and file-based", async () => {
  await assert.doesNotReject(access(new URL("index.html", outRoot)));
  await assert.doesNotReject(access(new URL("privacy/index.html", outRoot)));
  await assert.doesNotReject(access(new URL("imprint/index.html", outRoot)));
  await assert.doesNotReject(access(new URL("robots.txt", outRoot)));
  await assert.doesNotReject(access(new URL("sitemap.xml", outRoot)));
});
