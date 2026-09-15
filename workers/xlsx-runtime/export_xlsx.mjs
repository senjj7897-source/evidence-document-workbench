import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const [inputPath, outputPath, validationPath, previewDir] = process.argv.slice(2);
if (!inputPath || !outputPath || !validationPath || !previewDir) {
  throw new Error("Usage: export_xlsx.mjs <input.json> <output.xlsx> <validation.json> <preview-dir>");
}

const { project, run } = JSON.parse(await fs.readFile(inputPath, "utf8"));
const severityOrder = { high: 0, medium: 1, low: 2 };
const issues = (Array.isArray(run.issues) ? [...run.issues] : []).sort((left, right) => (
  Number(left.status !== "open") - Number(right.status !== "open")
  || severityOrder[left.severity] - severityOrder[right.severity]
));
const severityText = { high: "高", medium: "中", low: "低" };
const statusText = { open: "待处理", resolved: "已解决", ignored: "已忽略" };
const inferenceText = { fact: "直接事实", confirmable_omission: "可确认缺口", risk_inference: "风险推断" };
const moduleText = { conflict: "冲突检测", logic: "逻辑闭环", data: "数据核验", proofread: "文字校对", sentence: "逐句精审", writing: "写作优化", version: "版本差异", open: "开放发现", deep: "深度建议", assessment: "改进评估" };

