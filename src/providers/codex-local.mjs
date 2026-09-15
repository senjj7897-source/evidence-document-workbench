import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectDir } from "../storage.mjs";
import { resolveRuntime } from "../runtime.mjs";
import { normalizeIssue } from "../issues.mjs";
import { loadStyleProfile } from "../style.mjs";
import { buildCoveragePlan, finalizeCoverage } from "../coverage.mjs";
import { createReviewPackets } from "../review-protocol.mjs";
import { createReviewCsvBundle } from "../review-csv.mjs";
import { prepareSentenceReviewFinding, sentenceReviewPromptBlock } from "../sentence-review.mjs";

function excerptFor(item, limit = 18000) {
  const lines = [];
  const forensic = item.forensic || {};
  if (Array.isArray(forensic.blocks)) {
    for (const block of forensic.blocks) {
      if (!block.text) continue;
      lines.push(`[${block.location?.label || block.id}] ${block.text}`);
      if (lines.join("\n").length >= limit) break;
    }
  } else if (Array.isArray(forensic.pages)) {
    for (const page of forensic.pages) {
      lines.push(`[第${page.page}页] ${page.text}`);
      if (lines.join("\n").length >= limit) break;
    }
  } else if (Array.isArray(forensic.sheets)) {
    for (const sheet of forensic.sheets) {
      lines.push(`## 工作表 ${sheet.name}`);
      for (const cell of (sheet.cells || []).slice(0, 2500)) {
        lines.push(`[${sheet.name}!${cell.address}] ${cell.formula ? `公式=${cell.formula}; 缓存值=${cell.cachedValue}` : cell.value}`);
        if (lines.join("\n").length >= limit) break;
      }
      if (lines.join("\n").length >= limit) break;
    }
  }
  return lines.join("\n").slice(0, limit);
}

function buildReviewSource(items) {
  const review = createReviewPackets(items, { maxCharacters: 16000 });
  const sourceText = review.packets.map((packet, index) => (
    `\n--- SOURCE PACKET ${index + 1}/${review.packets.length} ---\n${packet.content}`
  )).join("\n");
  return { review, sourceText };
}

function buildFocusedReviewSource(review, reviewMap) {
  const indexedLabels = new Set((reviewMap.reviewMap?.evidenceIndex || []).map(item => item.locationLabel));
  const selectedRows = (review.rows || []).filter(row => (
    !["cell"].includes(row.kind)
    || indexedLabels.has(row.locationLabel)
  ));
  const packets = [];
  let current = "";
  for (const row of selectedRows) {
    const line = `[${row.locationLabel}] ${row.content}`;
    if (current && current.length + line.length + 1 > 16000) {
      packets.push(current);
      current = "";
    }
    current += `${current ? "\n" : `===== FILE ${row.fileId} | ${row.fileName} =====\n`}${line}`;
  }
  if (current) packets.push(current);
  return {
    sourceText: packets.map((content, index) => `\n--- FOCUSED EVIDENCE PACKET ${index + 1}/${packets.length} ---\n${content}`).join("\n"),
    manifest: {
      selectedEntries: selectedRows.length,
      indexedWorksheetEvidence: selectedRows.filter(row => row.kind === "cell").length,
      packetCount: packets.length,
      fullReviewCompletedInStageOne: true,
    },
  };
}

function buildChallengeReviewSource(review, reviewMap, draft) {
  const labels = new Set((reviewMap.reviewMap?.evidenceIndex || []).map(item => String(item.locationLabel || "").replace(/^\[+|\]+$/g, "")));
  for (const item of draft.assessment?.items || []) {
    for (const evidence of item.evidence || []) labels.add(String(evidence.locationLabel || "").replace(/^\[+|\]+$/g, ""));
  }
  const closureTerms = /(应当|应该|需要|当.+时|用于|触发|监测|管理|应急|指标|阈值|责任|审批|复盘|更新|验证|频率|解除|整改|资本|限额)/;
  const selectedRows = (review.rows || []).filter(row => (
    labels.has(String(row.locationLabel || "").replace(/^\[+|\]+$/g, ""))
    || row.kind === "sheet-profile"
    || row.kind === "docx-table-cell"
    || (!["cell"].includes(row.kind) && closureTerms.test(row.content))
  ));
  const packets = [];
  let current = "";
  for (const row of selectedRows) {
    const line = `[${row.locationLabel}] ${row.content}`;
    if (current && current.length + line.length + 1 > 14000) {
      packets.push(current);
      current = "";
    }
    current += `${current ? "\n" : `===== FILE ${row.fileId} | ${row.fileName} =====\n`}${line}`;
  }
  if (current) packets.push(current);
  return {
    sourceText: packets.map((content, index) => `\n--- CHALLENGE EVIDENCE PACKET ${index + 1}/${packets.length} ---\n${content}`).join("\n"),
    manifest: {
      selectedEntries: selectedRows.length,
      packetCount: packets.length,
      sourceStrategy: "draft-evidence-plus-closure-counterevidence",
      fullReviewCompletedInStageOne: true,
    },
  };
}

