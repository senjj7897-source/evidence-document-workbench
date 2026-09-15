import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MODULES } from "../src/issues.mjs";
import { MODULE_CHECKLISTS } from "../src/coverage.mjs";

test("sentence-level review is a selectable, auditable analysis module", async () => {
  const module = MODULES.find(candidate => candidate.id === "sentence");
  assert.deepEqual(module, {
    id: "sentence",
    name: "逐句语言与歧义精审",
    shortName: "逐句精审",
    description: "逐句检查语言错误、语义边界、职责口径与阅读障碍，并给出可核验改法",
    semanticOnly: true,
  });

  assert.deepEqual(MODULE_CHECKLISTS.sentence, [
    "错字漏字、标点与语法搭配",
    "指代、修饰关系与语义边界",
    "职责主体与术语口径",
    "编号、交叉引用与制发残留",
    "句子负担与阅读障碍",
    "专业术语与权威口径",
  ]);

  const schema = JSON.parse(await readFile(new URL("../schemas/issues.schema.json", import.meta.url), "utf8"));
  assert.ok(schema.properties.issues.items.properties.module.enum.includes("sentence"));
  assert.ok(schema.properties.coverage.items.properties.module.enum.includes("sentence"));
});

test("sentence review protocol preserves the proven evidence-first reasoning process", async () => {
  const { sentenceReviewPromptBlock } = await import("../src/sentence-review.mjs");
  const prompt = sentenceReviewPromptBlock();

  for (const phrase of [
    "先建立终版证据基线",
    "编号连续性、批注、修订痕迹、占位符和逐页版式",
    "逐句",
    "重复文字、错漏字、标点、搭配、语序",
    "职责主体、术语口径、指代、修饰关系、语义边界和句子负担",
    "明确错误—需确认的歧义—表达优化",
    "原句",
    "建议改法",
    "权威依据",
  ]) assert.match(prompt, new RegExp(phrase));

  assert.match(prompt, /不得把纯风格偏好当成错误/);
  assert.match(prompt, /找不到权威依据时[^。]*不得断定/);
});

test("sentence findings are layered consistently and incomplete revisions are rejected", async () => {
  const { prepareSentenceReviewFinding } = await import("../src/sentence-review.mjs");
  const evidence = [{ quote: "本办法适用于子公司，子公司需制定相关制度。" }];
  const prepared = prepareSentenceReviewFinding({
    module: "sentence",
    findingType: "issue",
    inferenceLevel: "confirmable_omission",
    originalText: null,
    suggestedText: "明确本办法对各子公司的适用方式及配套制度关系。",
    rewriteReason: "现有表述存在直接适用与另行制定后适用两种理解。",
  }, evidence);
  assert.equal(prepared.category, "需确认的歧义");
  assert.equal(prepared.originalText, evidence[0].quote);

  assert.equal(prepareSentenceReviewFinding({
    module: "sentence",
    findingType: "issue",
    inferenceLevel: "fact",
    suggestedText: null,
    rewriteReason: "存在错误",
  }, evidence), null, "a finding without a concrete revision must not enter the formal queue");
});