function clean(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function truncate(value, limit = 160) {
  const text = clean(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function locationText(item) {
  const location = item?.location || {};
  const parts = [];
  const page = location.page || location.pageHint;
  if (page) parts.push(`第${page}页`);
  if (location.label && location.label !== `第${page}页`) parts.push(location.label);
  if (location.sheet) parts.push(`工作表:${location.sheet}`);
  if (location.cell) parts.push(`单元格:${location.cell}`);
  return parts.filter(Boolean).join(" · ") || "文件级";
}

function setWidth(sheet, column, width) {
  sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

function styleTitle(sheet, range) {
  range.format = {
    fill: "#17365D",
    font: { bold: true, color: "#FFFFFF", size: 18 },
    verticalAlignment: "center",
  };
}

function styleHeader(range) {
  range.format = {
    fill: "#DCE6F1",
    font: { bold: true, color: "#17365D" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#9FB6CE" },
  };
}

const workbook = Workbook.create();
const summary = workbook.worksheets.add("审查汇总");
const detail = workbook.worksheets.add("问题清单");
const evidence = workbook.worksheets.add("证据明细");

// 问题清单
detail.showGridLines = false;
detail.getRange("A1:R2").merge();
detail.getRange("A1").values = [[`${project.name || "审查任务"} · 问题清单`]];
styleTitle(detail, detail.getRange("A1:R2"));
detail.getRange("A3:R3").merge();
detail.getRange("A3").values = [[`运行 ${run.id || "-"} · ${run.providerUsed || run.providerRequested || "-"} · ${run.completedAt || run.updatedAt || "-"}`]];
detail.getRange("A3:R3").format = { fill: "#EEF3F8", font: { color: "#52657A" } };
const issueHeaders = ["序号", "严重程度", "模块", "问题类别", "问题标题", "结论", "分析依据", "可能影响", "结论层级", "置信度", "处理状态", "涉及文档", "证据数", "原文位置摘要", "原文证据摘要", "候选改写/已采纳文本", "修改理由", "问题ID"];
detail.getRange("A6:R6").values = [issueHeaders];
styleHeader(detail.getRange("A6:R6"));
const issueRows = issues.map((issue, index) => {
  const accepted = issue.acceptedSuggestion?.text;
  return [
    index + 1,
    severityText[issue.severity] || clean(issue.severity),
    moduleText[issue.module] || clean(issue.module),
    clean(issue.category),
    clean(issue.title),
    clean(issue.summary),
    clean(issue.basis),
    clean(issue.impact),
    inferenceText[issue.inferenceLevel] || clean(issue.inferenceLevel),
    Number(issue.confidence || 0),
    statusText[issue.status] || clean(issue.status),
    (issue.documents || []).join("；"),
    (issue.evidence || []).length,
    [
      ...(issue.evidence || []).slice(0, 3).map(item => locationText(item)),
      ...((issue.evidence || []).length > 3 ? [`其余${(issue.evidence || []).length - 3}条见“证据明细”`] : []),
    ].join("；"),
    [
      ...(issue.evidence || []).slice(0, 1).map(item => truncate(item.quote, 120)),
      ...((issue.evidence || []).length > 1 ? [`其余${(issue.evidence || []).length - 1}条见“证据明细”`] : []),
    ].join("；"),
    clean(accepted || issue.suggestedText),
    clean(issue.rewriteReason),
    clean(issue.id),
  ];
});
const issueDataRows = issueRows.length ? issueRows : [Array(issueHeaders.length).fill(null)];
const issueEnd = 6 + issueDataRows.length;
detail.getRange(`A7:R${issueEnd}`).values = issueDataRows;
detail.getRange(`A7:R${issueEnd}`).format = { verticalAlignment: "top", wrapText: true };
detail.getRange(`J7:J${issueEnd}`).format.numberFormat = "0%";
detail.getRange(`A6:R${issueEnd}`).format.borders = { insideHorizontal: { style: "thin", color: "#D9E2EC" }, bottom: { style: "thin", color: "#9FB6CE" } };
const issueTable = detail.tables.add(`A6:R${issueEnd}`, true, "AuditIssuesTable");
issueTable.style = "TableStyleMedium2";
issueTable.showFilterButton = true;
if (issues.length) {
  detail.getRange(`K7:K${issueEnd}`).dataValidation = { rule: { type: "list", values: ["待处理", "已解决", "已忽略"] } };
  detail.getRange(`B7:B${issueEnd}`).conditionalFormats.add("containsText", { text: "高", format: { fill: "#FDE9EC", font: { color: "#A61B2B", bold: true } } });
  detail.getRange(`B7:B${issueEnd}`).conditionalFormats.add("containsText", { text: "中", format: { fill: "#FFF0D6", font: { color: "#8A5300", bold: true } } });
  detail.getRange(`B7:B${issueEnd}`).conditionalFormats.add("containsText", { text: "低", format: { fill: "#E8F1FB", font: { color: "#1C5D99" } } });
}
detail.freezePanes.freezeRows(6);
detail.freezePanes.freezeColumns(4);
[["A",7],["B",10],["C",13],["D",17],["E",28],["F",34],["G",30],["H",24],["I",13],["J",10],["K",11],["L",26],["M",9],["N",34],["O",44],["P",40],["Q",28],["R",19]].forEach(([column,width]) => setWidth(detail, column, width));

// 证据明细
evidence.showGridLines = false;
evidence.getRange("A1:M2").merge();
evidence.getRange("A1").values = [[`${project.name || "审查任务"} · 证据明细`]];
styleTitle(evidence, evidence.getRange("A1:M2"));
evidence.getRange("A3:M3").merge();
evidence.getRange("A3").values = [["每条问题展开为可追溯的原文证据；结论与证据分开保存。"]];
evidence.getRange("A3:M3").format = { fill: "#EEF3F8", font: { color: "#52657A" } };
const evidenceHeaders = ["证据序号", "问题ID", "严重程度", "模块", "问题类别", "问题标题", "文件", "位置", "证据原文", "解析器", "核验状态", "结论层级", "问题状态"];
evidence.getRange("A6:M6").values = [evidenceHeaders];
styleHeader(evidence.getRange("A6:M6"));
const evidenceRows = [];
for (const issue of issues) {
  for (const item of issue.evidence || []) {
    evidenceRows.push([
      evidenceRows.length + 1,
      clean(issue.id),
      severityText[issue.severity] || clean(issue.severity),
      moduleText[issue.module] || clean(issue.module),
      clean(issue.category),
      clean(issue.title),
      clean(item.fileName),
      locationText(item),
      clean(item.quote),
      clean(item.parser),
      item.verification === "exact-source-match" ? "原文精确匹配" : item.verification === "structure-derived" ? "结构属性核验" : clean(item.verification || "待复核"),
      inferenceText[issue.inferenceLevel] || clean(issue.inferenceLevel),
      statusText[issue.status] || clean(issue.status),
    ]);
  }
}
const evidenceDataRows = evidenceRows.length ? evidenceRows : [Array(evidenceHeaders.length).fill(null)];
const evidenceEnd = 6 + evidenceDataRows.length;
evidence.getRange(`A7:M${evidenceEnd}`).values = evidenceDataRows;
evidence.getRange(`A7:M${evidenceEnd}`).format = { verticalAlignment: "top", wrapText: true };
const evidenceTable = evidence.tables.add(`A6:M${evidenceEnd}`, true, "AuditEvidenceTable");
evidenceTable.style = "TableStyleMedium2";
evidenceTable.showFilterButton = true;
evidence.freezePanes.freezeRows(6);
evidence.freezePanes.freezeColumns(4);
[["A",10],["B",19],["C",10],["D",13],["E",17],["F",28],["G",36],["H",24],["I",58],["J",18],["K",16],["L",14],["M",12]].forEach(([column,width]) => setWidth(evidence, column, width));

// 审查汇总（全部指标由工作表公式驱动）
summary.showGridLines = false;
summary.getRange("A1:H2").merge();
summary.getRange("A1").values = [[`${project.name || "审查任务"} · 审查汇总`]];
styleTitle(summary, summary.getRange("A1:H2"));
summary.getRange("A3:H3").merge();
summary.getRange("A3").values = [[`文件 ${project.files?.length || 0} 份 · 分析模块 ${(run.modules || []).map(item => moduleText[item] || item).join("、") || "-"} · 完成时间 ${run.completedAt || run.updatedAt || "-"}`]];
summary.getRange("A3:H3").format = { fill: "#EEF3F8", font: { color: "#52657A" } };
summary.getRange("A5:H5").values = [["全部问题", null, "高影响", null, "待处理", null, "证据数", null]];
summary.getRange("A6:H6").formulas = [[`=COUNTA('问题清单'!$R$7:$R$${issueEnd})`, null, `=COUNTIF('问题清单'!$B$7:$B$${issueEnd},"高")`, null, `=COUNTIF('问题清单'!$K$7:$K$${issueEnd},"待处理")`, null, `=COUNTA('证据明细'!$A$7:$A$${evidenceEnd})`, null]];
[["A5:B6","#EAF1FB"],["C5:D6","#FDE9EC"],["E5:F6","#FFF0D6"],["G5:H6","#E8F5EE"]].forEach(([range,fill]) => {
  summary.getRange(range).format = { fill, borders: { preset: "outside", style: "thin", color: "#B7C7D8" } };
});
summary.getRange("A5:H5").format.font = { bold: true, color: "#52657A" };
summary.getRange("A6:H6").format.font = { bold: true, color: "#17365D", size: 18 };
summary.getRange("A8:D8").merge();
summary.getRange("A8").values = [["按模块和严重程度统计"]];
summary.getRange("A8:D8").format = { fill: "#DCE6F1", font: { bold: true, color: "#17365D" } };
summary.getRange("A9:D9").values = [["模块", "全部", "高影响", "待处理"]];
styleHeader(summary.getRange("A9:D9"));
const modules = (run.modules?.length ? run.modules : Object.keys(moduleText));
const summaryEnd = 9 + modules.length;
summary.getRange(`A10:A${summaryEnd}`).values = modules.map(module => [moduleText[module] || module]);
summary.getRange("B10").formulas = [[`=COUNTIF('问题清单'!$C$7:$C$${issueEnd},A10)`]];
summary.getRange(`B10:B${summaryEnd}`).fillDown();
summary.getRange("C10").formulas = [[`=COUNTIFS('问题清单'!$C$7:$C$${issueEnd},A10,'问题清单'!$B$7:$B$${issueEnd},"高")`]];
summary.getRange(`C10:C${summaryEnd}`).fillDown();
summary.getRange("D10").formulas = [[`=COUNTIFS('问题清单'!$C$7:$C$${issueEnd},A10,'问题清单'!$K$7:$K$${issueEnd},"待处理")`]];
summary.getRange(`D10:D${summaryEnd}`).fillDown();
summary.getRange(`A9:D${summaryEnd}`).format.borders = { insideHorizontal: { style: "thin", color: "#D9E2EC" }, outside: { style: "thin", color: "#9FB6CE" } };
summary.getRange("F8:H8").merge();
summary.getRange("F8").values = [["结论边界"]];
summary.getRange("F8:H8").format = { fill: "#DCE6F1", font: { bold: true, color: "#17365D" } };
summary.getRange("F9:H14").merge();
summary.getRange("F9").values = [["本工作簿将直接事实、可确认缺口与风险推断分开。原文证据保存在“证据明细”；数据不一致默认只报差异，仅在有权威依据或可复算公式时判断错误方。"]];
summary.getRange("F9:H14").format = { fill: "#F7F9FC", wrapText: true, verticalAlignment: "top", borders: { preset: "outside", style: "thin", color: "#B7C7D8" } };
summary.freezePanes.freezeRows(3);
[["A",18],["B",12],["C",12],["D",12],["E",3],["F",18],["G",18],["H",18]].forEach(([column,width]) => setWidth(summary, column, width));
summary.getRange("1:2").format.rowHeight = 28;

// 在所有结构与格式操作完成后再设置冻结窗格，防止后续工作表更新覆盖 pane 状态。
summary.freezePanes.freezeRows(3);
detail.freezePanes.freezeRows(6);
detail.freezePanes.freezeColumns(4);
evidence.freezePanes.freezeRows(6);
evidence.freezePanes.freezeColumns(4);

await fs.mkdir(previewDir, { recursive: true });
const previewSpecs = [
  { sheetName: "审查汇总", range: `A1:H${Math.max(15, summaryEnd)}`, file: "summary.png" },
  { sheetName: "问题清单", range: `A1:R${Math.min(issueEnd, 12)}`, file: "issues.png" },
  { sheetName: "证据明细", range: `A1:M${Math.min(evidenceEnd, 12)}`, file: "evidence.png" },
];
for (const spec of previewSpecs) {
  const blob = await workbook.render({ sheetName: spec.sheetName, range: spec.range, scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}/${spec.file}`, new Uint8Array(await blob.arrayBuffer()));
}

const keyRanges = [];
for (const spec of [
  { sheetId: "审查汇总", range: `A1:H${Math.max(15, summaryEnd)}` },
  { sheetId: "问题清单", range: `A1:R${Math.min(issueEnd, 12)}` },
  { sheetId: "证据明细", range: `A1:M${Math.min(evidenceEnd, 12)}` },
]) {
  const inspected = await workbook.inspect({ kind: "region", sheetId: spec.sheetId, range: spec.range, maxChars: 5000 });
  keyRanges.push({ ...spec, ndjson: inspected.ndjson });
}
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 5000,
});
const validation = {
  generatedAt: new Date().toISOString(),
  workbook: { sheets: ["审查汇总", "问题清单", "证据明细"], issueCount: issues.length, evidenceCount: evidenceRows.length },
  previews: previewSpecs,
  keyRanges,
  formulaErrorScan: formulaErrors.ndjson,
};
await fs.writeFile(validationPath, JSON.stringify(validation, null, 2), "utf8");
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await new Promise(resolveWrite => process.stdout.write(`${JSON.stringify({ outputPath, validationPath, previewDir, issueCount: issues.length, evidenceCount: evidenceRows.length })}\n`, resolveWrite));
// artifact-tool 在部分 Windows 桌面运行时上完成导出后的原生资源析构可能触发异常退出。
// 此处所有文件写入与校验均已 await，显式正常退出避免将已成功的产物误报为失败。
process.exit(0);