async function persistReviewCsvBundle(projectId, runId, review) {
  const bundle = createReviewCsvBundle(review);
  const root = join(projectDir(projectId), "runs");
  const artifacts = {
    narrative: `${runId}.review-narrative.csv`,
    tables: `${runId}.review-tables.csv`,
    worksheets: `${runId}.review-worksheets.csv`,
  };
  await Promise.all(Object.entries(artifacts).map(([key, name]) => (
    writeFile(join(root, name), bundle[key], "utf8")
  )));
  return artifacts;
}

const closureProtocol = `对文档中每一项“应当、需要、当……时、用于、触发、监测、管理”等能力承诺，沿完整执行链检查：
目标 → 输入/数据 → 可观测指标 → 监测频率 → 阈值/决策规则 → 责任主体 → 管理动作 → 解除条件 → 效果验证与复盘。
不能只发现“缺一张表”，必须说明断在哪一环、现实中会怎样失败、怎样落到字段/规则/流程，以及还需要什么材料才能进一步确认。`;

function buildPrompt({ items, modules, coveragePlan }) {
  const moduleText = modules.join(", ");
  const checklistText = coveragePlan.expectedChecks.map(item => `- ${item.module}｜${item.dimension}`).join("\n");
  const { review, sourceText } = buildReviewSource(items);
  const sentenceProtocolText = modules.includes("sentence")
    ? `17. 必须执行下方“逐句精审协议”。\n\n逐句精审协议：\n${sentenceReviewPromptBlock()}`
    : "";
  return `你是本地文档审查工作台的语义分析器。仅分析以下模块：${moduleText}。

硬性规则：
1. 不得编造原文、页码、单元格、制度要求或正确答案。
2. 每个问题至少给一条可核对证据；跨文档冲突至少给两份文件的证据。
3. locationLabel 必须逐字使用原文前方方括号里的位置标签，但不要包含方括号本身。
4. fileId 和 fileName 必须逐字使用 FILE 标题中的值。
5. 区分三层：fact 是直接差异；confirmable_omission 是文档自身可确认缺少关键环节；risk_inference 是基于前两者的风险推断。
6. 单纯措辞差异不得上升为冲突。缺少权威来源时只报告“两边不一致”，不得判断谁错。
7. 写作优化只做轻度自然化：删空话、机械排比、宣传腔和冗余，不改变事实、数字、术语与结构。
8. 不输出没有证据的问题。宁缺毋滥。
9. findingType=issue 表示有证据支持的缺点、错误或缺口；findingType=improvement 表示原文未必错误，但存在可说明收益的改进机会。不得把主观偏好包装成问题。
10. open 只承接预设模块无法合理归类的发现，不得复制 conflict、logic、data、proofread、sentence、writing、version 或 deep 已能表达的事项。
11. deep 专门输出专业优化建议，不判定原文错误。必须结合文档已经表达的目标、方法、流程或管理用途提出方案，不得凭空补写业务事实。
12. deep 的 summary 必须包含三个要素：现状判断、具体优化方案、建议实施路径；不得只写“建议完善”“建议加强”等空泛措辞。basis 说明建议从哪些原文内容推导，impact 说明预期提升的专业价值。
13. deep 应优先从方法体系、情景或参数设计、数据与模型验证、治理与职责、结果解释、管理应用、可复核性等维度寻找高价值改进点。只输出最值得实施的 3—8 条，避免同义重复。
14. 必须逐项完成下方“固定检查清单”，并在 coverage 中为每一项原样返回 module 和 dimension。发现问题填 finding；检查后无充分证据填 no_finding；材料不足无法检查填 blocked。每个 finding/no_finding 都必须列出实际复核过的 evidenceLabels，并将 counterEvidenceChecked 设为 true 表示已查找后文、表格或附件中的反证；否则该维度不会计入完成度。不得省略检查项，也不得用问题数量冒充覆盖率。
15. ${closureProtocol}
16. 对附件、表格和公式与正文进行交叉核验；附件位置标签以“附件:”开头。不得因正文已经描述某项能力，就假定附件或执行机制已经存在。
${sentenceProtocolText}

模块含义：
- conflict：单文档前后矛盾、跨文档显性或隐性冲突。
- logic：定义、范围、流程、条件、数据口径、责任与生命周期无法闭环的可确认缺口。
- data：文档与表格数值、字段、公式和规则承接的差异；注意单位、币种、精度、正负号与统计范围。
- proofread：错漏字、术语不统一、编号异常和明显格式异常。
- sentence：逐句语言与歧义精审。它不是快速错字扫描，也不是按个人风格润色；必须按原文顺序复核终版，区分明确错误、需确认的歧义和表达优化，并给出原句与最小改动建议。
- writing：轻度自然化建议；summary 中说明原表述问题，basis 说明修改原则，impact 可写“建议表达”。
- version：修订、批注与新旧版本的重要变化。
- open：开放发现。模型可识别预设模块之外的可证实缺点或改进机会，例如信息组织、可维护性、可追踪性、可执行性或读者理解成本；category 由模型简洁命名。
- deep：深度分析与专业优化建议。基于文档自身目标和专业场景，提出结构化、可执行、可解释的优化方案；全部使用 findingType=improvement，severity 默认 low，价值明确且实施优先级较高时可用 medium，不得使用 high。category 应使用专业维度名称。

固定检查清单：
${checklistText}

每条结果必须填写 findingType。除 open、deep 和 sentence 模块中的表达优化外，默认填写 issue。open 和 deep 的 improvement 默认使用 low；只有专业价值和实施优先级明确时才可使用 medium，不得使用 high。writing 和 sentence 模块还必须填写 originalText、suggestedText 和 rewriteReason；其他模块可将这三个字段设为 null。请严格按给定 JSON Schema 输出。
审查材料清单：${JSON.stringify(review.manifest)}
${sourceText}`;
}

