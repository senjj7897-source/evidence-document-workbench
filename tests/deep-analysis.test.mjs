import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES, normalizeIssue } from "../src/issues.mjs";

test("deep analysis is a semantic recommendation lane rather than another defect checker", () => {
  const module = MODULES.find(candidate => candidate.id === "deep");
  assert.deepEqual(module, {
    id: "deep",
    name: "深度分析与专业优化建议",
    shortName: "深度建议",
    description: "结合文档目标与专业场景提出结构化、可落地的优化方案",
    semanticOnly: true,
  });

  const recommendation = normalizeIssue({
    module: "deep",
    findingType: "issue",
    severity: "medium",
    category: "压力测试方法",
    title: "建议补充分层情景与传导路径设计",
    summary: "在现有方案基础上补充情景分层、风险因子传导和结果应用机制。",
    basis: "文档已列示压力情景，但情景与风险因子的传导关系较为简略。",
    impact: "提高压力测试结果的解释力和管理应用价值。",
    evidence: [{ fileId: "main", fileName: "方案.docx", location: { label: "第5段" }, quote: "压力情景包括轻度、中度和重度。" }],
  });
  assert.equal(recommendation.findingType, "improvement", "deep analysis output must be presented as a recommendation, not a confirmed defect");
});

test("the semantic result contract accepts deep professional recommendations", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/issues.schema.json", import.meta.url), "utf8"));
  assert.ok(schema.properties.issues.items.properties.module.enum.includes("deep"));
});

test("a deep-only analysis invokes the semantic provider and keeps evidence-backed professional recommendations", async () => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "document-audit-deep-analysis-"));
  process.env.WORKBENCH_DATA_DIR = isolatedRoot;
  process.env.WORKBENCH_USE_CODEX = "1";
  try {
    const storage = await import("../src/storage.mjs");
    const providers = await import("../src/providers/index.mjs");
    const analysis = await import("../src/analysis.mjs");
    providers.registerSemanticProvider({
      id: "deep-analysis-test",
      label: "深度分析测试模型",
      priority: 2100,
      capabilities: { analysis: true, rewrite: false },
      isAvailable: async () => true,
      analyze: async ({ modules }) => {
        assert.deepEqual(modules, ["deep"]);
        return {
          issues: [{
            module: "deep",
            findingType: "improvement",
            category: "压力测试方法",
            severity: "medium",
            title: "建立风险因子到损益结果的分层传导链",
            summary: "建议按情景假设、风险因子冲击、估值变化和资本影响四层组织计算链路，并明确各层输入输出。",
            basis: "原文已说明压力测试分级，但没有集中呈现风险因子到管理指标的传导关系。",
            impact: "增强结果可解释性，便于复核并支持风险限额与资本管理决策。",
            confidence: 0.88,
            inferenceLevel: "risk_inference",
            evidence: [{ fileId: "main", fileName: "方案.docx", location: { label: "第1段" }, quote: "压力情景分为轻度、中度和重度。" }],
          }],
          diagnostics: { mocked: true },
        };
      },
    });

    const project = await storage.createProject("深度分析回归");
    project.files = [{ id: "main", name: "方案.docx", extension: ".docx", role: "main", parse: { status: "ok" } }];
    await storage.saveProject(project);
    const extractedDir = join(storage.projectDir(project.id), "extracted");
    await mkdir(extractedDir, { recursive: true });
    await storage.writeJsonAtomic(join(extractedDir, "main.forensic.json"), {
      kind: "docx",
      blocks: [{ id: "p-1", type: "paragraph", text: "压力情景分为轻度、中度和重度。", location: { kind: "paragraph", paragraph: 1, label: "第1段" } }],
      comments: [],
      revisions: { insertions: [], deletions: [] },
    });
    await writeFile(join(extractedDir, "main.md"), "压力情景分为轻度、中度和重度。", "utf8");

    const run = await analysis.createAnalysisRun(project.id, { modules: ["deep"], provider: "deep-analysis-test" });
    await analysis.executeAnalysisRun(run);
    const completed = await analysis.loadRun(project.id, run.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerUsed, "deep-analysis-test");
    assert.equal(completed.issues.length, 1);
    assert.equal(completed.issues[0].module, "deep");
    assert.equal(completed.issues[0].findingType, "improvement");
    assert.equal(completed.issues[0].evidence.length, 1);

    const deterministicRun = await analysis.createAnalysisRun(project.id, { modules: ["deep"], provider: "deterministic" });
    await analysis.executeAnalysisRun(deterministicRun);
    const deterministicCompleted = await analysis.loadRun(project.id, deterministicRun.id);
    assert.ok(deterministicCompleted.warnings.some(message => message.includes("深度建议") && message.includes("语义模型")));
  } finally {
    delete process.env.WORKBENCH_DATA_DIR;
    delete process.env.WORKBENCH_USE_CODEX;
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});
