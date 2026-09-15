import { inferUploadRoles, recommendAnalysisModules } from "./file-roles.js";
import { renderPreviewMarkdown } from "./file-preview.js";
import { captureScrollPositions, restoreScrollPositions } from "./view-state.js";

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, options);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload.error || payload || `请求失败：${response.status}`);
    return payload;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); },
  patch(path, body) { return this.request(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); },
};

const moduleIcons = {
  conflict: "ph-arrows-left-right",
  logic: "ph-flow-arrow",
  data: "ph-table",
  proofread: "ph-text-aa",
  sentence: "ph-text-align-left",
  writing: "ph-pen-nib",
  version: "ph-git-diff",
  open: "ph-sparkle",
  deep: "ph-strategy",
  assessment: "ph-chart-polar",
};
const moduleLabels = { conflict: "冲突检测", logic: "逻辑闭环", data: "数据核验", proofread: "文字校对", sentence: "逐句精审", writing: "写作优化", version: "版本差异", open: "开放发现", deep: "深度建议", assessment: "改进评估" };
const roleLabels = { main: "主文档", attachment: "附件", data: "数据表", reference: "依据", "version-base": "基准版", "version-current": "当前版" };
const severityLabels = { high: "高", medium: "中", low: "低" };
const statusLabels = { queued: "等待开始", running: "分析中", completed: "分析完成", failed: "分析失败" };
const issueStatusLabels = { open: "待处理", resolved: "已解决", ignored: "已忽略" };
const state = {
  health: null,
  providers: [],
  modules: [],
  projects: [],
  project: null,
  run: null,
  selectedModules: new Set(["conflict", "logic", "data", "proofread", "open"]),
  selectedIssueId: null,
  statusFilter: "open",
  severityFilter: "all",
  moduleFilter: "all",
  dataFilter: "all",
  view: "setup",
  returnProjectId: null,
  upload: { active: false, done: 0, total: 0 },
  rewriting: false,
  searchQuery: "",
  detailTab: "overview",
  detailDrawerOpen: false,
  filePreview: null,
  filePreviewTab: "content",
  filePreviewLoading: false,
};

const app = document.querySelector("#app");
const fileInput = document.querySelector("#file-input");
const toast = document.querySelector("#toast");
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function icon(name, className = "") {
  return `<i class="ph ${name} ${className}" aria-hidden="true"></i>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function iconType(file) {
  if ([".xls", ".xlsx", ".xlsm", ".csv"].includes(file.extension)) return "xls";
  if (file.extension === ".pdf") return "pdf";
  return "doc";
}

function providerLabel(id) {
  if (id === "deterministic-fallback") return "确定性引擎（AI降级）";
  return state.providers.find(provider => provider.id === id)?.label || (id ? id : "待选择");
}

function providerOptions() {
  const providers = state.providers.length ? state.providers : [
    { id: "auto", label: "自动选择", available: true },
    { id: "codex-local", label: "本机 Codex", available: Boolean(state.health?.providers?.codexLocal) },
    { id: "deterministic", label: "仅确定性核验", available: true },
  ];
  return providers.map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.available ? "" : "disabled"}>${escapeHtml(provider.label)}${provider.available ? "" : "（不可用）"}</option>`).join("");
}