function buildReviewMapPrompt({ review, sourceText }) {
  return `你是文档深度审查的第一阶段分析器。本阶段只重建整组材料的业务逻辑和执行链，不急于列问题。

任务：
1. 概括文档目标，并重建其中的核心方法链：目标、输入、处理过程、输出、管理用途。
2. 找出所有带有“应当、需要、当……时、用于、触发、监测、管理”等含义的能力承诺。
3. 对每项能力承诺列出需要在全文、表格和附件中继续核查的闭环问题。
4. 标出尚需查找的依赖关系，例如正文引用附件、参数、指标、公式、职责、审批或后续章节。
5. evidenceIndex 保留后续评估必需的关键证据，尤其是工作表、附件和公式。每条必须逐字引用 quote，并保留准确 fileId、fileName、locationLabel；不要收录无关单元格。

${closureProtocol}

规则：
- 必须覆盖全部 SOURCE PACKET，不得只根据前几段下结论。
- locationLabel 必须逐字使用方括号中的位置标签。
- 附件和工作表标签以“附件:”开头，属于正式核查范围。
- 本阶段不得把通用最佳实践写成文档已经缺失的事实。
- 请严格按 JSON Schema 输出。

审查材料清单：${JSON.stringify(review.manifest)}
${sourceText}`;
}

