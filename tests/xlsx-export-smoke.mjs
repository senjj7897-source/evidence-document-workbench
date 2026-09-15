import assert from "node:assert/strict";
import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exportIssuesWorkbook } from "../src/xlsx-export.mjs";
import { loadProject } from "../src/storage.mjs";
import { loadRun } from "../src/analysis.mjs";

const projectId = process.env.WORKBENCH_XLSX_PROJECT || "7ed6bbaf-3948-48ab-bc5f-ec09f609b70f";
const project = await loadProject(projectId);
assert.ok(project.latestRunId, "fixture project has a completed run");
const run = await loadRun(project.id, project.latestRunId);
assert.equal(run.status, "completed");

const exported = await exportIssuesWorkbook(project, run);
await access(exported.outputPath);
const workbookInfo = await stat(exported.outputPath);
assert.ok(workbookInfo.size > 10_000, "xlsx is non-trivial");
const signature = await readFile(exported.outputPath).then(buffer => buffer.subarray(0, 2).toString("ascii"));
assert.equal(signature, "PK", "xlsx is a ZIP-based workbook");
const validation = JSON.parse(await readFile(exported.validationPath, "utf8"));
assert.deepEqual(validation.workbook.sheets, ["审查汇总", "问题清单", "证据明细"]);
assert.equal(validation.workbook.issueCount, run.issues.length);
assert.ok(!String(validation.formulaErrorScan).match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/));
for (const preview of validation.previews) {
  const imagePath = join(exported.previewDir, preview.file);
  assert.ok((await stat(imagePath)).size > 1_000, `${preview.sheetName} preview exists`);
}

const finalDir = resolve("outputs", "01a00fd0-6f62-7981-8238-a00cf1ee2df6");
await mkdir(finalDir, { recursive: true });
const finalPath = join(finalDir, "audit-issues.xlsx");
await copyFile(exported.outputPath, finalPath);
console.log(JSON.stringify({ ok: true, finalPath, validation: exported.validationPath, previews: exported.previewDir }, null, 2));
