function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function evidenceLocation(item) {
  const location = item?.location || {};
  const parts = [];
  const page = location.page || location.pageHint;
  if (page) parts.push(`第${page}页`);
  if (location.label && location.label !== `第${page}页`) parts.push(location.label);
  if (location.sheet) parts.push(`工作表 ${location.sheet}`);
  if (location.cell) parts.push(`单元格 ${location.cell}`);
  return parts.filter(Boolean).join(" · ") || "文件级";
}

const moduleText = { conflict: "冲突检测", logic: "逻辑闭环", data: "数据核验", proofread: "文字校对", sentence: "逐句精审", writing: "写作优化", version: "版本差异", open: "开放发现", deep: "深度建议", assessment: "改进评估" };

export function issuesToCsv(run) {
  const header = ["序号", "严重程度", "模块", "发现类型", "类别", "问题", "结论", "依据", "影响或收益", "置信度", "状态", "文档", "证据位置", "证据原文"];
  const rows = run.issues.map((issue, index) => [
    index + 1,
    issue.severity,
    moduleText[issue.module] || issue.module,
    issue.findingType === "improvement" ? "改进建议" : "问题发现",
    issue.category,
    issue.title,
    issue.summary,
    issue.basis,
    issue.impact,
    issue.confidence,
    issue.status,
    issue.documents.join("；"),
    issue.evidence.map(item => `${item.fileName} · ${evidenceLocation(item)}`).join("；"),
    issue.evidence.map(item => item.quote).join("；"),
  ]);
  return `\ufeff${[header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
}

function assessmentToHtml(run) {
  const report = run.assessment;
  if (!report) return "";
  const typeMeta = {
    incomplete: { label: "不完整", description: "目标或逻辑链条尚未完整承接" },
    optimize: { label: "可优化", description: "提升清晰度、执行效率与可复核性" },
    deepen: { label: "可深化", description: "增强专业方法、分析深度与管理价值" },
  };
  const priorityText = { high: "优先推进", medium: "第二阶段", low: "持续优化" };
  const groups = Object.entries(typeMeta).map(([type, meta]) => ({ type, meta, items: report.items.filter(item => item.type === type) }));
  const groupHtml = groups.map((group, groupIndex) => `<details class="assessment-group ${group.type}" ${groupIndex === 0 ? "open" : ""}>
    <summary><div><span class="group-label">${escapeHtml(group.meta.label)}</span><h3>${escapeHtml(group.meta.description)}</h3></div><b>${group.items.length} 项</b></summary>
    <div class="assessment-items">${group.items.length ? group.items.map((item, index) => `<article class="assessment-item">
      <header><span class="assessment-number">${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(item.dimension)}</small><h4>${escapeHtml(item.title)}</h4></div><em class="priority ${escapeHtml(item.priority)}">${escapeHtml(priorityText[item.priority] || item.priority)}</em></header>
      <div class="reading-flow"><section><b>01</b><div><strong>原文事实</strong><small>现在写了什么</small></div><p>${escapeHtml(item.currentState)}</p></section><section class="gap"><b>02</b><div><strong>可确认缺口</strong><small>材料内可确认</small></div><p>${escapeHtml(item.confirmedGap || "旧版结果未单独标注")}</p></section><section><b>03</b><div><strong>专业判断</strong><small>现实失败方式</small></div><p>${escapeHtml(`${item.professionalJudgment || "旧版结果未单独标注"}${item.failureMode ? `；可能失败方式：${item.failureMode}` : ""}`)}</p></section><section class="closure"><b>04</b><div><strong>执行闭环</strong><small>${escapeHtml(item.closure?.status || "待判断")}</small></div><p>${escapeHtml(item.closure ? `目标：${item.closure.target}；输入：${item.closure.inputs}；监测：${item.closure.detection}；决策：${item.closure.decision}；动作：${item.closure.action}；解除与复盘：${item.closure.exitAndFeedback}` : "旧版结果未拆解执行闭环")}</p></section><section class="action"><b>05</b><div><strong>具体怎么改</strong><small>方案与步骤</small></div><p>${escapeHtml(`${item.recommendation}${item.implementationSteps?.length ? `；实施步骤：${item.implementationSteps.join("；")}` : ""}`)}</p></section><section class="boundary"><b>06</b><div><strong>材料与边界</strong><small>仍需确认</small></div><p>${escapeHtml(`${item.requiredEvidence?.length ? `待补材料：${item.requiredEvidence.join("；")}` : "无需额外材料"}；结论边界：${item.conclusionBoundary || "仅限本次导入材料"}`)}</p></section><section class="value"><b>07</b><div><strong>改完能得到什么</strong><small>预期改善</small></div><p>${escapeHtml(item.expectedValue)}</p></section></div>
      <details class="assessment-evidence"><summary>查看原文依据（${item.evidence.length} 处）</summary>${item.evidence.map(evidence => `<blockquote><strong>${escapeHtml(evidence.fileName)} · ${escapeHtml(evidenceLocation(evidence))}</strong><br>${escapeHtml(evidence.quote)}</blockquote>`).join("")}</details>
    </article>`).join("") : '<p class="empty-note">本轮没有足够证据支持的该类建议。</p>'}</div>
  </details>`).join("");
  const roadmap = (report.roadmap || []).map((phase, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(phase.phase)}</small><h4>${escapeHtml(phase.objective)}</h4><ul>${(phase.actions || []).map(action => `<li>${escapeHtml(action)}</li>`).join("")}</ul></div></article>`).join("");
  return `<section id="assessment" class="report-section assessment-report"><div class="section-heading"><span>IMPROVEMENT ASSESSMENT</span><h2>整份报告改进评估</h2><p>不局限于问题项，覆盖文档不完整、可优化与可深化的方向。</p></div><div class="assessment-hero"><div><span>整体成熟度</span><strong>${escapeHtml(report.overallRating)}</strong></div><p>${escapeHtml(report.executiveSummary)}</p></div><section class="strengths"><h3>已有基础</h3><ul>${(report.strengths || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>${groupHtml}${roadmap ? `<section class="roadmap"><h3>改进路线图</h3><div>${roadmap}</div></section>` : ""}</section>`;
}

