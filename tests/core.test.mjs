import test from "node:test";
import assert from "node:assert/strict";
import { runDeterministicAnalysis } from "../src/providers/deterministic.mjs";
import { deduplicateIssues, normalizeIssue } from "../src/issues.mjs";
import { issuesToCsv, issuesToHtml } from "../src/export.mjs";
import { applyMappingChoice } from "../src/mappings.mjs";

function documentItem(id, name, text, extra = {}) {
  return {
    file: { id, name, extension: ".docx" },
    forensic: {
      kind: "docx",
      blocks: [{ id: "p-1", type: "paragraph", text, location: { kind: "paragraph", paragraph: 1, label: "第1段" } }],
      comments: [],
      revisions: { insertions: [], deletions: [] },
      ...extra,
    },
  };
}

test("deterministic analysis separates conflict, omission, data, proofreading and revisions", async () => {
  const docA = documentItem("a", "主文档.docx", "合同金额为100万元。审批通过后生效。新增新增字段。", {
    revisions: { insertions: [{ text: "新增字段", location: { kind: "paragraph", paragraph: 1, label: "第1段" } }], deletions: [] },
  });
  const docB = documentItem("b", "实施方案.docx", "合同金额为90万元。");
  const sheet = {
    file: { id: "x", name: "台账.xlsx", extension: ".xlsx" },
    forensic: {
      kind: "xlsx",
      sheets: [{
        name: "汇总",
        state: "visible",
        cells: [
          { address: "A1", row: 1, column: 1, value: "合同金额" },
          { address: "B1", row: 1, column: 2, value: 900000 },
        ],
        hiddenRows: [], hiddenColumns: [],
      }],
    },
  };
  const issues = await runDeterministicAnalysis({ items: [docA, docB, sheet], modules: ["conflict", "logic", "data", "proofread", "version"] });
  assert.ok(issues.some(issue => issue.module === "conflict"));
  assert.ok(issues.some(issue => issue.module === "logic" && issue.inferenceLevel === "confirmable_omission"));
  assert.ok(issues.some(issue => issue.module === "data"));
  assert.ok(issues.some(issue => issue.module === "proofread"));
  assert.ok(issues.some(issue => issue.module === "version"));
  assert.ok(issues.every(issue => issue.evidence.length > 0));
});

test("issue normalization is stable and deduplication preserves one copy", () => {
  const candidate = normalizeIssue({
    module: "logic", title: "审批主体缺失", summary: "示例", evidence: [{ fileId: "a", fileName: "a.docx", location: { label: "第1段" }, quote: "审批后生效" }],
  });
  const repeated = deduplicateIssues([candidate, { ...candidate }]);
  assert.equal(repeated.length, 1);
  assert.match(repeated[0].id, /^[a-f0-9]{16}$/);
});

test("HTML and CSV exports retain issue and evidence", () => {
  const issue = normalizeIssue({
    module: "conflict", category: "跨文档冲突", severity: "high", title: "审批主体不一致", summary: "两处原文不同", basis: "同场景", impact: "执行口径不一", confidence: 0.9,
    evidence: [{ fileId: "a", fileName: "制度.docx", location: { label: "第3段" }, quote: "由董事会批准" }],
  });
  const run = { issues: [issue], summary: { total: 1, high: 1, medium: 0, low: 0 }, updatedAt: new Date().toISOString() };
  const project = { name: "审查任务" };
  assert.match(issuesToCsv(run), /审批主体不一致/);
  assert.match(issuesToHtml(project, run), /由董事会批准/);
});

