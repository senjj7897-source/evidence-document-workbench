import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES } from "../src/issues.mjs";
import { extractReferencedParagraphLabels, resolveAssessmentStages } from "../src/providers/codex-local.mjs";

test("improvement assessment is an independent semantic report module", () => {
  const module = MODULES.find(candidate => candidate.id === "assessment");
  assert.deepEqual(module, {
    id: "assessment",
    name: "整体改进评估与深化建议",
    shortName: "改进评估",
    description: "从完整性、优化空间和深化方向评估整份报告并形成改进路线图",
    semanticOnly: true,
    reportOnly: true,
  });
});

test("the assessment output contract separates incomplete, optimize and deepen recommendations", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/assessment.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema.required, ["assessment"]);
  const assessment = schema.properties.assessment;
  assert.ok(assessment.required.includes("overallRating"));
  assert.ok(assessment.required.includes("strengths"));
  assert.ok(assessment.required.includes("items"));
  assert.ok(assessment.required.includes("roadmap"));
  assert.deepEqual(assessment.properties.items.items.properties.type.enum, ["incomplete", "optimize", "deepen"]);
  assert.equal(assessment.properties.items.items.properties.evidence.minItems, 1);
});

test("each deep assessment item must expose its closure gap, failure mode and conclusion boundary", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/assessment.schema.json", import.meta.url), "utf8"));
  const item = schema.properties.assessment.properties.items.items;

  for (const field of ["confirmedGap", "professionalJudgment", "failureMode", "implementationSteps", "requiredEvidence", "conclusionBoundary", "closure"]) {
    assert.ok(item.required.includes(field), `${field} must be mandatory`);
  }
  assert.deepEqual(item.properties.closure.properties.status.enum, ["complete", "partial", "broken", "not_applicable"]);
  assert.ok(item.properties.closure.required.includes("detection"));
  assert.ok(item.properties.closure.required.includes("action"));
  assert.ok(item.properties.closure.required.includes("exitAndFeedback"));
});

test("the first-stage review map retains an exact evidence index for later focused passes", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/review-map.schema.json", import.meta.url), "utf8"));
  const reviewMap = schema.properties.reviewMap;
  assert.ok(reviewMap.required.includes("evidenceIndex"));
  const evidence = reviewMap.properties.evidenceIndex.items;
  assert.deepEqual(evidence.required, ["fileId", "fileName", "locationLabel", "quote", "relevance"]);
});

test("a critic timeout keeps the evidence-backed draft but marks the protocol incomplete", () => {
  const draftPayload = { assessment: { overallRating: "基础形成", items: [{ title: "闭环缺口" }] } };
  const result = resolveAssessmentStages({
    draftPayload,
    finalPayload: null,
    criticError: new Error("Codex analysis timed out"),
    manifest: { complete: true, omittedEntries: 0 },
  });

  assert.equal(result.payload, draftPayload);
  assert.equal(result.reviewProtocol.complete, false);
  assert.equal(result.reviewProtocol.stages.at(-1).status, "failed");
  assert.match(result.warnings[0], /反证复核未完成/);
});

test("compact paragraph references are expanded for traceable assessment evidence", () => {
  assert.deepEqual(
    extractReferencedParagraphLabels("第179段提出挂钩；第185、189、191、195、197段进一步说明应用。"),
    ["第179段", "第185段", "第189段", "第191段", "第195段", "第197段"],
  );
});

