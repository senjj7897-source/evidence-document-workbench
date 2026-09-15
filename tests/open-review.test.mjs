import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES, normalizeIssue } from "../src/issues.mjs";
import { issuesToCsv, issuesToHtml } from "../src/export.mjs";

test("open review is an explicit semantic-only lane and preserves model finding intent", () => {
  const module = MODULES.find(candidate => candidate.id === "open");
  assert.deepEqual(module, {
    id: "open",
    name: "开放审查与改进发现",
    shortName: "开放发现",
    description: "模型在预设分类之外发现其他缺点与改进机会",
    semanticOnly: true,
  });

  const improvement = normalizeIssue({
    module: "open",
    findingType: "improvement",
    severity: "high",
    category: "信息组织",
    title: "关键前提分散在多个章节",
    evidence: [{ fileId: "a", fileName: "a.docx", location: { label: "第1段" }, quote: "适用范围" }],
  });
  assert.equal(improvement.module, "open");
  assert.equal(improvement.findingType, "improvement");
  assert.equal(improvement.severity, "low", "a model suggestion must not be presented as a high-impact confirmed defect");

  const invalid = normalizeIssue({ module: "open", findingType: "opinion", title: "无效类型" });
  assert.equal(invalid.findingType, "issue");
});

test("the semantic output contract distinguishes evidenced issues from improvements", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/issues.schema.json", import.meta.url), "utf8"));
  const item = schema.properties.issues.items;
  assert.ok(item.properties.module.enum.includes("open"));
  assert.ok(item.required.includes("findingType"));
  assert.deepEqual(item.properties.findingType.enum, ["issue", "improvement"]);
  assert.equal(item.properties.evidence.minItems, 1);
});

test("exports label open improvements as suggestions rather than confirmed defects", () => {
  const issue = normalizeIssue({
    module: "open",
    findingType: "improvement",
    category: "可追踪性",
    severity: "low",
    title: "关键口径可增加集中索引",
    summary: "建议增加集中索引，原文未构成事实错误。",
    basis: "关键口径分散在多处。",
    impact: "缩短复核定位时间。",
    confidence: 0.8,
    inferenceLevel: "risk_inference",
    evidence: [{ fileId: "a", fileName: "制度.docx", location: { label: "第2段" }, quote: "适用范围见第四章。" }],
  });
  const run = { issues: [issue], summary: { total: 1, high: 0, medium: 0, low: 1 }, updatedAt: new Date().toISOString() };
  const csv = issuesToCsv(run);
  const html = issuesToHtml({ name: "开放审查导出" }, run);
  assert.match(csv, /改进建议/);
  assert.match(html, /改进建议/);
  assert.match(html, /预期收益/);
});

test("an open-only run invokes the semantic provider and returns evidenced discoveries", async () => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "document-audit-open-review-"));
  process.env.WORKBENCH_DATA_DIR = isolatedRoot;
  process.env.WORKBENCH_USE_CODEX = "1";
  try {
    const storage = await import("../src/storage.mjs");
    const providers = await import("../src/providers/index.mjs");
    const analysis = await import("../src/analysis.mjs");
    providers.registerSemanticProvider({
      id: "open-review-test",
      label: "开放审查测试模型",
      priority: 2000,
      capabilities: { analysis: true, rewrite: false },
      isAvailable: async () => true,
      analyze: async ({ modules }) => {
        assert.deepEqual(modules, ["open"]);
        return {
          issues: [{
            module: "open",
            findingType: "improvement",
            category: "信息组织",
            severity: "low",
            title: "适用范围信息分散",
            summary: "适用范围分散在多个位置，可增加集中说明。",
            basis: "建议基于现有原文组织方式，不代表事实错误。",
            impact: "降低读者定位关键前提的成本。",
            confidence: 0.82,
            inferenceLevel: "risk_inference",
            evidence: [{ fileId: "main", fileName: "主文档.docx", location: { label: "第1段" }, quote: "本规则适用于衍生品业务。" }],
          }],
          diagnostics: { mocked: true },
        };
      },
    });

    const project = await storage.createProject("开放审查回归");
    project.files = [{ id: "main", name: "主文档.docx", extension: ".docx", role: "main", parse: { status: "ok" } }];
    await storage.saveProject(project);
    const extractedDir = join(storage.projectDir(project.id), "extracted");
    await mkdir(extractedDir, { recursive: true });
    await storage.writeJsonAtomic(join(extractedDir, "main.forensic.json"), {
      kind: "docx",
      blocks: [{ id: "p-1", type: "paragraph", text: "本规则适用于衍生品业务。", location: { kind: "paragraph", paragraph: 1, label: "第1段" } }],
      comments: [],
      revisions: { insertions: [], deletions: [] },
    });
    await writeFile(join(extractedDir, "main.md"), "本规则适用于衍生品业务。", "utf8");

    const run = await analysis.createAnalysisRun(project.id, { modules: ["open"], provider: "open-review-test" });
    await analysis.executeAnalysisRun(run);
    const completed = await analysis.loadRun(project.id, run.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerUsed, "open-review-test");
    assert.equal(completed.issues.length, 1);
    assert.equal(completed.issues[0].module, "open");
    assert.equal(completed.issues[0].findingType, "improvement");
    assert.equal(completed.issues[0].evidence.length, 1);

    const deterministicRun = await analysis.createAnalysisRun(project.id, { modules: ["open"], provider: "deterministic" });
    await analysis.executeAnalysisRun(deterministicRun);
    const deterministicCompleted = await analysis.loadRun(project.id, deterministicRun.id);
    assert.equal(deterministicCompleted.status, "completed");
    assert.ok(deterministicCompleted.warnings.some(message => message.includes("开放发现") && message.includes("语义模型")));
  } finally {
    delete process.env.WORKBENCH_DATA_DIR;
    delete process.env.WORKBENCH_USE_CODEX;
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});
