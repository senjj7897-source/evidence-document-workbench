import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAnalysisRun, executeAnalysisRun, loadRun } from "../src/analysis.mjs";
import { createProject, projectDir, saveProject, writeJsonAtomic } from "../src/storage.mjs";

const project = await createProject("字段匹配临时回归");
project.files = [
  { id: "mapping-doc", name: "合同说明.docx", extension: ".docx", role: "main", size: 1, parse: { status: "ok", forensic: { kind: "docx" } }, readOnlySnapshot: true },
  { id: "mapping-book", name: "合同台账.xlsx", extension: ".xlsx", role: "data", size: 1, parse: { status: "ok", forensic: { kind: "xlsx" } }, readOnlySnapshot: true },
];
await saveProject(project);
const extracted = join(projectDir(project.id), "extracted");
await mkdir(extracted, { recursive: true });
await writeJsonAtomic(join(extracted, "mapping-doc.forensic.json"), {
  kind: "docx",
  blocks: [{ id: "p-1", type: "paragraph", text: "合同金额为100万元。", location: { kind: "paragraph", paragraph: 1, label: "第1段" } }],
  comments: [], revisions: { insertions: [], deletions: [] },
});
await writeJsonAtomic(join(extracted, "mapping-book.forensic.json"), {
  kind: "xlsx",
  sheets: [{ name: "合同台账", state: "visible", hiddenRows: [], hiddenColumns: [], cells: [
    { address: "A1", row: 1, column: 1, value: "含税合同金额" },
    { address: "B1", row: 1, column: 2, value: 1100000 },
    { address: "A2", row: 2, column: 1, value: "不含税合同金额" },
    { address: "B2", row: 2, column: 2, value: 900000 },
  ] }],
});
await writeFile(join(extracted, "mapping-doc.md"), "合同金额为100万元。", "utf8");
await writeFile(join(extracted, "mapping-book.md"), "", "utf8");
const run = await createAnalysisRun(project.id, { modules: ["data"], provider: "deterministic" });
await executeAnalysisRun(run);
const completed = await loadRun(project.id, run.id);
const issue = completed.issues.find(item => item.mapping?.status === "unconfirmed");
if (!issue) throw new Error("mapping fixture did not produce an ambiguous issue");
console.log(JSON.stringify({ projectId: project.id, runId: run.id, issueId: issue.id, candidates: issue.mapping.candidates.length }));