function buildAssessmentPrompt({ review, sourceText, reviewMap }) {
  return `你是文档深度审查的第二阶段专家。请依据第一阶段重建的业务结构，对整组材料生成独立的整体改进评估，而不是逐句问题清单。

第一阶段业务结构：
${JSON.stringify(reviewMap.reviewMap || {}, null, 2)}

${closureProtocol}

评估目标：
1. 先判断文档已经具备的基础与整体成熟度，避免只挑问题。
2. incomplete=文档自身已经承诺或逻辑上必须闭环但材料中未承接；optimize=已有内容可提升清晰度、效率、可执行性或可复核性；deepen=可提升专业方法、分析深度或管理价值。
3. 每个事项必须把“原文事实、可确认缺口、专业判断、失败方式、完整实现、待补材料、结论边界”分开写。
4. 最后形成按依赖顺序可执行的改进路线图。

硬性规则：
1. 不得编造原文、页码、制度要求、模型结果或业务事实。
2. 每个事项至少提供一条可逐字核验的证据。locationLabel、fileId、fileName 必须逐字使用材料中的值。
3. 不能因为文档提到“指标、监测、触发、管理、应急”等词，就认定机制已落地；必须继续查找指标定义、数据源、频率、阈值、责任主体、动作、解除和复盘。
4. confirmedGap 只写材料自身可确认的缺失；professionalJudgment 才能写专业推断；conclusionBoundary 明确本次不能进一步断定什么。
5. failureMode 必须写清现实执行时会在哪一步卡住或失真；不得只写“影响执行”。
6. recommendation 必须写清改什么、落到什么载体或机制；implementationSteps 必须是可执行步骤。
7. closure 中逐项写现状；材料未说明就明确写“材料未说明”，不得代替文档编答案。missingLinks 只列真正断裂的环节。
8. requiredEvidence 列出进一步确认所需的制度、表单、字段、阈值依据、模型结果或责任记录；不需要时可为空。
9. strengths 写 3—6 条；items 优先输出 6—12 条高价值事项，同义建议合并，不得凑数。
10. priority 是实施优先级。只有前置依赖或关键执行链断裂才用 high。
11. roadmap 按“近期/中期/持续”或合理阶段组织，并与事项一致。
12. 第一阶段已经遍历完整材料；本阶段的 FOCUSED EVIDENCE PACKET 保留全部正文、Word 表格、工作表概况和第一阶段索引出的关键附件证据。不得将未重复附带的无关工作表单元格误称为“未审查”。
13. 请严格按 JSON Schema 输出。

审查材料清单：${JSON.stringify(review.manifest)}
${sourceText}`;
}

function buildAssessmentCriticPrompt({ review, sourceText, reviewMap, draft }) {
  return `你是文档深度审查的第三阶段独立复核人。下面是一份候选评估。请重新查阅全部材料，寻找反证、漏检和越界判断，最终输出一份完整的修订后评估，而不是批注列表。

第一阶段业务结构：
${JSON.stringify(reviewMap.reviewMap || {}, null, 2)}

候选评估：
${JSON.stringify(draft.assessment || {}, null, 2)}

复核任务：
1. 反证：候选项声称缺失的内容，是否其实在后文、表格或附件中已经给出？如已给出，删除或改写该项。
2. 漏检：逐项复核能力承诺的执行链，特别检查可观测指标、监测频率、阈值/决策规则、责任、动作、解除、验证与复盘。
3. 证据：每条最终事项必须保留可逐字核验的证据和准确位置；证据不足的判断必须撤回。
4. 边界：区分原文事实、可确认缺口、专业建议和待外部材料确认事项。
5. 落地：任何“完善、加强、细化”都必须改写为具体载体、字段、规则、责任和实施步骤。
6. 全局性：检查整份文档的目标、方法、数据参数、治理、结果解释、管理应用、复核更新，不得被单一章节或错别字带偏。
7. ${closureProtocol}

请严格按 assessment JSON Schema 输出完整最终稿。
审查材料清单：${JSON.stringify(review.manifest)}
${sourceText}`;
}

function runCodexProcess(executable, args, prompt, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const succeed = value => { if (!settled) { settled = true; resolve(value); } };
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error("Codex analysis timed out"));
    }, options.timeoutMs || 300000);
    child.stdout.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-2 * 1024 * 1024); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2 * 1024 * 1024); });
    child.on("error", error => {
      clearTimeout(timer);
      fail(error);
    });
    child.stdin.on("error", error => {
      if (!["EOF", "EPIPE"].includes(error.code)) fail(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) succeed({ stdout, stderr });
      else fail(new Error(`Codex exited with code ${code}: ${stderr.slice(-1200)}`));
    });
    child.stdin.end(prompt, "utf8");
  });
}

