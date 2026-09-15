import { normalizeIssue } from "../issues.mjs";

function evidence(file, block, quote = block?.text || "", verification = "exact-source-match") {
  return {
    fileId: file.id,
    fileName: file.name,
    location: block?.location || { kind: "file", label: "文件级" },
    quote: String(quote || "").slice(0, 700),
    parser: "audit-extractor",
    verification,
  };
}

function textBlocks(item) {
  const forensic = item.forensic || {};
  if (Array.isArray(forensic.blocks)) return forensic.blocks.filter(block => block.text);
  if (Array.isArray(forensic.pages)) return forensic.pages.map(page => ({ text: page.text, location: page.location }));
  return [];
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[0-9０-９,.，。；;：:%％()（）\s]/g, "")
    .replace(/(应当|应该|需要|必须|可以|进行|相关|本行|系统|功能|要求)/g, "")
    .slice(0, 48);
}

function numberMetadata(value) {
  const text = String(value || "").replace(/,/g, "").replace(/，/g, "").trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  let scale = 1;
  if (text.includes("亿")) scale = 100000000;
  else if (text.includes("万")) scale = 10000;
  if (/[％%]/.test(text)) scale /= 100;
  number *= scale;
  const decimals = (match[0].split(".")[1] || "").length;
  return { numeric: number, tolerance: Math.abs(scale * (10 ** -decimals)) / 2 };
}

function parseNumber(value) {
  return numberMetadata(value)?.numeric ?? null;
}

function numberClaims(item) {
  const claims = [];
  const regex = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_（）()·\-]{1,24}?)(?:为|是|：|:|达|等于)\s*(-?[0-9][0-9,.]*(?:\.\d+)?(?:万|亿|%|％)?)/g;
  for (const block of textBlocks(item)) {
    for (const match of block.text.matchAll(regex)) {
      const metadata = numberMetadata(match[2]);
      if (!metadata) continue;
      claims.push({ label: match[1], key: normalizeKey(match[1]), raw: match[2], quote: match[0], ...metadata, block });
    }
  }
  return claims;
}

function conflictIssues(items) {
  const issues = [];
  const index = new Map();
  for (const item of items) {
    for (const claim of numberClaims(item)) {
      if (claim.key.length < 3) continue;
      const entries = index.get(claim.key) || [];
      entries.push({ ...claim, item });
      index.set(claim.key, entries);
    }
  }
  for (const claims of index.values()) {
    const unique = claims.filter((claim, claimIndex) => claims.findIndex(candidate => (
      candidate.item.file.id === claim.item.file.id
      && candidate.block?.location?.label === claim.block?.location?.label
      && candidate.numeric === claim.numeric
    )) === claimIndex);
    let conflictPair = null;
    for (let left = 0; left < unique.length && !conflictPair; left += 1) {
      for (let right = left + 1; right < unique.length; right += 1) {
        const tolerance = Math.max(unique[left].tolerance || 0, unique[right].tolerance || 0);
        if (Math.abs(unique[left].numeric - unique[right].numeric) > tolerance) {
          conflictPair = [unique[left], unique[right]];
          break;
        }
      }
    }
    if (!conflictPair) continue;
    const selected = [...conflictPair];
    for (const claim of unique) {
      if (selected.includes(claim)) continue;
      if (selected.every(existing => Math.abs(existing.numeric - claim.numeric) <= Math.max(existing.tolerance || 0, claim.tolerance || 0))) continue;
      selected.push(claim);
      if (selected.length >= 4) break;
    }
    const crossDocument = new Set(selected.map(claim => claim.item.file.id)).size >= 2;
    issues.push(normalizeIssue({
      module: "conflict",
      category: crossDocument ? "跨文档数值冲突" : "单文档数值冲突",
      severity: "high",
      title: `${selected[0].label}${crossDocument ? "在不同文档中" : "在同一文档前后"}的取值不一致`,
      summary: `同一表述存在超出展示精度可解释范围的不同数值。系统只确认差异，不在缺少权威来源时判断哪一方错误。`,
      basis: "归一化后的字段或指标名称相同，并已按万、亿、百分比及文档展示精度计算容差。",
      impact: "可能导致执行、汇总或对外披露口径不一致。",
      confidence: 0.78,
      inferenceLevel: "fact",
      source: "deterministic",
      evidence: selected.map(claim => evidence(claim.item.file, claim.block, claim.quote)),
    }));
  }
  return issues;
}

