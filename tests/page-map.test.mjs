import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("DOCX parsing optionally enriches evidence with Word-rendered page numbers", async () => {
  const [parser, mapper] = await Promise.all([
    readFile(new URL("../src/parsers.mjs", import.meta.url), "utf8"),
    readFile(new URL("../workers/word_page_map.ps1", import.meta.url), "utf8"),
  ]);

  assert.match(parser, /word_page_map\.ps1/);
  assert.match(parser, /pageMap[^\n]*status/);
  assert.match(mapper, /Repaginate\(\)/);
  assert.match(mapper, /Information\(3\)/, "wdActiveEndAdjustedPageNumber must be used");
  assert.match(mapper, /Add-Member[^\n]*page/);
});