test("offline HTML export includes the complete improvement assessment", () => {
  const run = {
    issues: [],
    summary: { total: 0, high: 0, medium: 0, low: 0 },
    coverage: { checked: 23, total: 23, complete: true },
    assessment: {
      overallRating: "较为完整",
      executiveSummary: "报告基础较好，但管理应用仍可深化。",
      strengths: ["已明确压力测试总体目标"],
      items: [{
        type: "deepen", priority: "high", dimension: "管理应用", title: "建立结果触发矩阵",
        currentState: "正文仅原则性说明结果用于风险管理。",
        recommendation: "将阈值、责任部门、处置动作和时限形成矩阵。",
        expectedValue: "把分析结果转化为可执行动作。",
        evidence: [{ fileName: "方案.docx", location: { page: 3, label: "第18段" }, quote: "压力测试结果用于风险管理。" }],
      }],
      roadmap: [{ phase: "近期", objective: "补齐管理闭环", actions: ["建立结果触发矩阵"] }],
    },
    updatedAt: new Date().toISOString(),
  };
  const html = issuesToHtml({ name: "完整离线报告" }, run);
  assert.match(html, /整份报告改进评估/);
  assert.match(html, /建立结果触发矩阵/);
  assert.match(html, /第3页/);
  assert.match(html, /固定清单覆盖/);
});

test("version comparison prioritizes critical paired changes", async () => {
  const base = documentItem("base", "制度_v1.docx", "审批通过后，由董事会批准，金额为100万元。", {});
  const current = documentItem("current", "制度_v2.docx", "审批通过后，由总经理办公会批准，金额为120万元。", {});
  base.file.role = "version-base";
  current.file.role = "version-current";
  const issues = await runDeterministicAnalysis({ items: [base, current], modules: ["version"] });
  const change = issues.find(issue => issue.category === "关键内容修改");
  assert.ok(change);
  assert.equal(change.severity, "high");
  assert.equal(change.evidence.length, 2);
});

test("single-document conflicts are detected and evidence quotes remain source-exact", async () => {
  const item = documentItem("single", "制度.docx", "", {
    blocks: [
      { id: "p-1", type: "paragraph", text: "合同金额为100万元。", location: { kind: "paragraph", paragraph: 1, label: "第1段" } },
      { id: "p-2", type: "paragraph", text: "合同金额为120万元。", location: { kind: "paragraph", paragraph: 2, label: "第2段" } },
    ],
  });
  const issues = await runDeterministicAnalysis({ items: [item], modules: ["conflict"] });
  const conflict = issues.find(issue => issue.category === "单文档数值冲突");
  assert.ok(conflict);
  assert.equal(conflict.evidence.length, 2);
  assert.ok(conflict.evidence.every(itemEvidence => item.forensic.blocks.some(block => block.text.includes(itemEvidence.quote))));
  assert.ok(conflict.evidence.every(itemEvidence => itemEvidence.verification === "exact-source-match"));
});

test("document display precision prevents false spreadsheet differences", async () => {
  const document = documentItem("doc", "报告.docx", "合同金额为1.25亿元。");
  const workbook = {
    file: { id: "book", name: "台账.xlsx", extension: ".xlsx" },
    forensic: {
      kind: "xlsx",
      sheets: [{
        name: "汇总", state: "visible", hiddenRows: [], hiddenColumns: [],
        cells: [
          { address: "A1", row: 1, column: 1, value: "合同金额" },
          { address: "B1", row: 1, column: 2, value: 124980000 },
        ],
      }],
    },
  };
  const issues = await runDeterministicAnalysis({ items: [document, workbook], modules: ["data"] });
  assert.ok(!issues.some(issue => issue.category === "文档与表格数据差异"));
});