test("an assessment run returns a report separately from the issue list", async () => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "document-audit-assessment-"));
  process.env.WORKBENCH_DATA_DIR = isolatedRoot;
  process.env.WORKBENCH_USE_CODEX = "1";
  try {
    const storage = await import("../src/storage.mjs");
    const providers = await import("../src/providers/index.mjs");
    const analysis = await import("../src/analysis.mjs");
    providers.registerSemanticProvider({
      id: "assessment-test",
      label: "改进评估测试模型",
      priority: 2200,
      capabilities: { analysis: true, assessment: true, rewrite: false },
      isAvailable: async () => true,
      analyze: async () => ({ issues: [], diagnostics: {} }),
      assess: async ({ modules }) => {
        assert.deepEqual(modules, ["assessment"]);
        return {
          assessment: {
            overallRating: "较为完整",
            executiveSummary: "方案已经形成主体框架，但管理应用闭环仍可深化。",
            strengths: ["覆盖了压力情景、结果分析和方案重检"],
            items: [{
              type: "deepen",
              priority: "high",
              dimension: "管理应用",
              title: "将结果应用转化为触发矩阵",
              currentState: "文档已经提出结果应与风险偏好和限额管理挂钩。",
              recommendation: "补充触发指标、责任部门、处置动作和完成时限。",
              expectedValue: "形成从压力结果到管理动作的闭环。",
              evidence: [{ fileId: "main", fileName: "方案.docx", location: { label: "第1段" }, quote: "压力测试结果应与风险偏好和限额管理挂钩。" }],
            }],
            roadmap: [{ phase: "近期", objective: "补齐执行闭环", actions: ["建立触发矩阵"] }],
          },
          reviewProtocol: {
            version: "closure-review-v2",
            complete: true,
            stages: [
              { id: "reconstruct", status: "completed" },
              { id: "closure", status: "completed" },
              { id: "challenge", status: "completed" },
            ],
            source: { files: 1, entries: 1, packetCount: 1, omittedEntries: 0, complete: true },
          },
          warnings: ["测试：反证阶段存在非阻断提示。"],
          diagnostics: { mocked: true },
        };
      },
    });

    const project = await storage.createProject("整体改进评估回归");
    project.files = [{ id: "main", name: "方案.docx", extension: ".docx", role: "main", parse: { status: "ok" } }];
    await storage.saveProject(project);
    const extractedDir = join(storage.projectDir(project.id), "extracted");
    await mkdir(extractedDir, { recursive: true });
    await storage.writeJsonAtomic(join(extractedDir, "main.forensic.json"), {
      kind: "docx",
      blocks: [{ id: "p-1", type: "paragraph", text: "压力测试结果应与风险偏好和限额管理挂钩。", location: { kind: "paragraph", paragraph: 1, label: "第1段" } }],
      comments: [], revisions: { insertions: [], deletions: [] },
    });
    await writeFile(join(extractedDir, "main.md"), "压力测试结果应与风险偏好和限额管理挂钩。", "utf8");

    const run = await analysis.createAnalysisRun(project.id, { modules: ["assessment"], provider: "assessment-test" });
    await analysis.executeAnalysisRun(run);
    const completed = await analysis.loadRun(project.id, run.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerUsed, "assessment-test");
    assert.equal(completed.issues.length, 0, "assessment recommendations must not inflate issue counts");
    assert.equal(completed.assessment.items.length, 1);
    assert.equal(completed.assessment.items[0].type, "deepen");
    assert.equal(completed.assessment.items[0].evidence.length, 1);
    assert.equal(completed.reviewProtocol.version, "closure-review-v2");
    assert.equal(completed.reviewProtocol.stages.at(-1).id, "challenge");
    assert.equal(completed.reviewProtocol.source.omittedEntries, 0);
    assert.ok(completed.warnings.some(item => item.includes("非阻断提示")));

    const basicRun = await analysis.createAnalysisRun(project.id, { modules: ["logic"], provider: "deterministic" });
    basicRun.status = "completed";
    basicRun.progress = 100;
    basicRun.stage = "分析完成";
    basicRun.issues = [{
      id: "logic-existing",
      module: "logic",
      severity: "high",
      certainty: "confirmed",
      title: "既有基础问题",
      description: "该问题来自上一轮基础审查。",
      rationale: "用于验证局部重跑不会隐藏未重跑模块。",
      impact: "基础问题仍应可见。",
      evidence: [{ fileId: "main", fileName: "方案.docx", location: { label: "第1段" }, quote: "压力测试结果应与风险偏好和限额管理挂钩。" }],
      status: "open",
    }];
    basicRun.summary = { total: 1, high: 1, medium: 0, low: 0 };
    await analysis.saveRun(basicRun);

    const assessmentRefresh = await analysis.createAnalysisRun(project.id, { modules: ["assessment"], provider: "deterministic" });
    await analysis.executeAnalysisRun(assessmentRefresh);
    const refreshed = await analysis.loadRun(project.id, assessmentRefresh.id);
    const refreshedProject = await storage.loadProject(project.id);
    assert.deepEqual(refreshed.requestedModules, ["assessment"]);
    assert.deepEqual(new Set(refreshed.modules), new Set(["logic", "assessment"]));
    assert.equal(refreshed.issues.length, 1, "an assessment-only refresh must retain untouched basic findings");
    assert.equal(refreshed.issues[0].title, "既有基础问题");
    assert.deepEqual(new Set(refreshedProject.selectedModules), new Set(["logic", "assessment"]));
  } finally {
    delete process.env.WORKBENCH_DATA_DIR;
    delete process.env.WORKBENCH_USE_CODEX;
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});