function logicIssues(items) {
  const issues = [];
  const passiveApproval = /(经审批|审批通过后|完成审批后|经批准后|批准后)/;
  const explicitActor = /(由|经)[^，。；]{2,24}(审批|批准|审议|核准)/;
  for (const item of items) {
    for (const block of textBlocks(item)) {
      if (!passiveApproval.test(block.text) || explicitActor.test(block.text)) continue;
      issues.push(normalizeIssue({
        module: "logic",
        category: "责任闭环缺口",
        severity: "medium",
        title: "审批流程未明确审批主体",
        summary: "文档明确存在审批或批准动作，但当前表述没有给出可识别的审批主体。",
        basis: "已出现审批触发条件，附近表述未识别到“由/经某主体审批、批准或审议”。",
        impact: "执行时可能需要另行确认责任人；系统不替文档补写主体。",
        confidence: 0.72,
        inferenceLevel: "confirmable_omission",
        source: "deterministic",
        evidence: [evidence(item.file, block)],
      }));
      if (issues.length >= 24) return issues;
    }
  }
  return issues;
}

function spreadsheetPairs(item) {
  const pairs = [];
  for (const sheet of item.forensic?.sheets || []) {
    const byRow = new Map();
    for (const cell of sheet.cells || []) {
      const row = byRow.get(cell.row) || [];
      row.push(cell);
      byRow.set(cell.row, row);
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.column - b.column);
      for (let index = 0; index < row.length - 1; index += 1) {
        const labelCell = row[index];
        const valueCell = row[index + 1];
        if (typeof labelCell.value !== "string") continue;
        const metadata = numberMetadata(valueCell.value);
        if (!metadata) continue;
        const key = normalizeKey(labelCell.value);
        if (key.length < 2) continue;
        pairs.push({ sheet, labelCell, valueCell, key, ...metadata });
      }
    }
  }
  return pairs;
}

function fieldMatchScore(claimKey, pairKey) {
  if (!claimKey || !pairKey) return 0;
  if (claimKey === pairKey) return 1;
  if (claimKey.includes(pairKey) || pairKey.includes(claimKey)) {
    return 0.65 + 0.3 * (Math.min(claimKey.length, pairKey.length) / Math.max(claimKey.length, pairKey.length));
  }
  const sharedSuffix = [...claimKey].reverse().findIndex((character, index) => character !== [...pairKey].reverse()[index]);
  const suffixLength = sharedSuffix === -1 ? Math.min(claimKey.length, pairKey.length) : sharedSuffix;
  return suffixLength >= 2 ? 0.45 + 0.1 * Math.min(2, suffixLength - 1) : 0;
}

function pairCandidate(workbook, pair, score) {
  const id = `${workbook.file.id}:${pair.sheet.name}:${pair.labelCell.address}:${pair.valueCell.address}`;
  return {
    id,
    fileId: workbook.file.id,
    fileName: workbook.file.name,
    sheet: pair.sheet.name,
    labelAddress: pair.labelCell.address,
    valueAddress: pair.valueCell.address,
    label: String(pair.labelCell.value),
    value: pair.valueCell.value,
    numeric: pair.numeric,
    tolerance: pair.tolerance,
    score: Math.round(score * 100) / 100,
    evidence: evidence(workbook.file, {
      location: { kind: "cell", sheet: pair.sheet.name, cell: pair.valueCell.address, label: `${pair.sheet.name}!${pair.valueCell.address}（字段：${pair.labelCell.value}）` },
    }, String(pair.valueCell.value)),
  };
}