function topbar() {
  const status = state.run?.status || "ready";
  const projectOptions = state.projects.map(project => `<option value="${project.id}" ${state.project?.id === project.id ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("");
  const canReturn = Boolean(state.run?.issues?.length || state.returnProjectId || state.projects.length);
  const isNewTask = state.view === "setup" && !state.project;
  const engine = state.run?.providerUsed ? providerLabel(state.run.providerUsed) : state.health?.providers?.codexLocal ? "Codex 可用" : "确定性引擎";
  return `<header class="topbar">
    <button class="brand" data-action="go-home" aria-label="返回问题工作台"><span class="logo">${icon("ph-shield-check")}</span><span><strong>文档审查</strong><small>Document Intelligence</small></span></button>
    <a class="btn small" href="/">工作台首页</a><span class="topbar-divider"></span>
    <label class="project-chip"><span>当前任务</span><select id="project-selector" aria-label="切换审查任务"><option value="">新建审查任务</option>${projectOptions}</select>${icon("ph-caret-down")}</label>
    <div class="top-context">
      <div class="provider-chip"><span class="engine-dot"></span><span>分析引擎</span><strong>${escapeHtml(engine)}</strong></div>
      <div class="status-chip ${status}"><span></span>${statusLabels[status] || "待开始"}</div>
    </div>
    <div class="top-actions">
      ${state.view === "setup" && canReturn ? `<button class="btn home-btn" data-action="go-home">${icon("ph-arrow-left")} 返回问题工作台</button>` : ""}
      ${!isNewTask ? `<button class="btn" data-action="new-project">${icon("ph-file-plus")} 新建审查任务</button>` : ""}
      ${state.view === "issues" ? `<button class="btn" data-action="back-setup">${icon("ph-gear-six")} 调整当前任务</button>` : ""}
      ${state.view === "issues" && state.run?.status === "completed" ? `<button class="btn" data-action="export-xlsx">${icon("ph-table")} 问题清单</button><button class="btn primary" data-action="export-html">${icon("ph-export")} 审查报告</button>` : ""}
    </div>
  </header>`;
}

function navRail(active = "issues") {
  const canReturn = Boolean(state.run?.issues?.length || state.returnProjectId || state.projects.length);
  return `<nav class="nav-rail" aria-label="全局导航">
    <div class="rail-main">
      <button class="rail-action ${active === "issues" ? "active" : ""}" data-action="go-home" aria-label="问题工作台" ${active === "issues" ? 'aria-current="page"' : ""} ${canReturn ? "" : "disabled"}>${icon("ph-list-checks")}<span class="rail-tooltip">问题工作台</span></button>
      <button class="rail-action ${active === "setup" ? "active" : ""}" data-action="back-setup" aria-label="调整当前任务" ${active === "setup" ? 'aria-current="page"' : ""}>${icon("ph-gear-six")}<span class="rail-tooltip"><b>调整当前任务</b><small>保留现有材料与结果</small></span></button>
      <span class="rail-separator" aria-hidden="true"></span>
      <button class="rail-action rail-create" data-action="new-project" aria-label="新建审查任务">${icon("ph-file-plus")}<span class="rail-tooltip"><b>新建审查任务</b><small>创建独立的空白任务</small></span></button>
    </div>
    <div class="rail-foot"><span class="rail-status ${state.health ? "online" : ""}" title="本地服务状态"></span><span>LOCAL</span></div>
  </nav>`;
}

function fileRows(files = []) {
  if (!files.length) return "";
  return `<div class="file-list">${files.map(file => {
    const type = iconType(file);
    const statusClass = file.parse?.status === "ok" ? "parse-ok" : file.parse?.status === "failed" ? "parse-failed" : "parse-running";
    const statusText = file.parse?.status === "ok" ? `已解析 · ${file.parse.forensic?.kind || ""}` : file.parse?.status === "failed" ? "解析失败" : "解析中";
    const roleOptions = Object.entries(roleLabels).map(([value,label]) => `<option value="${value}" ${file.role === value ? "selected" : ""}>${label}</option>`).join("");
    const fileIcon = type === "xls" ? "ph-file-xls" : type === "pdf" ? "ph-file-pdf" : "ph-file-doc";
    return `<div class="file-row"><span class="file-icon ${type}">${icon(fileIcon)}</span><div><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><div class="tiny ${statusClass}">${statusText} · ${formatSize(file.size || 0)}</div></div><select class="file-role" data-file-role="${file.id}" aria-label="${escapeHtml(file.name)}的文档角色">${roleOptions}</select></div>`;
  }).join("")}</div>`;
}

function versionPairPanel(files = []) {
  const base = files.find(file => file.role === "version-base");
  const current = files.find(file => file.role === "version-current");
  if (!base && !current) return "";
  return `<div class="version-pair"><div><span class="tiny muted">基准版</span><strong>${escapeHtml(base?.name || "待指定")}</strong></div><span class="version-arrow">${icon("ph-arrow-right")}</span><div><span class="tiny muted">当前版</span><strong>${escapeHtml(current?.name || "待指定")}</strong></div><button class="btn small" data-action="swap-version" ${base && current ? "" : "disabled"}>${icon("ph-arrows-clockwise")} 调换</button></div>`;
}

function moduleCards() {
  return `<div class="module-grid">${state.modules.map(module => `<label class="module-card ${module.semanticOnly ? "semantic-only" : ""} ${state.selectedModules.has(module.id) ? "selected" : ""}" data-module-card="${module.id}">
    <input type="checkbox" data-module="${module.id}" ${state.selectedModules.has(module.id) ? "checked" : ""} />
    <span class="module-icon">${icon(moduleIcons[module.id])}</span><span class="module-card-title"><h3>${escapeHtml(module.shortName)}</h3>${module.semanticOnly ? `<span class="ai-badge">${module.id === "assessment" ? "AI整体评估" : module.id === "deep" ? "AI专业分析" : module.id === "sentence" ? "AI逐句推理" : "AI开放判断"}</span>` : ""}</span><p>${escapeHtml(module.description)}</p>
  </label>`).join("")}</div>`;
}

function setupView() {
  const files = state.project?.files || [];
  const uploaded = files.length > 0;
  const hasResults = Boolean(state.run?.status === "completed" && state.run?.issues);
  const canStart = files.some(file => file.parse?.status === "ok") && state.selectedModules.size > 0 && !state.upload.active;
  const launchLabel = canStart ? (hasResults ? "重新分析" : "开始分析") : uploaded ? "等待文件解析完成" : "请先导入文件";
  const heading = !state.project ? {
    eyebrow: "新建审查任务",
    title: "选择本次分析内容",
    description: "先导入本次材料，再决定要运行哪些分析模块。系统不会默认替你全选。",
  } : hasResults ? {
    eyebrow: "调整当前任务",
    title: "调整材料与分析范围",
    description: "当前结果会继续保留；重新分析后生成一轮新的问题结果。",
  } : {
    eyebrow: "准备审查任务",
    title: "确认材料与分析范围",
    description: "文件已建立本地只读快照，请确认角色和本次需要的分析模块。",
  };
  return `${topbar()}<main class="setup-layout">${navRail("setup")}<div class="setup-shell">
    <section class="setup-hero"><div class="setup-hero-copy"><div class="eyebrow">${heading.eyebrow}</div><h1>${heading.title}</h1><p>${heading.description}</p></div>
      <div class="setup-hero-meta"><span>安全模式</span><strong>${icon("ph-lock-key")} 本地只读快照</strong><small>分析不会修改源文件</small></div>
      ${hasResults ? `<div class="existing-result"><span>当前结果</span><strong>${state.run.issues.length} 条问题</strong><span>可返回工作台继续复核，或调整范围后重新分析。</span></div>` : `<div class="steps"><div class="step ${uploaded ? "done" : "active"}"><b>01</b><span>导入文件</span></div><div class="step ${uploaded ? "active" : ""}"><b>02</b><span>选择模块</span></div><div class="step"><b>03</b><span>执行分析</span></div><div class="step"><b>04</b><span>复核问题</span></div></div>`}
    </section>
    <div class="setup-grid">
      <section class="card material-card"><div class="section-head"><div><span class="section-index">01</span><h2>任务材料</h2></div><span class="tag">本地快照</span></div>
        <label class="tiny muted" for="project-name">任务名称</label><input class="project-name" id="project-name" maxlength="100" value="${escapeHtml(state.project?.name || "制度材料审查")}" />
        <div class="dropzone" data-testid="dropzone"><div><span class="dropzone-icon">${icon("ph-upload-simple")}</span><strong>拖拽文件到这里</strong><span class="muted">支持 Word、Excel、PDF 等常见格式</span><div class="dropzone-action"><button class="btn small" data-action="pick-files">${icon("ph-folder-open")} 选择文件</button></div></div></div>
        ${state.upload.active ? `<div class="upload-progress"><span style="width:${state.upload.total ? state.upload.done / state.upload.total * 100 : 0}%"></span></div><div class="tiny muted" style="margin-top:6px">正在建立只读快照并解析 ${state.upload.done}/${state.upload.total}</div>` : ""}
        ${fileRows(files)}
        ${versionPairPanel(files)}
      </section>
      <section class="card module-select-card"><div class="section-head"><div><span class="section-index">02</span><h2>选择分析模块</h2><p class="section-help">系统会推荐，但只运行你本次勾选的内容</p></div><span class="selection-count">已选 ${state.selectedModules.size} 项</span><button class="btn small" data-action="select-all">全部选择</button></div>
        ${moduleCards()}
        <div class="launch-row"><label><span class="tiny muted">分析引擎</span><select id="provider">${providerOptions()}</select></label><button class="btn primary launch-button" data-action="start-analysis" ${canStart ? "" : "disabled"}>${launchLabel} ${icon("ph-arrow-right")}</button></div>
      </section>
    </div>
  </div></main>`;
}

function filteredIssues() {
  let issues = state.run?.issues || [];
  if (state.moduleFilter !== "all") issues = issues.filter(issue => issue.module === state.moduleFilter);
  if (state.moduleFilter === "data" && state.dataFilter !== "all") issues = issues.filter(issue => dataIssueKind(issue) === state.dataFilter);
  if (state.statusFilter !== "all") issues = issues.filter(issue => issue.status === state.statusFilter);
  if (state.severityFilter !== "all") issues = issues.filter(issue => issue.severity === state.severityFilter);
  if (state.searchQuery.trim()) {
    const query = state.searchQuery.trim().toLowerCase();
    issues = issues.filter(issue => `${issue.title} ${issue.summary} ${issue.category} ${issue.evidence?.map(item => item.fileName).join(" ")}`.toLowerCase().includes(query));
  }
  return issues;
}

function dataIssueKind(issue) {
  const text = `${issue.category || ""} ${issue.title || ""}`;
  return /(缺失|未承接|承接|字段|范围|表样|模板|规则)/.test(text) ? "rule" : "difference";
}

function selectedIssue() {
  const issues = state.run?.issues || [];
  return issues.find(issue => issue.id === state.selectedIssueId) || filteredIssues()[0] || issues[0];
}

function findingTag(issue) {
  if (issue.module === "deep") return '<span class="tag improvement">专业建议</span>';
  if (issue.module === "sentence") return `<span class="tag sentence-finding">${issue.findingType === "improvement" ? "表达优化" : issue.inferenceLevel === "fact" ? "明确错误" : "需确认歧义"}</span>`;
  if (issue.findingType === "improvement") return '<span class="tag improvement">改进建议</span>';
  if (issue.module === "open") return '<span class="tag model-finding">模型发现</span>';
  return "";
}

function evidenceLocation(item) {
  const location = item?.location || {};
  const parts = [];
  const page = location.page || location.pageHint;
  if (page) parts.push(`第${page}页`);
  if (location.label && location.label !== `第${page}页`) parts.push(location.label);
  if (location.sheet) parts.push(`工作表 ${location.sheet}`);
  if (location.cell) parts.push(`单元格 ${location.cell}`);
  return parts.join(" · ") || "文件级";
}

function leftPanel() {
  const files = state.project.files;
  const counts = Object.fromEntries(state.modules.map(module => [module.id, state.run.issues.filter(issue => issue.module === module.id).length]));
  return `<aside class="left-panel">
    <div class="context-head"><span class="context-label">当前审查任务</span><h2>${escapeHtml(state.project.name)}</h2><div class="context-state"><span class="state-beacon"></span><span>${statusLabels[state.run.status] || "待开始"}</span><b>${state.run.issues.length} 个问题</b></div></div>
    <section class="context-section"><div class="panel-title"><div><span class="panel-kicker">SOURCE SET</span><h3>任务材料</h3></div><span class="count-pill">${files.length}</span></div><div class="left-files">${files.map(file => { const type = iconType(file); const fileIcon = type === "xls" ? "ph-file-xls" : type === "pdf" ? "ph-file-pdf" : "ph-file-doc"; return `<button class="left-file" data-preview-file="${file.id}" aria-label="打开 ${escapeHtml(file.name)} 的内容预览"><span class="file-icon ${type}">${icon(fileIcon)}</span><span class="left-file-text"><span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><small>${escapeHtml(roleLabels[file.role] || "附件")} · 点击查看内容</small></span><span class="file-open-icon">${icon("ph-arrow-square-out")}</span></button>`; }).join("")}</div></section>
    <section class="context-section module-context"><div class="panel-title"><div><span class="panel-kicker">REVIEW LENS</span><h3>分析模块</h3></div></div><div class="module-summary"><button class="${state.moduleFilter === "all" ? "active" : ""}" data-module-filter="all"><span class="module-nav-label">${icon("ph-stack")}全部问题</span><b>${state.run.issues.length}</b></button>${[...state.selectedModules].map(id => `<button class="${state.moduleFilter === id ? "active" : ""}" data-module-filter="${id}"><span class="module-nav-label">${icon(moduleIcons[id])}${moduleLabels[id]}</span><b>${id === "assessment" ? state.run.assessment ? "报告" : "—" : counts[id] || 0}</b></button>`).join("")}</div></section>
    <div class="context-foot">${state.run.warnings?.length ? `<div class="warning tiny">${icon("ph-warning-circle")}${escapeHtml(state.run.warnings[0])}</div>` : `<div class="trust-note">${icon("ph-shield-check")}<span><strong>证据可追溯</strong><small>每条结论均关联原文位置</small></span></div>`}<button class="context-settings" data-action="back-setup">${icon("ph-gear-six")} 调整任务材料与分析范围</button></div>
  </aside>`;
}

function issuesPanel() {
  const issues = state.run.issues || [];
  const scopedIssues = state.moduleFilter === "all" ? issues : issues.filter(issue => issue.module === state.moduleFilter);
  const counts = {
    total: scopedIssues.length,
    high: scopedIssues.filter(issue => issue.severity === "high" && issue.status === "open").length,
    medium: scopedIssues.filter(issue => issue.severity === "medium" && issue.status === "open").length,
    resolved: scopedIssues.filter(issue => issue.status === "resolved").length,
  };
  const rows = filteredIssues();
  const selected = selectedIssue();
  const scopeTitle = state.moduleFilter === "all" ? "全部模块" : moduleLabels[state.moduleFilter] || state.moduleFilter;
  return `<section class="issues-panel">
    <div class="issues-heading"><div><span class="panel-kicker">REVIEW QUEUE / ${escapeHtml(scopeTitle)}</span><h1>审查问题队列</h1><p>按风险优先复核，打开问题即可查看判断依据与原文证据。</p></div><div class="queue-progress"><span>待复核</span><strong>${counts.high + counts.medium}</strong><small>项重点问题</small></div></div>
    <div class="risk-summary"><div class="risk-cell total"><span>本范围</span><b>${counts.total}</b><small>全部问题</small></div><div class="risk-cell high"><span>高影响</span><b>${counts.high}</b><small>优先处理</small></div><div class="risk-cell medium"><span>中影响</span><b>${counts.medium}</b><small>建议核验</small></div><div class="risk-cell resolved"><span>已解决</span><b>${counts.resolved}</b><small>处理进度</small></div></div>
    <div class="queue-tools"><label class="search-field">${icon("ph-magnifying-glass")}<input id="issue-search" type="search" value="${escapeHtml(state.searchQuery)}" placeholder="搜索问题、文件或类型" /></label><label class="mobile-module-filter"><span>分析模块</span><select id="mobile-module-filter"><option value="all">全部模块</option>${[...state.selectedModules].map(id => `<option value="${id}" ${state.moduleFilter === id ? "selected" : ""}>${escapeHtml(moduleLabels[id] || id)}${id === "assessment" ? "（报告）" : `（${state.run.issues.filter(issue => issue.module === id).length}）`}</option>`).join("")}</select></label><span class="visible-count">显示 <b>${rows.length}</b> / ${counts.total}</span></div>
    <div class="filter-bar"><div class="filter-group"><span>处理状态</span>${[["open","待处理"],["all","全部"],["resolved","已解决"],["ignored","已忽略"]].map(([id,label]) => `<button class="filter ${state.statusFilter === id ? "active" : ""}" data-status-filter="${id}">${label}</button>`).join("")}</div><div class="filter-group"><span>影响等级</span>${[["all","全部"],["high","高"],["medium","中"],["low","低"]].map(([id,label]) => `<button class="filter ${state.severityFilter === id ? "active" : ""}" data-severity-filter="${id}">${label}</button>`).join("")}</div></div>
    ${state.moduleFilter === "data" ? `<div class="data-tabs"><span class="tiny muted">数据核验范围</span>${[["all","全部"],["difference","数据差异"],["rule","规则未承接"]].map(([id,label]) => `<button class="filter ${state.dataFilter === id ? "active" : ""}" data-data-filter="${id}">${label}</button>`).join("")}</div>` : ""}
    <div class="issue-list-head"><span>风险与问题</span><span>判断范围</span></div><div class="issue-list">${rows.length ? rows.map((issue, index) => { const first = issue.evidence?.[0]; return `<article class="issue-row ${issue.severity} ${selected?.id === issue.id ? "selected" : ""}" data-issue="${issue.id}"><span class="issue-severity-line"></span><div class="issue-order">${String(index + 1).padStart(2, "0")}</div><div class="issue-copy"><div class="issue-meta"><span class="tag ${issue.severity}">${severityLabels[issue.severity]}影响</span>${findingTag(issue)}<span>${escapeHtml(moduleLabels[issue.module] || issue.module)}</span><span>${escapeHtml(issue.category)}</span></div><div class="issue-title">${escapeHtml(issue.title)}</div><div class="issue-sub">${escapeHtml(issue.summary)}</div>${first ? `<div class="issue-location">${icon("ph-map-pin")}<strong>${escapeHtml(first.fileName)}</strong><span>${escapeHtml(evidenceLocation(first))}</span></div>` : ""}</div><div class="issue-signals"><span class="confidence">置信度 <b>${Math.round(issue.confidence * 100)}%</b></span><span class="evidence-count">${icon("ph-quotes")} ${issue.evidence.length} 处证据</span><span class="issue-chevron">${icon("ph-caret-right")}</span></div></article>`; }).join("") : `<div class="empty">${icon("ph-magnifying-glass")}<h3>没有匹配的问题</h3><p>请调整搜索词或筛选条件。</p></div>`}</div>
  </section>`;
}

function assessmentList(items, emptyText = "本轮无需补充") {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  return safeItems.length
    ? `<ol>${safeItems.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
    : `<p class="assessment-empty-copy">${escapeHtml(emptyText)}</p>`;
}

function closureMap(closure = {}) {
  const fields = [
    ["目标", closure.target],
    ["输入与数据", closure.inputs],
    ["指标与监测", closure.detection],
    ["阈值与决策", closure.decision],
    ["责任与动作", closure.action],
    ["解除、验证与复盘", closure.exitAndFeedback],
  ];
  const statusLabels = { complete: "闭环完整", partial: "部分闭环", broken: "关键链路断裂", not_applicable: "本项不适用" };
  return `<div class="closure-map"><div class="closure-map-head"><strong>执行闭环</strong><span class="${escapeHtml(closure.status || "partial")}">${escapeHtml(statusLabels[closure.status] || "待判断")}</span></div><div class="closure-grid">${fields.map(([label, value]) => `<section><b>${label}</b><p>${escapeHtml(value || "材料未说明")}</p></section>`).join("")}</div>${closure.missingLinks?.length ? `<div class="closure-missing"><strong>断点</strong>${closure.missingLinks.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}</div>`;
}

function assessmentItemCard(item, index, priorityLabels) {
  const currentState = item.currentState || "未形成可复核的现状描述。";
  const confirmedGap = item.confirmedGap || "旧版分析未单独标注可确认缺口。";
  const judgment = item.professionalJudgment || "旧版分析未单独标注专业判断。";
  const failureMode = item.failureMode || "旧版分析未单独说明现实失效方式。";
  const conclusionBoundary = item.conclusionBoundary || "结论仅以本次导入材料为边界。";
  return `<article class="assessment-item"><div class="assessment-item-top"><span class="assessment-order">${String(index + 1).padStart(2, "0")}</span><div><span class="assessment-dimension">${escapeHtml(item.dimension)}</span><h3>${escapeHtml(item.title)}</h3></div><span class="assessment-priority ${item.priority}">${priorityLabels[item.priority] || item.priority}</span></div><div class="assessment-reading-flow"><section class="assessment-reading-step current"><header><b>01</b><span>原文现在写了什么</span><small>事实，不作延伸</small></header><p>${escapeHtml(currentState)}</p></section><section class="assessment-reading-step gap"><header><b>02</b><span>可以确认缺什么</span><small>仅限材料内可确认</small></header><div><p>${escapeHtml(confirmedGap)}</p><aside><strong>实际失败方式</strong><span>${escapeHtml(failureMode)}</span></aside></div></section><section class="assessment-reading-step judgment"><header><b>03</b><span>专业评估</span><small>与事实分开</small></header><p>${escapeHtml(judgment)}</p></section>${closureMap(item.closure)}<section class="assessment-reading-step action"><header><b>04</b><span>具体怎么改</span><small>载体与机制</small></header><div><p>${escapeHtml(item.recommendation)}</p><div class="implementation-steps"><strong>落地步骤</strong>${assessmentList(item.implementationSteps, "旧版结果未拆分实施步骤")}</div></div></section><section class="assessment-reading-step boundary"><header><b>05</b><span>还需什么材料</span><small>结论边界</small></header><div>${assessmentList(item.requiredEvidence, "当前建议不依赖额外材料")}<aside><strong>本次不能断定</strong><span>${escapeHtml(conclusionBoundary)}</span></aside></div></section><section class="assessment-reading-step value"><header><b>06</b><span>改完能得到什么</span><small>预期改善</small></header><p>${escapeHtml(item.expectedValue)}</p></section></div><details class="assessment-evidence"><summary>${icon("ph-quotes")} 查看原文依据（${item.evidence.length} 处）</summary>${item.evidence.map(evidence => `<blockquote><strong>${escapeHtml(evidence.fileName)} · ${escapeHtml(evidenceLocation(evidence))}</strong><p>${escapeHtml(evidence.quote)}</p></blockquote>`).join("")}</details></article>`;
}

function assessmentPanel() {
  const report = state.run?.assessment;
  if (!report) return `<section class="assessment-panel"><div class="empty">${icon("ph-chart-polar")}<h3>尚未生成改进评估</h3><p>请在任务设置中勾选“改进评估”，并使用语义模型重新分析。</p></div></section>`;
  const coverage = state.run?.coverage;
  const protocol = state.run?.reviewProtocol;
  const typeMeta = {
    incomplete: { label: "不完整", icon: "ph-puzzle-piece", description: "文档自身目标或逻辑链条尚未完整承接" },
    optimize: { label: "可优化", icon: "ph-wrench", description: "已有内容可进一步提升清晰度与执行效率" },
    deepen: { label: "可深化", icon: "ph-trend-up", description: "可增强专业方法、分析深度与管理价值" },
  };
  const priorityLabels = { high: "优先推进", medium: "第二阶段", low: "持续优化" };
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const grouped = Object.keys(typeMeta).map(type => ({ type, items: report.items.filter(item => item.type === type) }));
  const priorityItems = [...report.items].sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority]).slice(0, 3);
  const itemCards = grouped.map((group, groupIndex) => `<details id="assessment-${group.type}" class="assessment-group ${group.type}" ${groupIndex === 0 ? "open" : ""}><summary class="assessment-group-head"><span>${icon(typeMeta[group.type].icon)}</span><div><h2>${typeMeta[group.type].label}</h2><p>${typeMeta[group.type].description}</p></div><b>${group.items.length}</b><i class="ph ph-caret-down" aria-hidden="true"></i></summary><div class="assessment-items">${group.items.length ? group.items.map((item, index) => assessmentItemCard(item, index, priorityLabels)).join("") : '<div class="assessment-none">本轮没有足够证据支持的该类建议</div>'}</div></details>`).join("");
  const roadmap = report.roadmap.map((phase, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(phase.phase)}</small><h3>${escapeHtml(phase.objective)}</h3><ul>${phase.actions.map(action => `<li>${escapeHtml(action)}</li>`).join("")}</ul></div></article>`).join("");
  const priorities = priorityItems.map((item, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(typeMeta[item.type]?.label || item.type)} · ${escapeHtml(item.dimension)}</small><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.recommendation)}</p></div></article>`).join("");
  const completedStages = protocol?.stages?.filter(stage => stage.status === "completed").length || 0;
  const protocolScore = protocol ? `${completedStages}/${protocol.stages.length}` : coverage ? `${coverage.checked}/${coverage.total}` : "待复核";
  const protocolNote = protocol
    ? `${protocol.source?.files || 0} 个文件 · ${protocol.source?.attachments || 0} 个嵌入附件 · ${protocol.source?.omittedEntries || 0} 条省略`
    : coverage?.complete ? "已返回全部检查维度（旧版结果）" : "旧版结果未记录三阶段审查";
  return `<section class="assessment-panel"><label class="assessment-compact-switch"><span>切换分析视图</span><select id="assessment-module-filter"><option value="all">全部问题</option>${[...state.selectedModules].map(id => `<option value="${id}" ${id === "assessment" ? "selected" : ""}>${escapeHtml(moduleLabels[id] || id)}${id === "assessment" ? "（报告）" : `（${state.run.issues.filter(issue => issue.module === id).length}）`}</option>`).join("")}</select></label><header class="assessment-hero"><div><span class="panel-kicker">IMPROVEMENT ASSESSMENT</span><h1>整份报告改进评估</h1><p>${escapeHtml(report.executiveSummary)}</p></div><div class="assessment-scoreboard"><div class="assessment-rating"><span>整体成熟度</span><strong>${escapeHtml(report.overallRating)}</strong><small>${report.items.length} 项改进方向</small></div><div class="assessment-rating coverage ${protocol?.complete ? "complete" : "incomplete"}"><span>${protocol ? "三阶段深度审查" : "固定清单覆盖"}</span><strong>${escapeHtml(protocolScore)}</strong><small>${escapeHtml(protocolNote)}</small></div></div></header><nav class="assessment-reading-nav" aria-label="评估报告阅读顺序"><span>建议阅读顺序</span><a href="#assessment-priorities">先看优先事项</a><a href="#assessment-incomplete">再看不完整</a><a href="#assessment-optimize">然后看可优化</a><a href="#assessment-deepen">最后看可深化</a></nav><section id="assessment-priorities" class="assessment-priorities"><div class="assessment-section-title"><span>${icon("ph-list-numbers")}</span><div><h2>先做这三件事</h2><p>按依赖和实施优先级排序，不必先读完整份报告</p></div></div><div class="priority-list">${priorities}</div></section><details class="assessment-strengths"><summary><span>${icon("ph-seal-check")}</span><div><h2>已有基础</h2><p>已形成 ${report.strengths.length} 项可保留的方法和管理基础</p></div><b>展开查看</b></summary><ul>${report.strengths.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details><div class="assessment-lens-summary">${grouped.map(group => `<a href="#assessment-${group.type}" class="${group.type}"><span>${typeMeta[group.type].label}</span><b>${group.items.length}</b><small>${typeMeta[group.type].description}</small></a>`).join("")}</div><div class="assessment-all-head"><span class="panel-kicker">FULL REVIEW</span><h2>全部评估建议</h2><p>每条按“事实 → 缺口 → 专业判断 → 执行闭环 → 落地步骤 → 结论边界”组织。</p></div>${itemCards}<section class="assessment-roadmap"><div class="assessment-section-title"><span>${icon("ph-path")}</span><div><h2>改进路线图</h2><p>按照依赖关系分阶段推进，不要求一次性全部重写</p></div></div><div class="roadmap-list">${roadmap}</div></section></section>`;
}

function detailPanel() {
  const issue = selectedIssue();
  if (!issue) return `<aside class="detail-panel ${state.detailDrawerOpen ? "mobile-open" : ""}"><div class="empty">请选择一个问题</div></aside>`;
  state.selectedIssueId = issue.id;
  const inference = { fact: "直接事实", confirmable_omission: "可确认缺口", risk_inference: "风险推断" }[issue.inferenceLevel] || "直接事实";
  const isImprovement = issue.findingType === "improvement";
  const isCrossDocument = new Set(issue.evidence.map(item => item.fileId || item.fileName)).size > 1;
  const sourceActionLabel = isCrossDocument ? "原文对照" : "原文定位";
  const issueStatus = issueStatusLabels[issue.status] || "待处理";
  const writing = issue.module === "writing" ? `<div class="rewrite-box"><div class="rewrite-label">原文</div><div class="rewrite-text">${escapeHtml(issue.originalText || issue.evidence?.[0]?.quote || "")}</div><div class="rewrite-label">候选版本（可直接修改后采用）</div><textarea id="rewrite-final">${escapeHtml(issue.suggestedText || "")}</textarea><div class="tiny muted rewrite-reason">${escapeHtml(issue.rewriteReason || "默认采用轻度自然化，不改变原意。")}</div><div class="rewrite-label">追加要求</div><input id="rewrite-instruction" placeholder="例如：再简洁一点，但保留正式语气" /><div class="detail-actions"><button class="btn" data-action="rewrite-issue" ${state.rewriting ? "disabled" : ""}>${icon("ph-arrows-clockwise")}${state.rewriting ? "正在生成…" : "重新生成"}</button><button class="btn primary" data-action="accept-writing" ${issue.suggestedText ? "" : "disabled"}>${icon("ph-check")}采用并记住风格</button></div></div>` : "";
  const sentenceReview = issue.module === "sentence" ? `<section class="sentence-review-box"><div class="sentence-review-step original"><span>01</span><div><strong>原句</strong><p class="sentence-review-text">${escapeHtml(issue.originalText || issue.evidence?.[0]?.quote || "")}</p></div></div><div class="sentence-review-step suggestion"><span>02</span><div><strong>建议改法</strong><p class="sentence-review-text">${escapeHtml(issue.suggestedText || "本条需要业务确认，暂不自动改写。")}</p></div></div><div class="sentence-review-step reason"><span>03</span><div><strong>修改理由</strong><p>${escapeHtml(issue.rewriteReason || issue.basis || "")}</p></div></div></section>` : "";
  const mapping = issue.mapping ? `<div class="mapping-box"><div class="mapping-head"><div><strong>确认字段对应</strong><div class="tiny muted">文档字段：${escapeHtml(issue.mapping.label)}</div></div><span class="tag">${issue.mapping.status === "confirmed" ? "已确认" : issue.mapping.status === "rejected" ? "已排除" : "待选择"}</span></div>${issue.mapping.status === "unconfirmed" ? `<div class="mapping-candidates">${issue.mapping.candidates.map(candidate => `<button data-mapping-candidate="${escapeHtml(candidate.id)}"><span><strong>${escapeHtml(candidate.label)}</strong><small>${escapeHtml(candidate.fileName)} · ${escapeHtml(candidate.sheet)}!${escapeHtml(candidate.valueAddress)}</small></span><b>${escapeHtml(candidate.value)}</b><em>匹配 ${Math.round((candidate.score || 0) * 100)}%</em></button>`).join("")}<button class="mapping-none" data-mapping-candidate="none"><span><strong>都不是</strong><small>排除当前所有候选</small></span></button></div>` : `<p class="tiny muted">选择结果已写入项目映射库，后续分析会直接复用。</p>`}</div>` : "";
  const evidenceCards = issue.evidence.map((item, index) => `<article class="evidence-card"><div class="evidence-meta"><span>证据 ${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(evidenceLocation(item))}</span></div><strong class="evidence-file">${escapeHtml(item.fileName)}</strong><div class="evidence-quote">${escapeHtml(item.quote)}</div></article>`).join("");
  const overview = `<div class="detail-body"><section class="insight-block"><div class="insight-label">${isImprovement ? "改进建议" : "审查结论"}</div><p class="issue-conclusion">${escapeHtml(issue.summary)}</p></section>${mapping}${writing}${sentenceReview}<section class="insight-block"><div class="insight-label">判断依据</div><div class="fact-strip ${isImprovement ? "improvement" : ""}">${escapeHtml(issue.basis)}</div></section><section class="insight-block"><div class="insight-label">${isImprovement ? "预期收益" : "可能影响"}</div><p>${escapeHtml(issue.impact)}</p></section><section class="evidence-preview"><div class="section-line"><span>关键证据</span><button data-detail-tab="evidence">查看全部 ${issue.evidence.length} 处</button></div>${issue.evidence[0] ? `<article class="evidence-card compact"><strong class="evidence-file">${escapeHtml(issue.evidence[0].fileName)}</strong><div class="evidence-meta"><span>${escapeHtml(evidenceLocation(issue.evidence[0]))}</span></div><div class="evidence-quote">${escapeHtml(issue.evidence[0].quote)}</div></article>` : ""}</section></div>`;
  const evidence = `<div class="detail-body"><div class="evidence-intro"><span>${icon("ph-quotes")}</span><div><strong>${issue.evidence.length} 处原文证据</strong><p>${isCrossDocument ? "点击下方“原文对照”进入并排核验模式。" : "点击下方“原文定位”进入单文档独立评估视图。"}</p></div></div>${evidenceCards}</div>`;
  const activity = `<div class="detail-body"><div class="activity-stream"><article><span class="activity-dot current"></span><div><strong>${escapeHtml(issueStatus)}</strong><p>当前处理状态</p></div></article><article><span class="activity-dot"></span><div><strong>AI 完成识别</strong><p>${escapeHtml(inference)} · 置信度 ${Math.round(issue.confidence * 100)}%</p></div></article><article><span class="activity-dot"></span><div><strong>证据已定位</strong><p>已关联 ${issue.evidence.length} 处来源位置</p></div></article></div></div>`;
  const tabContent = state.detailTab === "evidence" ? evidence : state.detailTab === "activity" ? activity : overview;
  return `<aside class="detail-panel ${state.detailDrawerOpen ? "mobile-open" : ""}"><div class="detail-head"><div class="detail-kicker"><span>INSPECTOR</span><span class="detail-kicker-actions"><span class="status-label ${issue.status}">${escapeHtml(issueStatus)}</span><button class="mobile-detail-close" data-action="close-detail-drawer" aria-label="关闭问题详情">${icon("ph-x")}</button></span></div><div class="detail-tags"><span class="tag ${issue.severity}">${severityLabels[issue.severity]}影响</span>${findingTag(issue)}<span class="tag">${escapeHtml(moduleLabels[issue.module] || issue.module)}</span></div><h2>${escapeHtml(issue.title)}</h2><div class="confidence-line"><span>${escapeHtml(isImprovement ? "模型建议" : inference)}</span><span class="confidence-track"><i style="width:${Math.round(issue.confidence * 100)}%"></i></span><b>${Math.round(issue.confidence * 100)}%</b></div></div><div class="detail-tabs"><button class="${state.detailTab === "overview" ? "active" : ""}" data-detail-tab="overview">${isImprovement ? "建议" : "结论"}</button><button class="${state.detailTab === "evidence" ? "active" : ""}" data-detail-tab="evidence">证据 <b>${issue.evidence.length}</b></button><button class="${state.detailTab === "activity" ? "active" : ""}" data-detail-tab="activity">处理记录</button></div>${tabContent}<div class="decision-bar"><button class="btn primary" data-action="open-evidence">${icon("ph-arrow-square-out")} ${sourceActionLabel}</button><button class="btn icon-only" data-status="ignored" title="标记忽略" aria-label="标记忽略">${icon("ph-eye-slash")}</button>${issue.module !== "writing" ? `<button class="btn resolve" data-status="resolved">${icon("ph-check-circle")} 已解决</button>` : ""}${issue.status !== "open" ? `<button class="btn" data-status="open">恢复待处理</button>` : ""}</div></aside>`;
}

function workbenchView() {
  return `${topbar()}<main class="workbench ${state.moduleFilter === "assessment" ? "assessment-mode" : ""}">${navRail("issues")}${leftPanel()}${state.moduleFilter === "assessment" ? assessmentPanel() : `${issuesPanel()}${detailPanel()}`}</main>`;
}

function runOverlay() {
  const run = state.run;
  if (!run || !["queued", "running"].includes(run.status)) return "";
  return `<div class="run-overlay"><div class="run-card"><span class="run-icon">${icon("ph-sparkle")}</span><span class="panel-kicker">ANALYSIS IN PROGRESS</span><h2>${escapeHtml(run.stage || "分析中")}</h2><p class="muted">本地解析负责精确证据，Codex 负责语义判断；原文件不会被修改。</p><div class="progress-track"><div class="progress-fill" style="width:${run.progress || 0}%"></div></div><div class="run-progress"><span>正在处理任务材料</span><strong>${run.progress || 0}%</strong></div></div></div>`;
}

function evidenceView() {
  const issue = selectedIssue();
  if (state.view !== "evidence" || !issue) return "";
  const cards = issue.evidence;
  const crossDocumentEvidence = new Set(cards.map(item => item.fileId || item.fileName)).size > 1;
  const singleDocument = cards[0]?.fileName || "原文材料";
  const comparison = `<div class="evidence-canvas">${cards.slice(0, 2).map((item, index) => `<article class="document-sheet"><div class="document-title"><span class="document-badge">${String(index + 1).padStart(2, "0")}</span><span class="document-name">${escapeHtml(item.fileName)}</span><span class="muted tiny">${escapeHtml(evidenceLocation(item))}</span></div><div class="document-toolbar"><span>${icon("ph-file-text")}原文定位</span><span>只读快照</span></div><div class="document-page"><p class="page-label">${escapeHtml(evidenceLocation(item))}</p><mark>${escapeHtml(item.quote)}</mark></div></article>`).join("")}<div class="evidence-link"><span></span><b>差异</b><span></span></div></div>`;
  const assessment = `<div class="evidence-canvas single-source"><article class="document-sheet single-source-sheet"><div class="document-title"><span class="document-badge">01</span><span class="document-name">${escapeHtml(singleDocument)}</span><span class="muted tiny">${cards.length} 处定位</span></div><div class="document-toolbar"><span>${icon("ph-file-text")}原文定位</span><span>只读快照</span></div><div class="document-page single-source-page">${cards.map((item, index) => `<section><p class="page-label">证据 ${String(index + 1).padStart(2, "0")} · ${escapeHtml(evidenceLocation(item))}</p><mark>${escapeHtml(item.quote)}</mark></section>`).join("")}</div></article></div>`;
  const summaryCard = `<section class="evidence-summary-card"><header><span class="summary-eyebrow">${icon("ph-note-pencil")} 问题总结</span><h2>${escapeHtml(issue.title)}</h2></header><div class="evidence-summary-grid"><div class="primary"><span>核心判断</span><p>${escapeHtml(issue.summary)}</p></div><div><span>判断依据</span><p>${escapeHtml(issue.basis)}</p></div><div><span>${issue.findingType === "improvement" ? "预期收益" : "可能影响"}</span><p>${escapeHtml(issue.impact)}</p></div></div></section>`;
  return `<section class="evidence-view"><div class="evidence-toolbar"><button class="btn small" data-action="close-evidence">${icon("ph-arrow-left")} 返回问题</button><span class="toolbar-divider"></span><span class="tag ${issue.severity}">${severityLabels[issue.severity]}影响</span><strong>${escapeHtml(issue.title)}</strong><span class="grow"></span><span class="evidence-mode">${icon(crossDocumentEvidence ? "ph-columns" : "ph-file-search")} ${crossDocumentEvidence ? "跨文档对比" : "独立评估"}</span><span class="tiny muted">${issue.evidence.length} 条直接证据</span></div><div class="evidence-stage">${summaryCard}${crossDocumentEvidence ? comparison : assessment}</div></section>`;
}

function fileStatistics(preview) {
  const statistics = preview?.forensic?.statistics || preview?.file?.parse?.forensic?.statistics || {};
  const labels = {
    paragraphs: "段落", tables: "表格", comments: "批注", insertions: "修订新增",
    deletions: "修订删除", embeddedFiles: "嵌入文件", sheets: "工作表", hiddenSheets: "隐藏工作表",
    nonEmptyCells: "非空单元格", formulas: "公式",
  };
  return Object.entries(statistics).filter(([, value]) => typeof value === "number").map(([key, value]) => `<div><span>${escapeHtml(labels[key] || key)}</span><b>${value}</b></div>`).join("");
}

function filePreviewView() {
  if (!state.filePreview && !state.filePreviewLoading) return "";
  if (state.filePreviewLoading) return `<section class="file-preview-view"><div class="preview-loading"><span class="run-icon">${icon("ph-file-search")}</span><strong>正在打开材料内容</strong><small>读取本地解析结果，不会修改原文件</small></div></section>`;
  const preview = state.filePreview;
  const file = preview.file;
  const type = iconType(file);
  const fileIcon = type === "xls" ? "ph-file-xls" : type === "pdf" ? "ph-file-pdf" : "ph-file-doc";
  const kind = String(preview.forensic?.kind || file.parse?.forensic?.kind || file.extension?.replace(".", "") || "file").toUpperCase();
  const content = state.filePreviewTab === "details"
    ? `<div class="preview-details"><section><h3>解析概况</h3><div class="preview-stat-grid">${fileStatistics(preview) || '<div><span>解析状态</span><b>已完成</b></div>'}</div></section><section><h3>快照信息</h3><dl><div><dt>文件角色</dt><dd>${escapeHtml(roleLabels[file.role] || "附件")}</dd></div><div><dt>文件大小</dt><dd>${formatSize(file.size || 0)}</dd></div><div><dt>快照时间</dt><dd>${escapeHtml(file.snapshotCreatedAt ? new Date(file.snapshotCreatedAt).toLocaleString("zh-CN") : "-")}</dd></div><div><dt>内容哈希</dt><dd class="hash-value">${escapeHtml(file.sha256 || "-")}</dd></div><div><dt>快速解析器</dt><dd>${escapeHtml(file.parse?.quick?.parser || "-")}</dd></div><div><dt>证据解析器</dt><dd>${escapeHtml(file.parse?.forensic?.parser || "-")}</dd></div></dl></section></div>`
    : `<article class="preview-paper">${renderPreviewMarkdown(preview.markdown)}</article>`;
  return `<section class="file-preview-view"><div class="preview-toolbar"><button class="btn small" data-action="close-file-preview">${icon("ph-arrow-left")} 返回问题工作台</button><span class="toolbar-divider"></span><span class="tag">${escapeHtml(kind)}</span><strong>${escapeHtml(file.name)}</strong><span class="grow"></span><span class="evidence-mode">${icon("ph-lock-key")} 只读快照</span></div><div class="preview-layout"><aside class="preview-sidebar"><span class="preview-file-icon ${type}">${icon(fileIcon)}</span><span class="panel-kicker">SOURCE FILE</span><h2>${escapeHtml(file.name)}</h2><p>${escapeHtml(roleLabels[file.role] || "附件")} · ${formatSize(file.size || 0)}</p><div class="preview-stat-grid compact">${fileStatistics(preview)}</div></aside><main class="preview-main"><div class="preview-tabs"><button class="${state.filePreviewTab === "content" ? "active" : ""}" data-preview-tab="content">${icon("ph-file-text")} 内容预览</button><button class="${state.filePreviewTab === "details" ? "active" : ""}" data-preview-tab="details">${icon("ph-info")} 解析信息</button></div><div class="preview-scroll">${content}</div></main></div></section>`;
}

function render() {
  if (state.project) {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('project') !== state.project.id) {
      currentUrl.searchParams.set('project', state.project.id);
      currentUrl.searchParams.delete('mode');
      currentUrl.searchParams.delete('setup');
      history.replaceState({}, '', currentUrl);
    }
  }
  const scrollPositions = captureScrollPositions(app);
  app.innerHTML = state.view === "setup" || !state.project || !state.run?.issues ? setupView() : workbenchView();
  app.insertAdjacentHTML("beforeend", runOverlay() + evidenceView() + filePreviewView());
  bind();
  restoreScrollPositions(app, scrollPositions);
}

function recommendModules(files) {
  state.selectedModules = new Set(recommendAnalysisModules(files));
}

async function ensureProject() {
  if (state.project) return state.project;
  const name = document.querySelector("#project-name")?.value?.trim() || "未命名审查任务";
  const payload = await api.post("/api/projects", { name });
  state.project = payload.project;
  state.projects.unshift(payload.project);
  return state.project;
}

async function createNewTask() {
  if (state.project?.id && state.run?.status === "completed") state.returnProjectId = state.project.id;
  const payload = await api.post("/api/projects", { name: "未命名审查任务" });
  state.project = payload.project;
  state.projects = [payload.project, ...state.projects.filter(project => project.id !== payload.project.id)];
  state.run = null;
  state.view = "setup";
  state.moduleFilter = "all";
  state.dataFilter = "all";
  state.statusFilter = "open";
  state.severityFilter = "all";
  state.searchQuery = "";
  state.detailTab = "overview";
  state.detailDrawerOpen = false;
  state.filePreview = null;
  state.filePreviewLoading = false;
  state.selectedModules = new Set(["conflict", "logic", "data", "proofread", "open"]);
  render();
  showToast("新任务已创建，请导入本次审查材料；原任务结果仍然保留");
}

async function activateProject(projectId, preferIssues = true) {
  const payload = await api.get(`/api/projects/${projectId}`);
  state.project = payload.project;
  state.run = payload.run;
  state.returnProjectId = payload.project.id;
  state.moduleFilter = "all";
  state.dataFilter = "all";
  state.statusFilter = "open";
  state.severityFilter = "all";
  state.searchQuery = "";
  state.detailTab = "overview";
  state.detailDrawerOpen = false;
  state.filePreview = null;
  state.filePreviewLoading = false;
  state.selectedModules = new Set(payload.project.selectedModules || []);
  state.view = preferIssues && payload.run?.status === "completed" ? "issues" : "setup";
  state.selectedIssueId = payload.run?.issues?.[0]?.id || null;
  render();
}

async function returnToWorkbench() {
  if (state.project?.id && state.run?.status === "completed") {
    state.returnProjectId = state.project.id;
    state.view = "issues";
    render();
    return;
  }
  const projectId = state.returnProjectId || state.projects[0]?.id;
  if (!projectId) {
    showToast("还没有可返回的审查结果");
    return;
  }
  await activateProject(projectId, true);
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  recommendModules(files);
  await ensureProject();
  state.upload = { active: true, done: 0, total: files.length };
  const inferredRoles = inferUploadRoles(files, state.project.files);
  render();
  for (const [fileIndex, file] of files.entries()) {
    try {
      const result = await api.request(`/api/projects/${state.project.id}/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Role": inferredRoles[fileIndex],
          "X-Source-Last-Modified": new Date(file.lastModified).toISOString(),
        },
        body: file,
      });
      state.project = result.project;
    } catch (error) {
      showToast(`${file.name} 导入失败：${error.message}`);
    }
    state.upload.done += 1;
    render();
  }
  state.upload.active = false;
  render();
  showToast("文件快照和解析完成");
}

