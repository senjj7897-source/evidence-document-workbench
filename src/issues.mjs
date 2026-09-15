import { createHash } from "node:crypto";

export const MODULES = [
  { id: "conflict", name: "逻辑一致性与冲突检测", shortName: "冲突检测", description: "单文档与跨文档的显性、隐性冲突" },
  { id: "logic", name: "逻辑完整性与闭环检测", shortName: "逻辑闭环", description: "定义、流程、条件和责任是否完整" },
  { id: "data", name: "文档与表格数据一致性核验", shortName: "数据核验", description: "文档与Excel数据、公式和规则承接" },
  { id: "proofread", name: "文字与异常格式检查", shortName: "文字校对", description: "错字、术语、编号与明显格式异常" },
  { id: "sentence", name: "逐句语言与歧义精审", shortName: "逐句精审", description: "逐句检查语言错误、语义边界、职责口径与阅读障碍，并给出可核验改法", semanticOnly: true },
  { id: "writing", name: "写作与表达优化", shortName: "写作优化", description: "轻度自然化和个人写作风格" },
  { id: "version", name: "版本差异与修订追踪", shortName: "版本差异", description: "新旧版本、修订与批注变化" },
  { id: "open", name: "开放审查与改进发现", shortName: "开放发现", description: "模型在预设分类之外发现其他缺点与改进机会", semanticOnly: true },
  { id: "deep", name: "深度分析与专业优化建议", shortName: "深度建议", description: "结合文档目标与专业场景提出结构化、可落地的优化方案", semanticOnly: true },
  { id: "assessment", name: "整体改进评估与深化建议", shortName: "改进评估", description: "从完整性、优化空间和深化方向评估整份报告并形成改进路线图", semanticOnly: true, reportOnly: true },
];

export function issueId(issue) {
  const evidenceKey = (issue.evidence || []).map(item => `${item.fileId}:${item.location?.label || ""}:${item.quote || ""}`).join("|");
  return createHash("sha1").update(`${issue.module}|${issue.title}|${evidenceKey}`).digest("hex").slice(0, 16);
}

export function normalizeIssue(issue, index = 0) {
  const findingType = issue.module === "deep"
    ? "improvement"
    : ["issue", "improvement"].includes(issue.findingType) ? issue.findingType : "issue";
  const requestedSeverity = ["high", "medium", "low"].includes(issue.severity) ? issue.severity : "medium";
  const normalized = {
    id: issue.id || issueId(issue) || `issue-${index + 1}`,
    module: issue.module || "conflict",
    category: issue.category || "待分类",
    severity: findingType === "improvement" && requestedSeverity === "high" ? "low" : requestedSeverity,
    status: ["open", "ignored", "resolved"].includes(issue.status) ? issue.status : "open",
    title: String(issue.title || "未命名问题").slice(0, 160),
    summary: String(issue.summary || "").slice(0, 2000),
    basis: String(issue.basis || "").slice(0, 2000),
    impact: String(issue.impact || "").slice(0, 2000),
    confidence: Math.max(0, Math.min(1, Number(issue.confidence ?? 0.7))),
    inferenceLevel: ["fact", "confirmable_omission", "risk_inference"].includes(issue.inferenceLevel)
      ? issue.inferenceLevel
      : "fact",
    source: issue.source || "deterministic",
    findingType,
    evidence: Array.isArray(issue.evidence) ? issue.evidence.slice(0, 12) : [],
    originalText: issue.originalText ? String(issue.originalText).slice(0, 4000) : null,
    suggestedText: issue.suggestedText ? String(issue.suggestedText).slice(0, 4000) : null,
    rewriteReason: issue.rewriteReason ? String(issue.rewriteReason).slice(0, 1200) : null,
    mapping: issue.mapping ? {
      key: String(issue.mapping.key || "").slice(0, 120),
      label: String(issue.mapping.label || "").slice(0, 160),
      status: ["unconfirmed", "confirmed", "rejected"].includes(issue.mapping.status) ? issue.mapping.status : "unconfirmed",
      selectedCandidateId: issue.mapping.selectedCandidateId || null,
      document: issue.mapping.document || null,
      candidates: Array.isArray(issue.mapping.candidates) ? issue.mapping.candidates.slice(0, 8) : [],
    } : null,
    suggestionHistory: Array.isArray(issue.suggestionHistory) ? issue.suggestionHistory.slice(-12) : [],
    acceptedSuggestion: issue.acceptedSuggestion || null,
    createdAt: issue.createdAt || new Date().toISOString(),
  };
  normalized.documents = [...new Set(normalized.evidence.map(item => item.fileName).filter(Boolean))];
  return normalized;
}

export function deduplicateIssues(issues) {
  const result = [];
  const seen = new Set();
  for (const candidate of issues.map(normalizeIssue)) {
    const key = `${candidate.module}|${candidate.title}|${candidate.evidence.map(item => `${item.fileId}:${item.location?.label || ""}`).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}
