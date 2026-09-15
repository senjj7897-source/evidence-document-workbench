export const ANALYSIS_VERSION = "closure-review-v2";

export const MODULE_CHECKLISTS = Object.freeze({
  conflict: ["单文档前后一致性", "跨文档事实与口径一致性", "隐含条件一致性"],
  logic: ["定义与术语", "适用范围", "流程步骤", "条件与例外", "责任主体", "数据口径", "生命周期与更新"],
  data: ["字段映射", "明细对数", "汇总复算", "公式实现", "单位与精度", "版本与统计范围"],
  proofread: ["错字漏字与重复", "术语一致性", "编号与交叉引用", "明显格式异常"],
  sentence: ["错字漏字、标点与语法搭配", "指代、修饰关系与语义边界", "职责主体与术语口径", "编号、交叉引用与制发残留", "句子负担与阅读障碍", "专业术语与权威口径"],
  writing: ["冗余与机械表达", "指代与歧义", "句式可读性", "语气一致性"],
  version: ["正文变化", "表格与公式变化", "修订批注残留", "目录与附件同步"],
  open: ["信息组织", "可维护性", "可追踪性", "可执行性", "读者理解成本"],
  deep: ["方法体系", "情景与参数设计", "数据与模型验证", "治理与职责", "结果解释", "管理应用", "可复核性"],
});

export function buildCoveragePlan({ items = [], modules = [] } = {}) {
  const expectedChecks = [...new Set(modules)].flatMap(module => (
    (MODULE_CHECKLISTS[module] || []).map(dimension => ({ module, dimension }))
  ));
  const source = items.reduce((summary, item) => {
    const forensic = item.forensic || {};
    const blocks = forensic.blocks || forensic.pages || [];
    const cells = [
      ...(forensic.sheets || []).flatMap(sheet => sheet.cells || []),
      ...(forensic.embeddedWorkbooks || []).flatMap(workbook => (
        (workbook.sheets || []).flatMap(sheet => sheet.cells || [])
      )),
    ];
    summary.files += 1;
    summary.blocks += blocks.length;
    summary.cells += cells.length;
    summary.characters += blocks.reduce((total, block) => total + String(block.text || "").length, 0)
      + cells.reduce((total, cell) => total + String(cell.value ?? "").length + String(cell.formula ?? "").length, 0);
    return summary;
  }, { files: 0, blocks: 0, cells: 0, characters: 0 });
  return { analysisVersion: ANALYSIS_VERSION, source, expectedChecks };
}

export function finalizeCoverage(plan, reportedChecks = []) {
  const reported = new Map(reportedChecks.map(item => [`${item.module}\u0000${item.dimension}`, item]));
  const checks = plan.expectedChecks.map(expected => {
    const item = reported.get(`${expected.module}\u0000${expected.dimension}`);
    if (!item) return { ...expected, status: "blocked", notes: "模型未返回该检查维度，不能声称已完成。" };
    const reportedStatus = ["finding", "no_finding", "blocked"].includes(item.status) ? item.status : "blocked";
    const notes = String(item.notes || "").trim();
    const evidenceLabels = Array.isArray(item.evidenceLabels)
      ? item.evidenceLabels.map(label => String(label).trim()).filter(Boolean).slice(0, 12)
      : [];
    const counterEvidenceChecked = item.counterEvidenceChecked === true;
    const auditable = reportedStatus === "blocked"
      || (notes.length >= 8 && evidenceLabels.length > 0 && counterEvidenceChecked);
    const status = auditable ? reportedStatus : "blocked";
    return {
      ...expected,
      status,
      notes: auditable ? notes : `审查依据不足，不能计入完成度。${notes ? ` 模型说明：${notes}` : ""}`,
      evidenceLabels,
      counterEvidenceChecked,
    };
  });
  const checked = checks.filter(item => item.status !== "blocked").length;
  return {
    ...plan,
    checks,
    checked,
    total: checks.length,
    complete: checks.length > 0 && checked === checks.length,
  };
}