test("a sentence-only run returns a located original sentence and a minimal revision", async () => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "document-audit-sentence-review-"));
  process.env.WORKBENCH_DATA_DIR = isolatedRoot;
  process.env.WORKBENCH_USE_CODEX = "1";
  try {
    const storage = await import(`../src/storage.mjs?sentence=${Date.now()}`);
    const providers = await import("../src/providers/index.mjs");
    const analysis = await import(`../src/analysis.mjs?sentence=${Date.now()}`);
    providers.registerSemanticProvider({
      id: "sentence-review-test",
      label: "逐句精审测试模型",
      priority: 2000,
      capabilities: { analysis: true, rewrite: false },
      isAvailable: async () => true,
      analyze: async ({ modules }) => {
        assert.deepEqual(modules, ["sentence"]);
        return {
          issues: [{
            module: "sentence",
            findingType: "issue",
            category: "明确错误",
            severity: "medium",
            title: "同一句重复使用“承担”",
            summary: "重复搭配使责任表述拗口。",
            basis: "同一句连续两次使用“承担”，可由原文直接确认。",
            impact: "增加阅读负担，并削弱责任表达的清晰度。",
            confidence: 0.96,
            inferenceLevel: "fact",
            originalText: "业务经营部门应当为承担市场风险所带来的损失承担责任。",
            suggestedText: "业务经营部门应当对因承担市场风险所造成的损失承担责任。",
            rewriteReason: "消除重复搭配，不改变责任主体和原意。",
            evidence: [{ fileId: "main", fileName: "市场风险管理办法.docx", location: { label: "第12条", pageHint: 8 }, quote: "业务经营部门应当为承担市场风险所带来的损失承担责任。" }],
          }],
          diagnostics: { mocked: true },
        };
      },
    });

    const project = await storage.createProject("逐句精审回归");
    project.files = [{ id: "main", name: "市场风险管理办法.docx", extension: ".docx", role: "main", parse: { status: "ok" } }];
    await storage.saveProject(project);
    const extractedDir = join(storage.projectDir(project.id), "extracted");
    await mkdir(extractedDir, { recursive: true });
    await storage.writeJsonAtomic(join(extractedDir, "main.forensic.json"), {
      kind: "docx",
      blocks: [{ id: "p-12", type: "paragraph", text: "业务经营部门应当为承担市场风险所带来的损失承担责任。", location: { kind: "paragraph", paragraph: 12, pageHint: 8, label: "第12条" } }],
      comments: [],
      revisions: { insertions: [], deletions: [] },
    });
    await writeFile(join(extractedDir, "main.md"), "业务经营部门应当为承担市场风险所带来的损失承担责任。", "utf8");

    const run = await analysis.createAnalysisRun(project.id, { modules: ["sentence"], provider: "sentence-review-test" });
    await analysis.executeAnalysisRun(run);
    const completed = await analysis.loadRun(project.id, run.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerUsed, "sentence-review-test");
    assert.equal(completed.issues.length, 1);
    assert.equal(completed.issues[0].module, "sentence");
    assert.equal(completed.issues[0].originalText, "业务经营部门应当为承担市场风险所带来的损失承担责任。");
    assert.equal(completed.issues[0].suggestedText, "业务经营部门应当对因承担市场风险所造成的损失承担责任。");
    assert.equal(completed.issues[0].evidence[0].location.pageHint, 8);
    const { issuesToHtml } = await import(`../src/export.mjs?sentence=${Date.now()}`);
    const offlineHtml = issuesToHtml(project, completed);
    assert.match(offlineHtml, /逐句精审/);
    assert.match(offlineHtml, /原句/);
    assert.match(offlineHtml, /建议改法/);
    assert.match(offlineHtml, /修改理由/);
    assert.match(offlineHtml, /业务经营部门应当对因承担市场风险所造成的损失承担责任/);

    const deterministicRun = await analysis.createAnalysisRun(project.id, { modules: ["sentence"], provider: "deterministic" });
    await analysis.executeAnalysisRun(deterministicRun);
    const deterministicCompleted = await analysis.loadRun(project.id, deterministicRun.id);
    assert.ok(deterministicCompleted.warnings.some(message => message.includes("逐句精审") && message.includes("语义模型")));
  } finally {
    delete process.env.WORKBENCH_DATA_DIR;
    delete process.env.WORKBENCH_USE_CODEX;
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});

test("the workbench exposes sentence review and renders its original-to-revision reasoning", async () => {
  const [app, styles, roles] = await Promise.all([
    readFile(new URL("../app/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
    import("../app/file-roles.js"),
  ]);

  assert.match(app, /sentence:\s*"ph-text-align-left"/);
  assert.match(app, /sentence:\s*"逐句精审"/);
  assert.match(app, /AI逐句推理/);
  assert.match(app, /issue\.module\s*===\s*"sentence"/);
  for (const label of ["原句", "建议改法", "修改理由"]) assert.match(app, new RegExp(label));
  assert.match(styles, /\.sentence-review-box/);
  assert.match(styles, /\.sentence-review-text[^}]*font-size:\s*13px/s);

  const recommended = roles.recommendAnalysisModules([{ name: "管理办法.docx" }]);
  assert.ok(recommended.includes("sentence"), "document review should recommend the sentence-level pass");
});