async function startAnalysis() {
  if (!state.project) return;
  const provider = document.querySelector("#provider")?.value || "auto";
  const result = await api.post(`/api/projects/${state.project.id}/analyze`, { modules: [...state.selectedModules], provider });
  state.run = result.run;
  render();
  await pollRun();
}

async function pollRun() {
  while (["queued", "running"].includes(state.run?.status)) {
    await new Promise(resolve => setTimeout(resolve, 700));
    const payload = await api.get(`/api/projects/${state.project.id}/runs/${state.run.id}`);
    state.run = payload.run;
    render();
  }
  if (state.run.status === "completed") {
    state.returnProjectId = state.project.id;
    state.view = "issues";
    state.selectedIssueId = state.run.issues[0]?.id || null;
    render();
    showToast(`分析完成，共发现 ${state.run.issues.length} 条问题`);
  } else {
    render();
    showToast("分析未完成，请查看错误提示");
  }
}

async function updateIssueStatus(status) {
  const issue = selectedIssue();
  if (!issue) return;
  const result = await api.patch(`/api/projects/${state.project.id}/runs/${state.run.id}/issues/${issue.id}`, { status });
  state.run = result.run;
  state.selectedIssueId = filteredIssues()[0]?.id || state.run.issues[0]?.id || null;
  render();
}

