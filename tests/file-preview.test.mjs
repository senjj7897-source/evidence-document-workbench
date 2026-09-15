import test from "node:test";
import assert from "node:assert/strict";
import { renderPreviewMarkdown } from "../app/file-preview.js";

test("file preview renders headings, lists and table rows without trusting document HTML", () => {
  const html = renderPreviewMarkdown([
    "# 审查材料",
    "- 第一项",
    "| 字段 | 数值 |",
    "| --- | --- |",
    "| 金额 | 1200 |",
    '<script>alert("document instruction")</script>',
  ].join("\n"));

  assert.match(html, /class="preview-heading"/);
  assert.match(html, /class="preview-list"/);
  assert.equal((html.match(/class="preview-table-row"/g) || []).length, 2);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("file preview exposes an explicit empty state", () => {
  assert.match(renderPreviewMarkdown("\n\n"), /没有可显示的解析内容/);
});