export async function executeCodexJson({ projectId, outputStem, prompt, schemaName, model, timeoutMs = 420000 }) {
  const { codex } = await resolveRuntime();
  const root = projectDir(projectId);
  const outputPath = join(root, "runs", `${outputStem}.json`);
  const schemaPath = join(process.cwd(), "schemas", schemaName);
  const args = [
    "--ask-for-approval", "never",
    "exec",
    "-",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox", "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "-c", "features.plugins=false",
    "-c", "features.apps=false",
    "--output-schema", schemaPath,
    "--output-last-message", outputPath,
    "--color", "never",
    "-C", root,
  ];
  if (model) args.push("--model", model);
  const env = { ...process.env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Document Audit Workbench", RUST_LOG: "off" };
  delete env.CODEX_SESSION_ID;
  delete env.CODEX_THREAD_ID;
  await rm(outputPath, { force: true });
  const execution = await runCodexProcess(codex, args, prompt, { cwd: root, env, timeoutMs });
  return { payload: JSON.parse(await readFile(outputPath, "utf8")), execution };
}

async function executeCodexJsonCached(options) {
  const outputPath = join(projectDir(options.projectId), "runs", `${options.outputStem}.json`);
  try {
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    return { payload, execution: { stdout: "", stderr: "", reused: true } };
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return executeCodexJson(options);
}

export function resolveAssessmentStages({ draftPayload, finalPayload, criticError = null, manifest = {} }) {
  if (!draftPayload?.assessment) throw new Error("Assessment draft is missing");
  const challengeCompleted = Boolean(finalPayload?.assessment);
  const warning = criticError
    ? `独立反证复核未完成，已保留通过证据校验的闭环评估草稿；本轮不能声称三阶段审查完整：${String(criticError.message || criticError).slice(0, 300)}`
    : null;
  return {
    payload: challengeCompleted ? finalPayload : draftPayload,
    warnings: warning ? [warning] : [],
    reviewProtocol: {
      version: "closure-review-v2",
      complete: Boolean(manifest.complete) && challengeCompleted,
      stages: [
        { id: "reconstruct", name: "全文业务结构重建", status: "completed" },
        { id: "closure", name: "执行闭环审查", status: "completed" },
        { id: "challenge", name: "独立反证复核", status: challengeCompleted ? "completed" : "failed" },
      ],
      source: manifest,
    },
  };
}

export function extractReferencedParagraphLabels(value) {
  const labels = [];
  const seen = new Set();
  for (const match of String(value || "").matchAll(/第((?:\d+[、，,\s]*)+)段/g)) {
    for (const number of match[1].match(/\d+/g) || []) {
      const label = `第${number}段`;
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels;
}

function findLocation(item, evidence) {
  const label = String(evidence.locationLabel || "").trim().replace(/^\[+|\]+$/g, "");
  const forensic = item?.forensic || {};
  const blocks = forensic.blocks || forensic.pages || [];
  const exact = blocks.find(block => block.location?.label === label);
  if (exact?.location) return exact.location;
  for (const block of forensic.blocks || []) {
    if (block.type !== "table" || !Array.isArray(block.rows)) continue;
    const prefix = `${block.location?.label || block.id || "表格"}!`;
    const cell = block.rows.flat().find(candidate => `${prefix}${candidate.address || `R${candidate.row}C${candidate.column}`}` === label);
    if (cell) {
      return {
        ...(block.location || {}),
        kind: "table_cell",
        tableCell: cell.address || `R${cell.row}C${cell.column}`,
        label,
      };
    }
  }
  for (const sheet of forensic.sheets || []) {
    const cell = (sheet.cells || []).find(candidate => `${sheet.name}!${candidate.address}` === label);
    if (cell) return { kind: "cell", sheet: sheet.name, cell: cell.address, label };
  }
  for (const workbook of forensic.embeddedWorkbooks || []) {
    for (const sheet of workbook.sheets || []) {
      const expectedPrefix = `附件:${workbook.name || "嵌入式工作簿"}/${sheet.name}!`;
      const cell = (sheet.cells || []).find(candidate => `${expectedPrefix}${candidate.address}` === label);
      if (cell) {
        return {
          kind: "embedded_cell",
          attachment: workbook.name || "嵌入式工作簿",
          sheet: sheet.name,
          cell: cell.address,
          label,
        };
      }
      if (`${expectedPrefix}工作表概况` === label) {
        return {
          kind: "embedded_sheet",
          attachment: workbook.name || "嵌入式工作簿",
          sheet: sheet.name,
          label,
        };
      }
    }
  }
  return null;
}

function normalizedEvidenceText(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[“”‘’]/g, '"').toLowerCase();
}

function sourceCorpus(item) {
  const forensic = item?.forensic || {};
  const parts = [];
  for (const block of forensic.blocks || forensic.pages || []) {
    parts.push(block.text || "");
    if (block.type === "table") {
      for (const cell of (block.rows || []).flat()) {
        parts.push(`${block.location?.label || block.id || "表格"}!${cell.address || `R${cell.row}C${cell.column}`} ${cell.text || ""}`);
      }
    }
  }
  for (const sheet of forensic.sheets || []) {
    for (const cell of sheet.cells || []) parts.push(`${sheet.name}!${cell.address} ${cell.value ?? ""} ${cell.formula ?? ""}`);
  }
  for (const workbook of forensic.embeddedWorkbooks || []) {
    for (const sheet of workbook.sheets || []) {
      for (const cell of sheet.cells || []) {
        parts.push(`附件:${workbook.name || "嵌入式工作簿"}/${sheet.name}!${cell.address} ${cell.value ?? ""} ${cell.cachedValue ?? ""} ${cell.formula ?? ""}`);
      }
    }
  }
  return normalizedEvidenceText(parts.join("\n"));
}

export async function runCodexAnalysis({ projectId, runId, items, modules, model }) {
  const coveragePlan = buildCoveragePlan({ items, modules });
  const { review } = buildReviewSource(items);
  await persistReviewCsvBundle(projectId, runId, review);
  const prompt = buildPrompt({ items, modules, coveragePlan });
  const { payload, execution } = await executeCodexJson({
    projectId,
    outputStem: `${runId}.codex-result`,
    prompt,
    schemaName: "issues.schema.json",
    model,
  });
  const itemById = new Map(items.map(item => [item.file.id, item]));
  const corpusById = new Map(items.map(item => [item.file.id, sourceCorpus(item)]));
  let rejectedEvidence = 0;
  let rejectedIssues = 0;
  const issues = [];
  for (const issue of payload.issues || []) {
    if (!modules.includes(issue.module)) {
      rejectedIssues += 1;
      continue;
    }
    const verifiedEvidence = [];
    for (const candidate of issue.evidence || []) {
      const sourceItem = itemById.get(candidate.fileId);
      const location = findLocation(sourceItem, candidate);
      const quote = normalizedEvidenceText(candidate.quote);
      if (!sourceItem || !location || quote.length < 2 || !corpusById.get(candidate.fileId)?.includes(quote)) {
        rejectedEvidence += 1;
        continue;
      }
      verifiedEvidence.push({
        fileId: candidate.fileId,
        fileName: sourceItem.file.name,
        location,
        quote: candidate.quote,
        parser: "audit-extractor",
        verification: "exact-source-match",
      });
    }
    const needsTwoFiles = issue.module === "conflict" && /(跨文档|不同文档|两份文档|文件间)/.test(`${issue.title}${issue.summary}${issue.category}`);
    if (!verifiedEvidence.length || (needsTwoFiles && new Set(verifiedEvidence.map(item => item.fileId)).size < 2)) {
      rejectedIssues += 1;
      continue;
    }
    const preparedIssue = prepareSentenceReviewFinding(issue, verifiedEvidence);
    if (!preparedIssue) {
      rejectedIssues += 1;
      continue;
    }
    issues.push(normalizeIssue({ ...preparedIssue, source: "codex-local", evidence: verifiedEvidence }));
  }
  return {
    provider: "codex-local",
    issues,
    coverage: finalizeCoverage(coveragePlan, payload.coverage || []),
    diagnostics: {
      stderr: execution.stderr.trim().slice(-2000),
      promptCharacters: prompt.length,
      rejectedEvidence,
      rejectedIssues,
    },
  };
}

export async function runCodexAssessment({ projectId, runId, items, modules, model, onStage = async () => {} }) {
  const { review, sourceText } = buildReviewSource(items);
  const csvArtifacts = await persistReviewCsvBundle(projectId, runId, review);
  await onStage({ progress: 81, stage: "深度评估 · 全文业务结构重建" });
  const mapPrompt = buildReviewMapPrompt({ review, sourceText });
  const mapResult = await executeCodexJsonCached({
    projectId,
    outputStem: `${runId}.review-map`,
    prompt: mapPrompt,
    schemaName: "review-map.schema.json",
    model,
  });
  const focused = buildFocusedReviewSource(review, mapResult.payload);
  await onStage({ progress: 84, stage: "深度评估 · 执行闭环审查" });
  const focusedReview = { ...review, manifest: { ...review.manifest, focused: focused.manifest } };
  const draftPrompt = buildAssessmentPrompt({ review: focusedReview, sourceText: focused.sourceText, reviewMap: mapResult.payload });
  const draftResult = await executeCodexJsonCached({
    projectId,
    outputStem: `${runId}.assessment-draft`,
    prompt: draftPrompt,
    schemaName: "assessment.schema.json",
    model,
  });
  const challenge = buildChallengeReviewSource(review, mapResult.payload, draftResult.payload);
  await onStage({ progress: 87, stage: "深度评估 · 独立反证复核" });
  const challengeReview = { ...review, manifest: { ...review.manifest, challenge: challenge.manifest } };
  const criticPrompt = buildAssessmentCriticPrompt({
    review: challengeReview,
    sourceText: challenge.sourceText,
    reviewMap: mapResult.payload,
    draft: draftResult.payload,
  });
  let finalResult = null;
  let criticError = null;
  try {
    finalResult = await executeCodexJsonCached({
      projectId,
      outputStem: `${runId}.assessment-result`,
      prompt: criticPrompt,
      schemaName: "assessment.schema.json",
      model,
      timeoutMs: 600000,
    });
  } catch (error) {
    criticError = error;
  }
  const stageOutcome = resolveAssessmentStages({
    draftPayload: draftResult.payload,
    finalPayload: finalResult?.payload || null,
    criticError,
    manifest: review.manifest,
  });
  const payload = stageOutcome.payload;
  const itemById = new Map(items.map(item => [item.file.id, item]));
  const corpusById = new Map(items.map(item => [item.file.id, sourceCorpus(item)]));
  let rejectedEvidence = 0;
  let rejectedItems = 0;
  const verifiedItems = [];
  for (const candidate of payload.assessment?.items || []) {
    const evidence = [];
    for (const source of candidate.evidence || []) {
      const sourceItem = itemById.get(source.fileId);
      const location = findLocation(sourceItem, source);
      const quote = normalizedEvidenceText(source.quote);
      if (!sourceItem || !location || quote.length < 2 || !corpusById.get(source.fileId)?.includes(quote)) {
        rejectedEvidence += 1;
        continue;
      }
      evidence.push({
        fileId: source.fileId,
        fileName: sourceItem.file.name,
        location,
        quote: source.quote,
        parser: "audit-extractor",
        verification: "exact-source-match",
      });
    }
    const referencedLabels = extractReferencedParagraphLabels([
      candidate.currentState,
      candidate.confirmedGap,
      candidate.professionalJudgment,
    ].filter(Boolean).join(" "));
    const referencedFileIds = [...new Set((candidate.evidence || []).map(source => source.fileId))];
    for (const label of referencedLabels) {
      if (evidence.length >= 8 || evidence.some(item => item.location?.label === label)) continue;
      for (const fileId of referencedFileIds) {
        const sourceItem = itemById.get(fileId);
        const block = (sourceItem?.forensic?.blocks || []).find(item => item.location?.label === label && item.text);
        if (!block) continue;
        evidence.push({
          fileId,
          fileName: sourceItem.file.name,
          location: block.location,
          quote: block.text,
          parser: "audit-extractor",
          verification: "source-reference-expansion",
        });
        break;
      }
    }
    if (!evidence.length) {
      rejectedItems += 1;
      continue;
    }
    verifiedItems.push({
      type: ["incomplete", "optimize", "deepen"].includes(candidate.type) ? candidate.type : "optimize",
      priority: ["high", "medium", "low"].includes(candidate.priority) ? candidate.priority : "medium",
      dimension: String(candidate.dimension || "综合改进").slice(0, 120),
      title: String(candidate.title || "未命名建议").slice(0, 180),
      currentState: String(candidate.currentState || "").slice(0, 2400),
      confirmedGap: String(candidate.confirmedGap || "").slice(0, 2400),
      professionalJudgment: String(candidate.professionalJudgment || "").slice(0, 2400),
      failureMode: String(candidate.failureMode || "").slice(0, 2400),
      recommendation: String(candidate.recommendation || "").slice(0, 3200),
      implementationSteps: (candidate.implementationSteps || []).map(step => String(step).slice(0, 900)).slice(0, 8),
      requiredEvidence: (candidate.requiredEvidence || []).map(source => String(source).slice(0, 900)).slice(0, 8),
      conclusionBoundary: String(candidate.conclusionBoundary || "").slice(0, 2000),
      closure: {
        status: ["complete", "partial", "broken", "not_applicable"].includes(candidate.closure?.status)
          ? candidate.closure.status
          : "partial",
        target: String(candidate.closure?.target || "").slice(0, 1200),
        inputs: String(candidate.closure?.inputs || "").slice(0, 1200),
        detection: String(candidate.closure?.detection || "").slice(0, 1200),
        decision: String(candidate.closure?.decision || "").slice(0, 1200),
        action: String(candidate.closure?.action || "").slice(0, 1200),
        exitAndFeedback: String(candidate.closure?.exitAndFeedback || "").slice(0, 1200),
        missingLinks: (candidate.closure?.missingLinks || []).map(link => String(link).slice(0, 500)).slice(0, 8),
      },
      expectedValue: String(candidate.expectedValue || "").slice(0, 2000),
      evidence,
    });
  }
  const assessment = payload.assessment || {};
  return {
    provider: "codex-local",
    assessment: {
      overallRating: ["基础形成", "较为完整", "成熟", "需系统重构"].includes(assessment.overallRating) ? assessment.overallRating : "基础形成",
      executiveSummary: String(assessment.executiveSummary || "").slice(0, 4000),
      strengths: (assessment.strengths || []).map(item => String(item).slice(0, 500)).slice(0, 8),
      items: verifiedItems,
      roadmap: (assessment.roadmap || []).map(item => ({
        phase: String(item.phase || "待规划").slice(0, 80),
        objective: String(item.objective || "").slice(0, 800),
        actions: (item.actions || []).map(action => String(action).slice(0, 600)).slice(0, 8),
      })).slice(0, 4),
    },
    reviewProtocol: {
      ...stageOutcome.reviewProtocol,
      artifacts: csvArtifacts,
    },
    warnings: stageOutcome.warnings,
    diagnostics: {
      stderr: [mapResult.execution.stderr, draftResult.execution.stderr, finalResult?.execution?.stderr || ""]
        .map(value => value.trim()).filter(Boolean).join("\n").slice(-4000),
      promptCharacters: {
        reconstruct: mapPrompt.length,
        closure: draftPrompt.length,
        challenge: criticPrompt.length,
      },
      rejectedEvidence,
      rejectedItems,
      criticError: criticError ? String(criticError.message || criticError).slice(0, 1000) : null,
      reusedStages: {
        reconstruct: Boolean(mapResult.execution.reused),
        closure: Boolean(draftResult.execution.reused),
        challenge: Boolean(finalResult?.execution?.reused),
      },
      modules,
    },
  };
}

export async function runCodexRewrite({ projectId, runId, issue, instruction = "", model }) {
  const style = await loadStyleProfile();
  const originalText = issue.originalText || issue.evidence?.[0]?.quote || "";
  const examples = style.examples.slice(-5).map((item, index) => `示例${index + 1}\n原文：${item.originalText}\n最终稿：${item.finalText}\n要求：${item.instruction || "无"}`).join("\n\n");
  const prompt = `你是中文文档的轻度自然化改写器。请只改写给定原文，不新增事实、数字、术语、措施或结论。

固定原则：
${style.principles.map(item => `- ${item}`).join("\n")}

用户本次追加要求：${instruction || "无"}

原文：
${originalText}

当前候选（如有）：
${issue.suggestedText || "无"}

已采纳的个人风格示例（如有）：
${examples || "暂无"}

输出 suggestedText 和简短 rationale。`;
  const { payload, execution } = await executeCodexJson({
    projectId,
    outputStem: `${runId}.${issue.id}.rewrite.${Date.now()}`,
    prompt,
    schemaName: "rewrite.schema.json",
    model,
    timeoutMs: 300000,
  });
  return {
    suggestedText: String(payload.suggestedText || "").trim(),
    rationale: String(payload.rationale || "").trim(),
    diagnostics: { stderr: execution.stderr.trim().slice(-1000), promptCharacters: prompt.length },
  };
}