async function rewriteIssue() {
  const issue = selectedIssue();
  if (!issue || issue.module !== "writing") return;
  const instruction = document.querySelector("#rewrite-instruction")?.value || "";
  state.rewriting = true;
  render();
  try {
    const result = await api.post(`/api/projects/${state.project.id}/runs/${state.run.id}/issues/${issue.id}/rewrite`, { instruction });
    state.run = result.run;
    showToast("已生成新的候选版本");
  } finally {
    state.rewriting = false;
    render();
  }
}

async function acceptWriting() {
  const issue = selectedIssue();
  if (!issue || issue.module !== "writing") return;
  const finalText = document.querySelector("#rewrite-final")?.value || issue.suggestedText || "";
  const instruction = document.querySelector("#rewrite-instruction")?.value || "";
  const result = await api.post(`/api/projects/${state.project.id}/runs/${state.run.id}/issues/${issue.id}/accept`, { finalText, instruction });
  state.run = result.run;
  showToast(`已采用；个人风格库现有 ${result.profile.examples.length} 条样例`);
  render();
}

async function confirmMapping(candidateId) {
  const issue = selectedIssue();
  if (!issue?.mapping) return;
  const result = await api.post(`/api/projects/${state.project.id}/runs/${state.run.id}/issues/${issue.id}/mapping`, { candidateId });
  state.project = result.project;
  state.run = result.run;
  showToast(candidateId === "none" ? "已排除当前候选" : "已确认字段并重算结果");
  render();
}

