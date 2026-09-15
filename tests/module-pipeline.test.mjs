import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function paragraph(id, text, index, format = null) {
  return { id, type: "paragraph", text, location: { kind: "paragraph", paragraph: index, label: `第${index}段` }, ...(format ? { format } : {}) };
}

test("project-to-report pipeline covers every deterministic analysis module", async () => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "document-audit-pipeline-"));
  process.env.WORKBENCH_DATA_DIR = isolatedRoot;
  process.env.WORKBENCH_USE_CODEX = "0";
  try {
    const storage = await import(`../src/storage.mjs?pipeline=${Date.now()}`);
    const analysis = await import(`../src/analysis.mjs?pipeline=${Date.now()}`);
    const { issuesToCsv, issuesToHtml } = await import(`../src/export.mjs?pipeline=${Date.now()}`);
    const project = await storage.createProject("全模块端到端回归");
    const normal = { style: "Normal", numbering: null };
    const fixtures = [
      {
        file: { id: "main", name: "主文档.docx", extension: ".docx", role: "main", parse: { status: "ok" } },
        forensic: {
          kind: "docx",
          blocks: [
            paragraph("p-1", "合同金额为100万元。", 1),
            paragraph("p-2", "业务申请经审批通过后生效。", 2),
            paragraph("p-3", "请确认本项内容。。", 3),
            paragraph("p-4", "第一个正文段落格式一致。", 4, { ...normal, runFormats: { "宋体|24||": 1 } }),
            paragraph("p-5", "中间这一段意外使用其他格式。", 5, { ...normal, runFormats: { "黑体|32|b|": 1 } }),
            paragraph("p-6", "第三个正文段落格式一致。", 6, { ...normal, runFormats: { "宋体|24||": 1 } }),
          ], comments: [], revisions: { insertions: [], deletions: [] },
        },
      },
      {
        file: { id: "attachment", name: "实施方案.docx", extension: ".docx", role: "attachment", parse: { status: "ok" } },
        forensic: { kind: "docx", blocks: [paragraph("p-1", "合同金额为90万元。", 1)], comments: [], revisions: { insertions: [], deletions: [] } },
      },
      {
        file: { id: "sheet", name: "台账.xlsx", extension: ".xlsx", role: "data", parse: { status: "ok" } },
        forensic: { kind: "xlsx", sheets: [{ name: "汇总", state: "visible", hiddenRows: [3], hiddenColumns: [], cells: [
          { address: "A1", row: 1, column: 1, value: "合同金额" },
          { address: "B1", row: 1, column: 2, value: 900000, formula: null },
        ] }] },
      },
      {
        file: { id: "base", name: "制度_v1.docx", extension: ".docx", role: "version-base", parse: { status: "ok" } },
        forensic: { kind: "docx", blocks: [paragraph("p-1", "审批通过后，由董事会批准，金额为100万元。", 1)], comments: [], revisions: { insertions: [], deletions: [] } },
      },
      {
        file: { id: "current", name: "制度_v2.docx", extension: ".docx", role: "version-current", parse: { status: "ok" } },
        forensic: { kind: "docx", blocks: [paragraph("p-1", "审批通过后，由总经理办公会批准，金额为120万元。", 1)], comments: [], revisions: { insertions: [], deletions: [] } },
      },
    ];
    project.files = fixtures.map(item => item.file);
    await storage.saveProject(project);
    const extractedDir = join(storage.projectDir(project.id), "extracted");
    await mkdir(extractedDir, { recursive: true });
    for (const fixture of fixtures) {
      await storage.writeJsonAtomic(join(extractedDir, `${fixture.file.id}.forensic.json`), fixture.forensic);
      await writeFile(join(extractedDir, `${fixture.file.id}.md`), "", "utf8");
    }

    const run = await analysis.createAnalysisRun(project.id, {
      modules: ["conflict", "logic", "data", "proofread", "version"],
      provider: "deterministic",
    });
    await analysis.executeAnalysisRun(run);
    const completed = await analysis.loadRun(project.id, run.id);
    assert.equal(completed.status, "completed");
    assert.ok(completed.startedAt);
    assert.equal(completed.progress, 100);
    for (const module of ["conflict", "logic", "data", "proofread", "version"]) {
      assert.ok(completed.issues.some(issue => issue.module === module), `${module} produced an evidenced issue`);
    }
    assert.ok(completed.issues.some(issue => issue.category === "明显格式异常提示"));
    assert.ok(completed.issues.some(issue => issue.category === "关键内容修改"));
    assert.ok(completed.issues.every(issue => issue.evidence.length > 0));
    assert.ok(completed.issues.flatMap(issue => issue.evidence).filter(item => item.verification === "exact-source-match").every(item => item.quote.length > 0));
    assert.match(issuesToHtml(project, completed), /合同金额/);
    assert.match(issuesToCsv(completed), /证据原文/);
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});