test("proofreading only flags an isolated format outlier between matching peers", async () => {
  const common = { style: "Normal", numbering: null };
  const item = documentItem("format", "排版.docx", "", {
    blocks: [
      { id: "p-1", type: "paragraph", text: "第一段采用正文统一格式。", format: { ...common, runFormats: { "宋体|24||": 1 } }, location: { kind: "paragraph", paragraph: 1, label: "第1段" } },
      { id: "p-2", type: "paragraph", text: "第二段意外变成其他格式。", format: { ...common, runFormats: { "黑体|32|b|": 1 } }, location: { kind: "paragraph", paragraph: 2, label: "第2段" } },
      { id: "p-3", type: "paragraph", text: "第三段恢复正文统一格式。", format: { ...common, runFormats: { "宋体|24||": 1 } }, location: { kind: "paragraph", paragraph: 3, label: "第3段" } },
    ],
  });
  const issues = await runDeterministicAnalysis({ items: [item], modules: ["proofread"] });
  const anomaly = issues.find(issue => issue.category === "明显格式异常提示");
  assert.ok(anomaly);
  assert.equal(anomaly.evidence[0].location.label, "第2段");
});

test("proofreading does not treat a bold manual heading between body paragraphs as an anomaly", async () => {
  const common = { style: "Normal", numbering: null };
  const item = documentItem("format-heading", "排版.docx", "", {
    blocks: [
      { id: "p-1", type: "paragraph", text: "前一段是详细的正文说明内容。", format: { ...common, runFormats: { "宋体|24||": 1 } }, location: { kind: "paragraph", paragraph: 1, label: "第1段" } },
      { id: "p-2", type: "paragraph", text: "（1）计算各期限点对应的实际到期日", format: { ...common, runFormats: { "宋体|24|b|": 1 } }, location: { kind: "paragraph", paragraph: 2, label: "第2段" } },
      { id: "p-3", type: "paragraph", text: "后一段继续提供详细的正文说明。", format: { ...common, runFormats: { "宋体|24||": 1 } }, location: { kind: "paragraph", paragraph: 3, label: "第3段" } },
    ],
  });
  const issues = await runDeterministicAnalysis({ items: [item], modules: ["proofread"] });
  assert.ok(!issues.some(issue => issue.category === "明显格式异常提示"));
});

test("ambiguous document-to-Excel fields wait for confirmation, then recalculate and persist mapping", async () => {
  const document = documentItem("doc", "报告.docx", "合同金额为100万元。");
  const workbook = {
    file: { id: "book", name: "台账.xlsx", extension: ".xlsx" },
    forensic: {
      kind: "xlsx",
      sheets: [{
        name: "合同台账", state: "visible", hiddenRows: [], hiddenColumns: [],
        cells: [
          { address: "A1", row: 1, column: 1, value: "含税合同金额" },
          { address: "B1", row: 1, column: 2, value: 1100000 },
          { address: "A2", row: 2, column: 1, value: "不含税合同金额" },
          { address: "B2", row: 2, column: 2, value: 900000 },
        ],
      }],
    },
  };
  const issues = await runDeterministicAnalysis({ items: [document, workbook], modules: ["data"] });
  const ambiguous = issues.find(issue => issue.category === "字段匹配待确认");
  assert.ok(ambiguous);
  assert.equal(ambiguous.mapping.status, "unconfirmed");
  assert.equal(ambiguous.mapping.candidates.length, 2);
  assert.ok(!issues.some(issue => issue.category === "文档与表格数据差异"));

  const project = { fieldMappings: {} };
  const run = { issues: [ambiguous], summary: {} };
  const selected = ambiguous.mapping.candidates[0];
  applyMappingChoice({ project, run, issue: ambiguous, candidateId: selected.id });
  assert.equal(ambiguous.mapping.status, "confirmed");
  assert.equal(ambiguous.category, "文档与表格数据差异");
  assert.equal(ambiguous.severity, "high");
  assert.equal(ambiguous.evidence.length, 2);
  assert.equal(project.fieldMappings[ambiguous.mapping.key].candidateId, selected.id);

  const rerun = await runDeterministicAnalysis({ items: [document, workbook], modules: ["data"], fieldMappings: project.fieldMappings });
  assert.ok(rerun.some(issue => issue.category === "文档与表格数据差异"));
  assert.ok(!rerun.some(issue => issue.category === "字段匹配待确认"));
});
