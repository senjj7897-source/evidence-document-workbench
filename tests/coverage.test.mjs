import test from "node:test";
import assert from "node:assert/strict";
import { buildCoveragePlan, finalizeCoverage } from "../src/coverage.mjs";

test("comprehensive review creates an explicit checklist and source coverage manifest", () => {
  const plan = buildCoveragePlan({
    modules: ["logic", "proofread", "deep"],
    items: [{
      file: { id: "doc", name: "方案.docx" },
      forensic: { blocks: [
        { text: "第一段", location: { label: "第1段" } },
        { text: "第二段内容", location: { label: "第2段" } },
      ] },
    }],
  });

  assert.equal(plan.source.files, 1);
  assert.equal(plan.source.blocks, 2);
  assert.equal(plan.source.characters, 8);
  assert.ok(plan.expectedChecks.some(item => item.module === "logic" && item.dimension === "责任主体"));
  assert.ok(plan.expectedChecks.some(item => item.module === "deep" && item.dimension === "管理应用"));
});

test("coverage finalization exposes missing model checks instead of claiming completeness", () => {
  const plan = buildCoveragePlan({ modules: ["logic"], items: [] });
  const result = finalizeCoverage(plan, [{ module: "logic", dimension: "定义与术语", status: "no_finding", notes: "已检查" }]);

  assert.ok(result.checked < result.total);
  assert.ok(result.checks.some(item => item.status === "blocked" && item.notes.includes("模型未返回")));
  assert.equal(result.complete, false);
});

test("a returned coverage label is not counted unless its review evidence is explicit", () => {
  const plan = buildCoveragePlan({ modules: ["logic"], items: [] });
  const dimensions = plan.expectedChecks.map(item => ({
    ...item,
    status: "no_finding",
    notes: "已检查，未发现问题。",
    evidenceLabels: [],
    counterEvidenceChecked: false,
  }));
  const result = finalizeCoverage(plan, dimensions);

  assert.equal(result.checked, 0);
  assert.equal(result.complete, false);
  assert.ok(result.checks.every(item => item.status === "blocked"));
  assert.ok(result.checks[0].notes.includes("审查依据不足"));
});

test("no-finding coverage is counted only after evidence and counterevidence review", () => {
  const plan = buildCoveragePlan({ modules: ["logic"], items: [] });
  const dimensions = plan.expectedChecks.map(item => ({
    ...item,
    status: "no_finding",
    notes: "已检查全文相关段落，未形成可证实问题。",
    evidenceLabels: ["第1段", "第20段"],
    counterEvidenceChecked: true,
  }));
  const result = finalizeCoverage(plan, dimensions);

  assert.equal(result.checked, result.total);
  assert.equal(result.complete, true);
});