export function issuesToHtml(project, run) {
  const severityText = { high: "高", medium: "中", low: "低" };
  const statusText = { open: "待处理", resolved: "已解决", ignored: "已忽略" };
  const inferenceText = { fact: "直接事实", confirmable_omission: "可确认缺口", risk_inference: "风险推断" };
  const findingText = { issue: "问题发现", improvement: "改进建议" };
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const orderedIssues = [...run.issues].sort((left, right) => (
    Number(left.status !== "open") - Number(right.status !== "open")
    || severityOrder[left.severity] - severityOrder[right.severity]
  ));
  const cards = orderedIssues.map((issue, index) => `
    <section class="issue">
      <div class="issue-head"><span class="number">${index + 1}</span><h2>${escapeHtml(issue.title)}</h2><span class="module-label">${escapeHtml(moduleText[issue.module] || issue.module)}</span><span class="finding ${issue.findingType === "improvement" ? "improvement" : ""}">${escapeHtml(findingText[issue.findingType] || findingText.issue)}</span><span class="status">${escapeHtml(statusText[issue.status] || issue.status)}</span><span class="severity ${issue.severity}">${severityText[issue.severity]}影响</span></div>
      <p>${escapeHtml(issue.summary)}</p>
      <dl><dt>类别</dt><dd>${escapeHtml(issue.category)}</dd><dt>结论层级</dt><dd>${escapeHtml(issue.findingType === "improvement" ? "模型建议" : inferenceText[issue.inferenceLevel] || issue.inferenceLevel)}</dd><dt>分析依据</dt><dd>${escapeHtml(issue.basis)}</dd><dt>${issue.findingType === "improvement" ? "预期收益" : "可能影响"}</dt><dd>${escapeHtml(issue.impact)}</dd><dt>置信度</dt><dd>${Math.round(issue.confidence * 100)}%</dd></dl>
      ${issue.module === "writing" && (issue.suggestedText || issue.acceptedSuggestion?.text) ? `<h3>${issue.acceptedSuggestion?.text ? "已采纳的写作版本" : "候选改写"}</h3><div class="rewrite"><div><strong>原文</strong><p>${escapeHtml(issue.originalText || issue.evidence?.[0]?.quote || "")}</p></div><div><strong>${issue.acceptedSuggestion?.text ? "最终稿" : "建议稿"}</strong><p>${escapeHtml(issue.acceptedSuggestion?.text || issue.suggestedText || "")}</p></div>${issue.rewriteReason ? `<small>${escapeHtml(issue.rewriteReason)}</small>` : ""}</div>` : ""}
      ${issue.module === "sentence" ? `<h3>逐句精审建议</h3><div class="rewrite sentence-rewrite"><div><strong>原句</strong><p>${escapeHtml(issue.originalText || issue.evidence?.[0]?.quote || "")}</p></div><div><strong>建议改法</strong><p>${escapeHtml(issue.suggestedText || "本条需要业务确认，暂不自动改写。")}</p></div><small><strong>修改理由：</strong>${escapeHtml(issue.rewriteReason || issue.basis || "")}</small></div>` : ""}
      <h3>证据</h3>
      ${issue.evidence.map(item => `<blockquote><strong>${escapeHtml(item.fileName)} · ${escapeHtml(evidenceLocation(item))}</strong><br>${escapeHtml(item.quote)}</blockquote>`).join("\n")}
    </section>`).join("\n");
  const openCount = run.issues.filter(issue => issue.status === "open").length;
  const resolvedCount = run.issues.filter(issue => issue.status === "resolved").length;
  const assessmentHtml = assessmentToHtml(run);
  const coverageText = run.coverage ? `${run.coverage.checked}/${run.coverage.total}` : "未记录";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(project.name)}审查报告</title><style>
  :root{font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;color:#172238;background:#edf1f4;line-height:1.65}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0}.topline{height:6px;background:linear-gradient(90deg,#122033,#17887d,#5870ad)}.cover,.report-section,.issue{max-width:1060px;margin:24px auto;background:#fff;border:1px solid #d9e1e7;border-radius:16px;padding:34px 38px;box-shadow:0 10px 30px rgba(20,39,72,.06)}.cover{margin-top:34px;background:linear-gradient(145deg,#101c2f,#17334a 60%,#17635d);color:#edf6f5;border:0}.eyebrow,.section-heading>span{font-size:12px;font-weight:800;letter-spacing:.14em;color:#79d4ca}.cover h1{font-size:34px;line-height:1.25;margin:10px 0}.cover>p{color:#bdcbd9}.summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:26px}.metric{padding:14px 15px;border:1px solid rgba(171,213,209,.18);border-radius:10px;background:rgba(9,21,35,.34);font-size:12px;color:#aebfd0}.metric b{font-size:23px;line-height:1.2;display:block;color:#8ce0d4}.report-nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.report-nav a{padding:8px 12px;border-radius:8px;text-decoration:none;color:#dbe7f2;background:rgba(255,255,255,.09);font-size:13px}.report-note{max-width:1060px;margin:0 auto;padding:0 3px;color:#66768a;font-size:13px}.section-heading{margin-bottom:20px}.section-heading>span{color:#1a746d}.section-heading h2{margin:5px 0 4px;font-size:27px}.section-heading p{margin:0;color:#718095}.assessment-hero{display:grid;grid-template-columns:190px minmax(0,1fr);gap:24px;align-items:center;padding:22px;border-radius:12px;color:#edf5f6;background:linear-gradient(135deg,#142338,#1c4c57)}.assessment-hero>div{display:grid;gap:3px;padding-right:20px;border-right:1px solid rgba(255,255,255,.16)}.assessment-hero span{color:#a9bdcc;font-size:12px}.assessment-hero strong{color:#8cdfd3;font-size:25px}.assessment-hero p{margin:0;line-height:1.8}.strengths{margin:16px 0;padding:18px 22px;border:1px solid #dce5e8;border-radius:11px;background:#f8fbfb}.strengths h3,.roadmap h3{margin:0 0 10px;font-size:17px}.strengths ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 24px;margin:0;padding-left:20px}.assessment-group{margin-top:14px;border:1px solid #d9e2e8;border-radius:12px;overflow:hidden}.assessment-group>summary{display:flex;justify-content:space-between;align-items:center;padding:17px 20px;cursor:pointer;background:#f8fafb}.assessment-group>summary div{display:flex;align-items:center;gap:12px}.assessment-group>summary h3{margin:0;color:#526175;font-size:14px;font-weight:500}.group-label{font-weight:900;color:#915a18}.assessment-group.optimize .group-label{color:#277187}.assessment-group.deepen .group-label{color:#5267a2}.assessment-group>summary>b{font-size:12px;color:#738196}.assessment-item{padding:24px;border-top:1px solid #e4e9ed}.assessment-item>header{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;align-items:start;max-width:900px}.assessment-number,.number{width:31px;height:31px;display:grid;place-items:center;border-radius:8px;background:#122033;color:#fff;font-size:12px;font-weight:900}.assessment-item header small{color:#17786f;font-size:12px;font-weight:800}.assessment-item h4{margin:4px 0 0;font-size:18px}.priority,.severity,.status,.finding{padding:5px 10px;border-radius:999px;font-style:normal;font-size:12px;white-space:nowrap}.priority.high,.severity.high{background:#fbe7eb;color:#a8384b}.priority.medium,.severity.medium{background:#fff0dc;color:#8c5914}.priority.low,.severity.low{background:#eaf1fb;color:#3e668f}.reading-flow{max-width:900px;margin:16px 0 0 46px;border:1px solid #dce4e9;border-radius:10px;overflow:hidden}.reading-flow section{display:grid;grid-template-columns:26px 130px minmax(0,1fr);gap:10px;align-items:start;padding:15px 16px;border-bottom:1px solid #e5eaee;background:#f8fafb}.reading-flow section:last-child{border:0}.reading-flow section.gap{background:#fff8ed}.reading-flow section.closure{background:#eef4f5}.reading-flow section.action{background:#eef8f5}.reading-flow section.boundary{background:#fbfaf8}.reading-flow section.value{background:#f5f6fb}.reading-flow section>b{width:25px;height:25px;display:grid;place-items:center;border-radius:6px;background:#dfe7ec;color:#5e7084;font-size:11px}.reading-flow .action>b{color:#fff;background:#238b80}.reading-flow .value>b{color:#fff;background:#6173a6}.reading-flow div{display:grid}.reading-flow strong{font-size:13px}.reading-flow small{color:#8794a3}.reading-flow p{margin:0;color:#34465a}.assessment-evidence{max-width:900px;margin:12px 0 0 46px;padding-top:10px;border-top:1px dashed #d5dee5}.assessment-evidence summary{cursor:pointer;color:#4f6e8b;font-weight:700}.roadmap{margin-top:18px;padding:22px;border-radius:12px;background:#f4f7f9}.roadmap>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.roadmap article{display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px;padding:14px;background:#fff;border:1px solid #dde4e8;border-radius:9px}.roadmap article>span{color:#78889a;font-weight:900}.roadmap h4{margin:2px 0 6px}.roadmap ul{margin:0;padding-left:18px}.issues-heading{max-width:1060px;margin:34px auto 12px}.issues-heading h2{margin:4px 0;font-size:27px}.issues-heading p{margin:0;color:#6b7a8c}.issue{margin-top:14px}.issue-head{display:flex;align-items:center;gap:9px}.issue-head h2{font-size:20px;line-height:1.35;flex:1}.finding{background:#edf1f5;color:#52657a}.finding.improvement{background:#eef0f9;color:#5367a5}.status{background:#edf2f8;color:#52657a}.issue>p{max-width:86ch;font-size:15px;line-height:1.8}.issue dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:9px 15px;padding:16px 18px;border-radius:10px;background:#f7f9fa}.issue dt{color:#6b778c;font-weight:700}.issue dd{margin:0}.issue blockquote,.assessment-evidence blockquote{margin:12px 0;padding:14px 17px;border-left:4px solid #32988e;background:#f2f8f6}.rewrite{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px;border:1px solid #cfe0f5;border-radius:10px;background:#f8fbff}.rewrite div{padding:10px;background:#fff;border-radius:8px}.rewrite p{margin:6px 0}.rewrite small{grid-column:1/-1;color:#65758a}.empty-note{padding:20px;color:#718095}@media(max-width:760px){.cover,.report-section,.issue{margin:12px;padding:22px}.summary{grid-template-columns:repeat(2,1fr)}.assessment-hero{grid-template-columns:1fr}.assessment-hero>div{border-right:0;border-bottom:1px solid rgba(255,255,255,.16);padding:0 0 12px}.strengths ul,.roadmap>div{grid-template-columns:1fr}.assessment-item>header{grid-template-columns:34px minmax(0,1fr)}.priority{grid-column:2;justify-self:start}.reading-flow{margin-left:0}.reading-flow section{grid-template-columns:26px minmax(0,1fr)}.reading-flow section>p{grid-column:1/-1}.assessment-evidence{margin-left:0}.issue-head{align-items:flex-start;flex-wrap:wrap}.issue-head h2{flex-basis:calc(100% - 46px)}.issue dl{grid-template-columns:1fr}.rewrite{grid-template-columns:1fr}}@media print{body{background:#fff}.topline,.report-nav{display:none}.cover,.report-section,.issue{box-shadow:none;break-inside:auto;margin:0 auto 20px}.assessment-item,.issue,blockquote{break-inside:avoid}}</style></head><body><div class="topline"></div>
  <section class="cover"><span class="eyebrow">DOCUMENT REVIEW REPORT</span><h1>${escapeHtml(project.name)}</h1><p>离线文档审查报告 · ${escapeHtml(new Date(run.completedAt || run.updatedAt).toLocaleString("zh-CN"))}</p><div class="summary"><div class="metric"><b>${run.summary?.total || run.issues.length}</b>全部问题</div><div class="metric"><b>${run.summary?.high || 0}</b>高影响</div><div class="metric"><b>${run.summary?.medium || 0}</b>中影响</div><div class="metric"><b>${openCount}</b>待处理</div><div class="metric"><b>${run.assessment?.items?.length || 0}</b>改进建议</div><div class="metric"><b>${escapeHtml(coverageText)}</b>固定清单覆盖</div></div><nav class="report-nav">${assessmentHtml ? '<a href="#assessment">整份报告改进评估</a>' : ""}<a href="#issues">问题与证据</a></nav></section><p class="report-note">本报告为单文件离线版本。直接事实、可确认缺口、风险推断和专业建议分别呈现；每条判断均保留文档名称、页码或位置及原文依据。</p>${assessmentHtml}<section id="issues" class="issues-heading"><span class="eyebrow" style="color:#1a746d">ISSUES & EVIDENCE</span><h2>问题与原文证据</h2><p>共 ${orderedIssues.length} 条，按待处理状态与影响程度排列。</p></section>${cards}</body></html>`;
}
