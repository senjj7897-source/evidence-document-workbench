import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("navigation rail keeps consistent controls and explicit interaction semantics", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(app, /ph-sliders-horizontal/, "task settings should not use an ambiguous slider glyph");
  assert.match(app, /ph-gear-six/, "task settings should use a conventional settings glyph");
  assert.match(app, /aria-current="page"/, "the active rail destination must be exposed semantically");
  assert.equal((app.match(/class="rail-tooltip"/g) || []).length, 3, "every rail action needs a visible label on hover or focus");
  assert.match(styles, /\.rail-action\s*\{[^}]*background:[^;]+;[^}]*border:[^;]+;/s, "all rail actions should share the same framed hit target");
  assert.match(styles, /\.rail-action\.active\s*\{[^}]*box-shadow:[^;]+;/s, "the active destination needs a stable state marker");
  assert.match(styles, /\.rail-action:hover \.rail-tooltip, \.rail-action:focus-visible \.rail-tooltip/, "tooltips must work for pointer and keyboard users");
  assert.match(app, /调整当前任务/, "editing the active task needs an explicit label");
  assert.match(app, /新建审查任务/, "creating an independent task needs an explicit label");
  assert.match(app, /原任务结果仍然保留/, "starting a new task should confirm that the previous result is retained");
  assert.match(styles, /\.left-panel\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*thin;/s, "the context column should own one thin scrollbar");
  assert.match(styles, /\.left-panel::-webkit-scrollbar-button\s*\{[^}]*display:\s*none;/s, "native scrollbar arrow buttons must stay hidden");
  assert.doesNotMatch(styles, /\.context-section\s*\{[^}]*overflow:\s*auto;/s, "nested context sections must not create a second scrollbar");
  assert.match(app, /data-preview-file=/, "source files must expose a clickable preview action");
  assert.match(app, /close-file-preview/, "file preview needs an explicit return path to the workbench");
  assert.match(app, /点击查看内容/, "the source list must communicate that files are interactive");
});

test("the original workbench exposes an open AI discovery lane without mixing suggestions with defects", async () => {
  const [app, styles, storage] = await Promise.all([
    readFile(new URL("../app/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/storage.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(app, /open:\s*"ph-sparkle"/, "open discovery needs a recognizable model-assisted icon");
  assert.match(app, /open:\s*"开放发现"/, "open discovery must remain visible in filters and issue metadata");
  assert.match(app, /AI开放判断/, "the setup card must disclose that the lane depends on a semantic model");
  assert.match(app, /findingType\s*===\s*"improvement"/, "improvements need a distinct presentation from evidenced defects");
  assert.match(styles, /\.tag\.improvement/, "improvement suggestions need their own low-noise visual treatment");
  assert.match(storage, /selectedModules:\s*\["conflict",\s*"logic",\s*"data",\s*"proofread",\s*"open"\]/, "new tasks should reserve the open discovery lane by default");
});

test("the setup and review views expose deep professional recommendations as a selectable module", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /deep:\s*"ph-strategy"/, "deep analysis needs a distinct professional strategy icon");
  assert.match(app, /deep:\s*"深度建议"/, "deep recommendations must remain visible in filters and issue metadata");
  assert.match(app, /recommendAnalysisModules\(files\)/, "document uploads should use the file-aware module recommender");
  assert.match(app, /id="mobile-module-filter"/, "compact layouts need a visible module switcher when the context column collapses");
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*\.mobile-module-filter\s*\{[^}]*display:/, "the compact module switcher should be revealed at the mobile breakpoint");
});

test("the improvement assessment opens as a standalone report instead of issue rows", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /assessment:\s*"ph-chart-polar"/, "the report module needs a distinct assessment icon");
  assert.match(app, /assessment:\s*"改进评估"/, "the report module must remain visible in navigation");
  assert.match(app, /function assessmentPanel\(/, "the report needs its own presentation surface");
  assert.match(app, /state\.moduleFilter\s*===\s*"assessment"[\s\S]{0,160}assessmentPanel\(\)/, "selecting assessment must bypass the issue queue");
  assert.match(app, /不完整|可优化|可深化/, "the report must distinguish all three improvement lenses");
  assert.match(app, /先做这三件事/, "readers need a short priority list before the full assessment");
  for (const label of ["原文现在写了什么", "可以确认缺什么", "专业评估", "执行闭环", "具体怎么改", "本次不能断定", "改完能得到什么"]) {
    assert.match(app, new RegExp(label), `assessment reading flow must expose ${label}`);
  }
  assert.match(app, /<details id="assessment-\$\{group\.type\}"/, "full recommendation groups should use progressive disclosure");
  assert.match(styles, /\.assessment-item\s*\{[^}]*padding:\s*0;[^}]*border:[^}]*border-radius:/s, "each recommendation should render as one continuous card instead of nested white panels");
  assert.match(styles, /\.assessment-reading-flow\s*\{[^}]*margin:\s*0;[^}]*border:\s*0;/s, "the reading flow must share the same edges as the recommendation header");
  assert.match(styles, /\.assessment-reading-step p\s*\{[^}]*font-size:\s*13px;/s, "assessment body text must remain readable in the workbench");
});

test("evidence locations show document and page while single-file review stays in assessment mode", async () => {
  const app = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /function evidenceLocation\(/, "evidence labels need one consistent formatter");
  assert.match(app, /pageHint/, "DOCX page hints must be shown alongside paragraph or table locations");
  assert.match(app, /issue-location/, "each issue row should expose the first source document and page location");
  assert.match(app, /crossDocumentEvidence/, "the evidence view must distinguish true cross-document comparison from single-document review");
  assert.match(app, /evidence-summary-card/, "the evidence view needs a complete issue summary before showing source text");
  assert.match(app, /问题总结[\s\S]*核心判断[\s\S]*判断依据[\s\S]*(可能影响|预期收益)/, "the evidence summary must explain conclusion, rationale and impact");
  assert.match(app, /sourceActionLabel\s*=\s*isCrossDocument\s*\?\s*"原文对照"\s*:\s*"原文定位"/, "the detail action must not promise a comparison for a single document");
  assert.match(app, /独立评估/, "single-document evidence should use an assessment view rather than a synthetic comparison");
  assert.doesNotMatch(app, /documents\.push\(\{\s*fileName:\s*"分析判断"/, "single-file review must not manufacture a second comparison document");
});

test("the original workbench avoids a horizontal rail and keeps issue details reachable in narrow windows", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(styles, /body\s*\{[^}]*min-width:\s*1180px/s, "the page must not force a viewport-wide horizontal scrollbar");
  assert.match(app, /detailDrawerOpen/, "narrow layouts need explicit inspector drawer state");
  assert.match(app, /close-detail-drawer/, "the inspector drawer needs a visible close path");
  assert.match(styles, /@media\s*\(max-width:\s*1180px\)[\s\S]*\.detail-panel\.mobile-open/, "the inspector should become an accessible drawer below the desktop breakpoint");
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*\.left-panel\s*\{\s*display:\s*none;/, "the context column should collapse on compact in-app browser widths");
});

test("new task creates a persistent project before waiting for file upload", async () => {
  const app = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /async function createNewTask\(/, "new task needs an explicit persisted creation flow");
  assert.match(app, /api\.post\("\/api\/projects"/, "clicking new task must create a backend project immediately");
  assert.match(app, /action === "new-project"\) await createNewTask\(\)/, "all new-task buttons must use the persisted creation flow");
  assert.match(app, /const launchLabel = canStart[\s\S]*"等待文件解析完成"[\s\S]*"请先导入文件"/, "the disabled launch button must explain why analysis cannot start");
});