function dataDifferenceIssue(claim, candidate) {
  const tolerance = Math.max(claim.tolerance || 0, candidate.tolerance || 0);
  if (Math.abs(claim.numeric - candidate.numeric) <= tolerance) return null;
  return normalizeIssue({
    module: "data",
    category: "文档与表格数据差异",
    severity: "high",
    title: `${claim.label}与Excel字段取值不一致`,
    summary: `文档为${claim.raw}，Excel“${candidate.label}”为${candidate.value}。差异已超出展示精度可解释的容差。`,
    basis: "字段对应关系已确认，并完成单位和展示精度归一化；未自动判断哪一方正确。",
    impact: "可能影响汇总、报送或执行口径。",
    confidence: 0.9,
    inferenceLevel: "fact",
    source: "deterministic",
    evidence: [evidence(claim.item.file, claim.block, claim.quote), candidate.evidence],
  });
}

function dataIssues(items, fieldMappings = {}) {
  const issues = [];
  const workbooks = items.filter(item => item.forensic?.kind === "xlsx");
  const documents = items.filter(item => item.forensic?.kind !== "xlsx");
  const docClaims = documents.flatMap(item => numberClaims(item).map(claim => ({ ...claim, item })));
  const allPairs = workbooks.flatMap(workbook => spreadsheetPairs(workbook).map(pair => ({ workbook, pair })));

  for (const claim of docClaims) {
    const candidates = allPairs
      .map(({ workbook, pair }) => ({ workbook, pair, score: fieldMatchScore(claim.key, pair.key) }))
      .filter(candidate => candidate.score >= 0.55)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map(candidate => pairCandidate(candidate.workbook, candidate.pair, candidate.score));
    if (!candidates.length) continue;

    const saved = fieldMappings[claim.key];
    const selected = saved ? candidates.find(candidate => candidate.id === saved.candidateId) : null;
    if (selected) {
      const difference = dataDifferenceIssue(claim, selected);
      if (difference) issues.push(difference);
      continue;
    }

    const ambiguous = candidates.length >= 2 && candidates[0].score - candidates[1].score <= 0.2;
    if (ambiguous) {
      issues.push(normalizeIssue({
        module: "data",
        category: "字段匹配待确认",
        severity: /(金额|比例|数量|日期|编号)/.test(claim.label) ? "medium" : "low",
        title: `请确认“${claim.label}”对应哪个Excel字段`,
        summary: `文档中的“${claim.label}”与${candidates.length}个Excel字段都较相似。系统暂不判断数据差异，确认对应关系后再立即重算。`,
        basis: "匹配候选的得分接近，不足以自动选择唯一字段。",
        impact: "若对应关系选错，可能制造假差异或漏掉真差异。",
        confidence: 0.55,
        inferenceLevel: "fact",
        source: "deterministic",
        evidence: [evidence(claim.item.file, claim.block, claim.quote), ...candidates.map(candidate => candidate.evidence)],
        mapping: {
          key: claim.key,
          label: claim.label,
          status: "unconfirmed",
          selectedCandidateId: null,
          document: { raw: claim.raw, numeric: claim.numeric, tolerance: claim.tolerance, evidence: evidence(claim.item.file, claim.block, claim.quote) },
          candidates,
        },
      }));
      continue;
    }
    const difference = dataDifferenceIssue(claim, candidates[0]);
    if (difference) issues.push(difference);
  }

  for (const workbook of workbooks) {
    for (const sheet of workbook.forensic?.sheets || []) {
      const hiddenCount = (sheet.hiddenRows?.length || 0) + (sheet.hiddenColumns?.length || 0) + (sheet.state === "visible" ? 0 : 1);
      if (hiddenCount) {
        issues.push(normalizeIssue({
          module: "data",
          category: "隐藏数据提示",
          severity: "low",
          title: `${sheet.name}包含隐藏工作表、行或列`,
          summary: `检测到${hiddenCount}项隐藏区域。隐藏不等于错误，但核验范围应包含这些内容。`,
          basis: "Excel结构属性显示存在隐藏区域。",
          impact: "如果只查看可见区域，可能遗漏公式来源或明细记录。",
          confidence: 1,
          inferenceLevel: "fact",
          source: "deterministic",
          evidence: [evidence(workbook.file, { location: { kind: "sheet", sheet: sheet.name, label: `工作表：${sheet.name}` } }, `工作表状态：${sheet.state || "visible"}；隐藏行：${sheet.hiddenRows?.length || 0}；隐藏列：${sheet.hiddenColumns?.length || 0}`, "structure-derived")],
        }));
      }
    }
  }
  return issues;
}

