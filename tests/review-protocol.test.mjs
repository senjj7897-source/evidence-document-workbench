import test from "node:test";
import assert from "node:assert/strict";
import { createReviewPackets } from "../src/review-protocol.mjs";
import { createReviewCsvBundle } from "../src/review-csv.mjs";

test("deep review packets cover the complete document instead of silently truncating the tail", () => {
  const items = [{
    file: { id: "doc", name: "长方案.docx" },
    forensic: {
      kind: "docx",
      blocks: Array.from({ length: 30 }, (_, index) => ({
        id: `p-${index + 1}`,
        text: `${String(index + 1).padStart(2, "0")}-${"内容".repeat(12)}`,
        location: { label: `第${index + 1}段` },
      })),
    },
  }];

  const review = createReviewPackets(items, { maxCharacters: 240 });
  const combined = review.packets.map(packet => packet.content).join("\n");

  assert.ok(review.packets.length > 1, "long sources should be partitioned");
  assert.match(combined, /\[第1段\].*01-/);
  assert.match(combined, /\[第30段\].*30-/);
  assert.equal(review.manifest.omittedEntries, 0);
  assert.equal(review.manifest.entries, 30);
  assert.equal(review.manifest.complete, true);
});

test("deep review packets include worksheet cells from embedded attachments", () => {
  const items = [{
    file: { id: "doc", name: "方案.docx" },
    forensic: {
      kind: "docx",
      blocks: [{ id: "p-1", text: "正文", location: { label: "第1段" } }],
      embeddedWorkbooks: [{
        name: "情景库.xlsx",
        sheets: [{ name: "参数", cells: [
          { address: "A1", value: "情景名称" },
          { address: "B2", value: "上移120bps", formula: null },
        ] }],
      }],
    },
  }];

  const review = createReviewPackets(items, { maxCharacters: 500 });
  const combined = review.packets.map(packet => packet.content).join("\n");

  assert.match(combined, /附件:情景库\.xlsx\/参数!A1/);
  assert.match(combined, /上移120bps/);
  assert.equal(review.manifest.attachments, 1);
  assert.equal(review.manifest.cells, 2);
});

test("Word tables are expanded to their complete cell grid instead of a short preview", () => {
  const rows = Array.from({ length: 8 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({
    row: row + 1,
    column: column + 1,
    address: `R${row + 1}C${column + 1}`,
    text: row === 7 && column === 3 ? "最后一个关键阈值" : `${row + 1}-${column + 1}`,
  })));
  const review = createReviewPackets([{
    file: { id: "doc", name: "方案.docx" },
    forensic: { kind: "docx", blocks: [{
      id: "table-1",
      type: "table",
      text: "旧的前三行预览",
      rows,
      location: { label: "表格1" },
    }] },
  }]);
  const combined = review.packets.map(packet => packet.content).join("\n");

  assert.match(combined, /\[表格1!R8C4\] 最后一个关键阈值/);
  assert.equal(review.manifest.tableCells, 32);
});

test("review material can be persisted as separate narrative, table and worksheet CSV layers", () => {
  const review = createReviewPackets([{
    file: { id: "doc", name: "方案.docx" },
    forensic: {
      blocks: [
        { id: "p-1", type: "paragraph", text: "应急管理", location: { label: "第1段" } },
        { id: "table-1", type: "table", rows: [[{ row: 1, column: 1, address: "R1C1", text: "阈值" }]], location: { label: "表格1" } },
      ],
      embeddedWorkbooks: [{ name: "指标.xlsx", sheets: [{ name: "预警", cells: [{ address: "A1", value: "指标名称" }] }] }],
    },
  }]);
  const bundle = createReviewCsvBundle(review);

  assert.match(bundle.narrative, /应急管理/);
  assert.match(bundle.tables, /表格1!R1C1/);
  assert.match(bundle.worksheets, /附件:指标.xlsx\/预警!A1/);
  assert.ok(bundle.narrative.startsWith("\ufeff"), "CSV should be Excel-friendly UTF-8 with BOM");
});
