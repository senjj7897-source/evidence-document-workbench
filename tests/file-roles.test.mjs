import test from "node:test";
import assert from "node:assert/strict";
import { inferUploadRoles, recommendAnalysisModules, versionStem } from "../app/file-roles.js";

test("version role inference pairs only matching document families", () => {
  assert.equal(versionStem("制度_v1.docx"), versionStem("制度_v2.docx"));
  assert.deepEqual(inferUploadRoles([
    { name: "制度_v1.docx" },
    { name: "制度_v2.docx" },
    { name: "核对台账.xlsx" },
  ]), ["version-base", "version-current", "data"]);
  assert.deepEqual(inferUploadRoles([
    { name: "附件8-1_汇率_v2.docx" },
    { name: "附件8-2_黄金_final.docx" },
  ]), ["main", "attachment"]);
});

test("a single version-looking document does not enable comparison modules", () => {
  const single = recommendAnalysisModules([{ name: "市场风险压力测试方案V2(1).docx" }]);
  assert.ok(single.includes("logic"));
  assert.ok(single.includes("deep"));
  assert.ok(single.includes("assessment"));
  assert.ok(!single.includes("version"));
  assert.ok(!single.includes("conflict"), "single-file recommendations should not imply cross-file comparison");

  const pair = recommendAnalysisModules([{ name: "制度_v1.docx" }, { name: "制度_v2.docx" }]);
  assert.ok(pair.includes("version"));
  assert.ok(pair.includes("conflict"));
});
