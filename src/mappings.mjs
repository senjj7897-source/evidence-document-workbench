function refreshSummary(run) {
  const issues = run.issues || [];
  run.summary = {
    total: issues.length,
    high: issues.filter(issue => issue.severity === "high").length,
    medium: issues.filter(issue => issue.severity === "medium").length,
    low: issues.filter(issue => issue.severity === "low").length,
  };
}

export function applyMappingChoice({ project, run, issue, candidateId }) {
  if (!issue?.mapping) throw Object.assign(new Error("该问题不包含字段匹配候选"), { statusCode: 409 });
  const mapping = issue.mapping;
  if (candidateId === "none") {
    mapping.status = "rejected";
    mapping.selectedCandidateId = null;
    issue.category = "字段匹配已排除";
    issue.title = `“${mapping.label}”与已列候选字段均不对应`;
    issue.summary = "用户已确认当前候选都不是正确的Excel字段，本条不再作数据差异判断。";
    issue.status = "ignored";
    issue.severity = "low";
    issue.updatedAt = new Date().toISOString();
    refreshSummary(run);
    return { issue, run, project };
  }

  const candidate = mapping.candidates.find(item => item.id === candidateId);
  if (!candidate) throw Object.assign(new Error("字段候选不存在"), { statusCode: 400 });
  mapping.status = "confirmed";
  mapping.selectedCandidateId = candidate.id;
  project.fieldMappings = project.fieldMappings || {};
  project.fieldMappings[mapping.key] = {
    candidateId: candidate.id,
    documentLabel: mapping.label,
    candidateLabel: candidate.label,
    fileName: candidate.fileName,
    sheet: candidate.sheet,
    valueAddress: candidate.valueAddress,
    confirmedAt: new Date().toISOString(),
  };

  const document = mapping.document;
  const tolerance = Math.max(Number(document?.tolerance || 0), Number(candidate.tolerance || 0));
  const consistent = Math.abs(Number(document?.numeric) - Number(candidate.numeric)) <= tolerance;
  issue.evidence = [document.evidence, candidate.evidence].filter(Boolean);
  issue.documents = [...new Set(issue.evidence.map(item => item.fileName).filter(Boolean))];
  issue.confidence = 1;
  issue.inferenceLevel = "fact";
  if (consistent) {
    issue.category = "字段对应已确认";
    issue.title = `“${mapping.label}”与Excel“${candidate.label}”取值一致`;
    issue.summary = `已确认字段对应关系；文档为${document.raw}，Excel为${candidate.value}，差异在展示精度容差内。`;
    issue.basis = "用户确认字段对应后完成单位和展示精度归一化复算。";
    issue.impact = "未发现需要跟进的数据差异。";
    issue.severity = "low";
    issue.status = "resolved";
  } else {
    issue.category = "文档与表格数据差异";
    issue.title = `${mapping.label}与Excel字段取值不一致`;
    issue.summary = `已确认文档“${mapping.label}”对应Excel“${candidate.label}”。文档为${document.raw}，Excel为${candidate.value}，差异超出展示精度容差。`;
    issue.basis = "字段对应关系已由用户确认，并完成单位和展示精度归一化；未自动判断哪一方正确。";
    issue.impact = "可能影响汇总、报送或执行口径。";
    issue.severity = "high";
    issue.status = "open";
  }
  issue.updatedAt = new Date().toISOString();
  refreshSummary(run);
  return { issue, run, project };
}