async function openFilePreview(fileId) {
  if (!state.project?.id || !fileId) return;
  state.filePreviewLoading = true;
  state.filePreview = null;
  state.filePreviewTab = "content";
  render();
  try {
    state.filePreview = await api.get(`/api/projects/${state.project.id}/files/${fileId}`);
  } finally {
    state.filePreviewLoading = false;
    render();
  }
}

function bind() {
  const projectName = document.querySelector("#project-name");
  if (projectName && state.project) projectName.addEventListener("change", async () => {
    try {
      const result = await api.patch(`/api/projects/${state.project.id}`, { name: projectName.value });
      state.project = result.project;
      state.projects = state.projects.map(project => project.id === result.project.id ? { ...project, name: result.project.name } : project);
      showToast("任务名称已保存");
      render();
    } catch (error) { showToast(error.message); projectName.value = state.project.name; }
  });
  document.querySelectorAll("[data-file-role]").forEach(select => select.addEventListener("change", async () => {
    try {
      const result = await api.patch(`/api/projects/${state.project.id}/files/${select.dataset.fileRole}`, { role: select.value });
      state.project = result.project;
      showToast("文档角色已更新");
    } catch (error) { showToast(error.message); render(); }
  }));
  const projectSelector = document.querySelector("#project-selector");
  if (projectSelector) projectSelector.addEventListener("change", async () => {
    if (!projectSelector.value) {
      try { await createNewTask(); } catch (error) { showToast(error.message); }
      return;
    }
    try {
      await activateProject(projectSelector.value, true);
    } catch (error) { showToast(error.message); }
  });
  document.querySelectorAll("[data-module]").forEach(input => input.addEventListener("change", event => {
    if (event.currentTarget.checked) state.selectedModules.add(event.currentTarget.dataset.module);
    else state.selectedModules.delete(event.currentTarget.dataset.module);
    render();
  }));
  document.querySelectorAll("[data-issue]").forEach(row => row.addEventListener("click", () => { state.selectedIssueId = row.dataset.issue; state.detailTab = "overview"; state.detailDrawerOpen = true; render(); }));
  document.querySelectorAll("[data-preview-file]").forEach(button => button.addEventListener("click", () => openFilePreview(button.dataset.previewFile).catch(error => { state.filePreviewLoading = false; state.filePreview = null; render(); showToast(error.message); })));
  document.querySelectorAll("[data-preview-tab]").forEach(button => button.addEventListener("click", () => { state.filePreviewTab = button.dataset.previewTab; render(); }));
  document.querySelectorAll("[data-detail-tab]").forEach(button => button.addEventListener("click", () => { state.detailTab = button.dataset.detailTab; render(); }));
  const issueSearch = document.querySelector("#issue-search");
  if (issueSearch) issueSearch.addEventListener("input", event => {
    state.searchQuery = event.currentTarget.value;
    state.selectedIssueId = null;
    const cursor = event.currentTarget.selectionStart;
    render();
    const next = document.querySelector("#issue-search");
    if (next) { next.focus(); next.setSelectionRange(cursor, cursor); }
  });
  document.querySelectorAll("#mobile-module-filter, #assessment-module-filter").forEach(select => select.addEventListener("change", event => { state.moduleFilter = event.currentTarget.value; state.dataFilter = "all"; state.selectedIssueId = null; render(); }));
  document.querySelectorAll("[data-status-filter]").forEach(button => button.addEventListener("click", () => { state.statusFilter = button.dataset.statusFilter; state.selectedIssueId = null; render(); }));
  document.querySelectorAll("[data-severity-filter]").forEach(button => button.addEventListener("click", () => { state.severityFilter = button.dataset.severityFilter; state.selectedIssueId = null; render(); }));
  document.querySelectorAll("[data-module-filter]").forEach(button => button.addEventListener("click", () => { state.moduleFilter = button.dataset.moduleFilter; state.dataFilter = "all"; state.selectedIssueId = null; render(); }));
  document.querySelectorAll("[data-data-filter]").forEach(button => button.addEventListener("click", () => { state.dataFilter = button.dataset.dataFilter; state.selectedIssueId = null; render(); }));
  document.querySelectorAll("[data-status]").forEach(button => button.addEventListener("click", () => updateIssueStatus(button.dataset.status).catch(error => showToast(error.message))));
  document.querySelectorAll("[data-mapping-candidate]").forEach(button => button.addEventListener("click", () => confirmMapping(button.dataset.mappingCandidate).catch(error => showToast(error.message))));
  document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", async event => {
    const action = event.currentTarget.dataset.action;
    try {
      if (action === "pick-files") fileInput.click();
      if (action === "select-all") { state.selectedModules = new Set(state.modules.map(module => module.id)); render(); }
      if (action === "start-analysis") await startAnalysis();
      if (action === "new-project") await createNewTask();
      if (action === "go-home") await returnToWorkbench();
      if (action === "back-setup") { state.view = "setup"; state.detailDrawerOpen = false; render(); }
      if (action === "close-detail-drawer") { state.detailDrawerOpen = false; render(); }
      if (action === "swap-version") {
        const result = await api.post(`/api/projects/${state.project.id}/version-swap`, {});
        state.project = result.project;
        showToast("已调换基准版和当前版");
        render();
      }
      if (action === "open-evidence") { state.view = "evidence"; render(); }
      if (action === "close-evidence") { state.view = "issues"; render(); }
      if (action === "close-file-preview") { state.filePreview = null; state.filePreviewLoading = false; render(); }
      if (action === "export-html") window.location.href = `/api/projects/${state.project.id}/export?format=html`;
      if (action === "export-xlsx") window.location.href = `/api/projects/${state.project.id}/export?format=xlsx`;
      if (action === "rewrite-issue") await rewriteIssue();
      if (action === "accept-writing") await acceptWriting();
    } catch (error) { showToast(error.message); }
  }));
  const zone = document.querySelector(".dropzone");
  if (zone) {
    zone.addEventListener("dragover", event => { event.preventDefault(); zone.classList.add("dragging"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
    zone.addEventListener("drop", event => { event.preventDefault(); zone.classList.remove("dragging"); uploadFiles(event.dataTransfer.files); });
  }
}

fileInput.addEventListener("change", () => { uploadFiles(fileInput.files); fileInput.value = ""; });

async function initialize() {
  try {
    const [health, modulePayload, providerPayload, projectPayload] = await Promise.all([api.get("/api/health"), api.get("/api/modules"), api.get("/api/providers"), api.get("/api/projects")]);
    state.health = health;
    state.modules = modulePayload.modules;
    state.providers = providerPayload.providers;
    state.projects = projectPayload.projects;
    const entryParams = new URLSearchParams(window.location.search);
    const requestedProjectId = entryParams.get('project');
    const current = requestedProjectId ? state.projects.find(project => project.id === requestedProjectId) : state.projects[0];
    if (current) {
      const payload = await api.get(`/api/projects/${current.id}`);
      state.project = payload.project;
      state.run = payload.run;
      state.returnProjectId = payload.project.id;
      state.selectedModules = new Set(payload.project.selectedModules || []);
      if (payload.run?.status === "completed") {
        state.view = "issues";
        state.selectedIssueId = payload.run.issues[0]?.id || null;
      }
      if (entryParams.get('setup') === '1' || entryParams.get('mode') === 'version') state.view = 'setup';
      if (entryParams.get('mode') === 'version') state.selectedModules = new Set(['version']);
    }
    render();
    if (["queued", "running"].includes(state.run?.status)) pollRun();
  } catch (error) {
    app.innerHTML = `<div class="empty"><h2>工作台启动失败</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

initialize();