function proofreadIssues(items) {
  const issues = [];
  const duplicatePattern = /([\u4e00-\u9fa5]{2,4})\1/g;
  const punctuationPattern = /([，。；：！？、])\1+/g;
  for (const item of items) {
    for (const block of textBlocks(item)) {
      if (block.type === "table") continue;
      const punctuation = block.text.match(punctuationPattern);
      const duplicate = block.text.match(duplicatePattern)?.[0];
      const hit = punctuation?.[0] || duplicate;
      if (!hit) continue;
      issues.push(normalizeIssue({
        module: "proofread",
        category: "疑似重复文字或标点",
        severity: "low",
        title: `发现疑似重复内容“${hit}”`,
        summary: "该处存在连续重复字符或标点，建议结合原文确认是否为输入错误。",
        basis: "字符级规则命中；未自动改写原文。",
        impact: "可能影响正式文档的可读性。",
        confidence: punctuation ? 0.96 : 0.68,
        inferenceLevel: "fact",
        source: "deterministic",
        evidence: [evidence(item.file, block)],
      }));
      if (issues.length >= 30) return issues;
    }
  }
  return issues;
}

function formatSignature(block) {
  const entries = Object.entries(block.format?.runFormats || {});
  if (entries.length !== 1) return null;
  const raw = entries[0][0];
  if (raw === "default") return "default|default||";
  const parts = raw.split("|");
  return [parts[0] || "default", parts[1] || "default", parts[2] || "", parts[3] || ""].join("|");
}

function paragraphGroup(block) {
  const numbering = block.format?.numbering || null;
  return `${block.format?.style || "Normal"}|${JSON.stringify(numbering)}`;
}

function paragraphTextClass(block) {
  const text = String(block.text || "").trim();
  if (/^(?:[（(]\s*\d+\s*[）)]|步骤\s*\d+[）):：]?)/i.test(text)) return "manual-number";
  if (text.length <= 32 && !/[。；！？：:]“?$/.test(text)) return "short-heading";
  return "body";
}

function formatAnomalyIssues(items) {
  const issues = [];
  for (const item of items) {
    const paragraphs = textBlocks(item).filter(block => block.type === "paragraph" && block.format && block.text.length >= 8);
    for (let index = 1; index < paragraphs.length - 1; index += 1) {
      const previous = paragraphs[index - 1];
      const current = paragraphs[index];
      const next = paragraphs[index + 1];
      if (paragraphGroup(previous) !== paragraphGroup(current) || paragraphGroup(current) !== paragraphGroup(next)) continue;
      if (paragraphTextClass(previous) !== paragraphTextClass(current) || paragraphTextClass(current) !== paragraphTextClass(next)) continue;
      const previousFormat = formatSignature(previous);
      const currentFormat = formatSignature(current);
      const nextFormat = formatSignature(next);
      if (!previousFormat || !currentFormat || previousFormat !== nextFormat || currentFormat === previousFormat) continue;
      issues.push(normalizeIssue({
        module: "proofread",
        category: "明显格式异常提示",
        severity: "low",
        title: `该段格式与前后同类段落不一致`,
        summary: "该段与前后两个同样式、同编号层级段落的主要字体格式不同。这里只提示孤立异常，不判定应采用哪种格式。",
        basis: `文档内部一致性比对：前后为${previousFormat}，当前段为${currentFormat}。`,
        impact: "可能是粘贴、手工改格式或遗留样式所致，建议查看原文确认。",
        confidence: 0.82,
        inferenceLevel: "fact",
        source: "deterministic",
        evidence: [evidence(item.file, current)],
      }));
      if (issues.length >= 12) return issues;
    }
  }
  return issues;
}

function versionKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.(docx?|docm|xlsx?|xlsm|pdf)$/i, "")
    .replace(/(?:^|[_\-（）()\s])(v(?:ersion)?\s*\d+(?:\.\d+)*|final|update|updated|修订稿|终稿|定稿|批注|回复)(?=$|[_\-（）()\s])/gi, "")
    .replace(/[\s_\-（）()]/g, "");
}

function versionPairs(items) {
  const pairs = [];
  const bases = items.filter(item => item.file.role === "version-base");
  const currents = items.filter(item => item.file.role === "version-current");
  for (const base of bases) {
    const current = currents.find(item => item.forensic?.kind === base.forensic?.kind);
    if (current) pairs.push({ base, current });
  }
  if (pairs.length) return pairs;
  const groups = new Map();
  for (const item of items) {
    const key = `${item.forensic?.kind}:${versionKey(item.file.name)}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length >= 2) pairs.push({ base: group[0], current: group[group.length - 1] });
  }
  return pairs;
}

function textSimilarity(left, right) {
  const a = String(left || "").replace(/\s+/g, "");
  const b = String(right || "").replace(/\s+/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const bigrams = value => {
    const counts = new Map();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }
    return counts;
  };
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  let intersection = 0;
  for (const [pair, count] of leftPairs) intersection += Math.min(count, rightPairs.get(pair) || 0);
  return (2 * intersection) / Math.max(1, a.length + b.length - 2);
}

function criticalChange(text) {
  return /(金额|比例|日期|期限|责任|审批|批准|适用范围|生效|失效|公式|计算|模型|字段|接口|币种|利率|阈值|不得|必须|应当)/.test(text) || /\d/.test(text);
}

function documentVersionDiffIssues(base, current) {
  const issues = [];
  const baseBlocks = textBlocks(base).filter(block => block.type !== "table" && block.text.length >= 6);
  const currentBlocks = textBlocks(current).filter(block => block.type !== "table" && block.text.length >= 6);
  const maximum = Math.max(baseBlocks.length, currentBlocks.length);
  for (let index = 0; index < maximum && issues.length < 30; index += 1) {
    const before = baseBlocks[index];
    const after = currentBlocks[index];
    if (!before && after && criticalChange(after.text)) {
      issues.push(normalizeIssue({
        module: "version", category: "新增关键内容", severity: "medium", title: `当前版新增：${after.text.slice(0, 32)}`,
        summary: "当前版出现基准版同位置没有的关键表述。", basis: "按文档结构顺序对比后识别为新增内容。", impact: "需确认新增要求是否已同步到相关章节、表格和附件。", confidence: 0.72, inferenceLevel: "fact", source: "deterministic",
        evidence: [evidence(current.file, after)],
      }));
      continue;
    }
    if (before && !after && criticalChange(before.text)) {
      issues.push(normalizeIssue({
        module: "version", category: "删除关键内容", severity: "medium", title: `当前版删除：${before.text.slice(0, 32)}`,
        summary: "基准版中的关键表述未在当前版对应位置出现。", basis: "按文档结构顺序对比后识别为删除内容。", impact: "需确认删除是否有意，以及相关约束是否仍由其他条款承接。", confidence: 0.72, inferenceLevel: "fact", source: "deterministic",
        evidence: [evidence(base.file, before)],
      }));
      continue;
    }
    if (!before || !after || before.text === after.text) continue;
    const similarity = textSimilarity(before.text, after.text);
    if (similarity < 0.35 || similarity > 0.995 || !criticalChange(`${before.text}${after.text}`)) continue;
    issues.push(normalizeIssue({
      module: "version", category: "关键内容修改", severity: criticalChange(`${before.text}${after.text}`) ? "high" : "medium",
      title: `关键表述发生变化：${after.text.slice(0, 30)}`,
      summary: "当前版与基准版在对应位置的金额、日期、责任、范围、公式或关键条件表述不同。",
      basis: `结构位置相近且文本相似度为${Math.round(similarity * 100)}%，但关键内容发生变化。`,
      impact: "应优先复核该变化是否符合本次修订意图，并检查下游引用是否同步。",
      confidence: Math.max(0.62, Math.min(0.94, similarity)), inferenceLevel: "fact", source: "deterministic",
      evidence: [evidence(base.file, before), evidence(current.file, after)],
    }));
  }
  return issues;
}

function workbookVersionDiffIssues(base, current) {
  const issues = [];
  const baseSheets = new Map((base.forensic?.sheets || []).map(sheet => [sheet.name, sheet]));
  for (const currentSheet of current.forensic?.sheets || []) {
    const baseSheet = baseSheets.get(currentSheet.name);
    if (!baseSheet) continue;
    const baseCells = new Map((baseSheet.cells || []).map(cell => [cell.address, cell]));
    for (const cell of currentSheet.cells || []) {
      const before = baseCells.get(cell.address);
      if (!before) continue;
      const oldValue = before.formula ?? before.value;
      const newValue = cell.formula ?? cell.value;
      if (String(oldValue ?? "") === String(newValue ?? "")) continue;
      issues.push(normalizeIssue({
        module: "version", category: cell.formula || before.formula ? "公式变化" : "单元格变化", severity: cell.formula || before.formula ? "high" : "medium",
        title: `${currentSheet.name}!${cell.address}由“${String(oldValue).slice(0, 24)}”改为“${String(newValue).slice(0, 24)}”`,
        summary: "当前版与基准版在同一工作表、同一单元格的值或公式不同。", basis: "按工作表名称和单元格地址精确对齐。", impact: "可能改变汇总或下游计算结果。", confidence: 1, inferenceLevel: "fact", source: "deterministic",
        evidence: [
          evidence(base.file, { location: { kind: "cell", sheet: baseSheet.name, cell: before.address, label: `${baseSheet.name}!${before.address}` } }, String(oldValue ?? "")),
          evidence(current.file, { location: { kind: "cell", sheet: currentSheet.name, cell: cell.address, label: `${currentSheet.name}!${cell.address}` } }, String(newValue ?? "")),
        ],
      }));
      if (issues.length >= 50) return issues;
    }
  }
  return issues;
}

function versionIssues(items) {
  const issues = [];
  for (const item of items) {
    const revisions = item.forensic?.revisions;
    const comments = item.forensic?.comments || [];
    const revisionCount = (revisions?.insertions?.length || 0) + (revisions?.deletions?.length || 0);
    if (!revisionCount && !comments.length) continue;
    const anchors = [
      ...(revisions?.insertions || []).slice(0, 2),
      ...(revisions?.deletions || []).slice(0, 2),
    ];
    issues.push(normalizeIssue({
      module: "version",
      category: "修订与批注残留",
      severity: revisionCount ? "medium" : "low",
      title: `${item.file.name}仍包含修订或批注`,
      summary: `检测到${revisionCount}处修订和${comments.length}条批注。是否保留取决于交付版本要求。`,
      basis: "直接检查DOCX内部修订与批注结构，不依赖PDF渲染。",
      impact: "若作为正式终稿交付，可能暴露审阅过程或造成版本状态不清。",
      confidence: 1,
      inferenceLevel: "fact",
      source: "deterministic",
      evidence: anchors.length
        ? anchors.map(anchor => evidence(item.file, { location: anchor.location }, anchor.text))
        : [evidence(item.file, { location: comments[0]?.anchors?.[0] || { kind: "file", label: "文档批注结构" } }, comments[0]?.text || "存在批注")],
    }));
  }
  for (const pair of versionPairs(items)) {
    if (pair.base.forensic?.kind === "xlsx") issues.push(...workbookVersionDiffIssues(pair.base, pair.current));
    else issues.push(...documentVersionDiffIssues(pair.base, pair.current));
  }
  return issues;
}

export async function runDeterministicAnalysis({ items, modules, fieldMappings = {} }) {
  const selected = new Set(modules);
  const issues = [];
  if (selected.has("conflict")) issues.push(...conflictIssues(items));
  if (selected.has("logic")) issues.push(...logicIssues(items));
  if (selected.has("data")) issues.push(...dataIssues(items, fieldMappings));
  if (selected.has("proofread")) issues.push(...proofreadIssues(items), ...formatAnomalyIssues(items));
  if (selected.has("version")) issues.push(...versionIssues(items));
  return issues;
}
