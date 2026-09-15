import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { executeAnalysisRun, createAnalysisRun, loadRun, saveRun } from "./analysis.mjs";
import { listSemanticProviders, rewriteWithProvider } from "./providers/index.mjs";
import { issuesToCsv, issuesToHtml } from "./export.mjs";
import { exportIssuesWorkbook } from "./xlsx-export.mjs";
import { MODULES } from "./issues.mjs";
import { extractSnapshot, loadExtractedFile } from "./parsers.mjs";
import {
  createProject,
  dataRoot,
  ensureStorage,
  fileMetadata,
  hashFile,
  loadProject,
  nextSnapshotPath,
  projectDir,
  readJson,
  saveProject,
} from "./storage.mjs";
import { resolveRuntime } from "./runtime.mjs";
import { loadStyleProfile, rememberAcceptedStyleExample } from "./style.mjs";
import { applyMappingChoice } from "./mappings.mjs";
import { handleWorkApi } from "./work-api.mjs";

const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const staticRoot = join(sourceRoot, "app");
const port = Number(process.env.WORKBENCH_PORT || 4180);
const jobs = new Map();
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  response.end(body);
}

function sendText(response, status, value, type = "text/plain; charset=utf-8", headers = {}) {
  const body = Buffer.from(String(value));
  response.writeHead(status, { "Content-Type": type, "Content-Length": body.length, ...headers });
  response.end(body);
}

async function readBody(request, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readBody(request);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

async function listProjects() {
  await ensureStorage();
  const entries = await readdir(join(dataRoot, "projects"), { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = await readJson(join(dataRoot, "projects", entry.name, "project.json"));
    if (project) projects.push(project);
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function recoverInterruptedRuns() {
  const projects = await listProjects();
  for (const project of projects) {
    if (!project.latestRunId) continue;
    const run = await loadRun(project.id, project.latestRunId).catch(() => null);
    if (!run || !["queued", "running"].includes(run.status)) continue;
    run.status = "failed";
    run.stage = "服务重启后已中止";
    run.error = "上一次分析执行期间本地服务被中断，请重新开始分析。";
    run.warnings = [...(run.warnings || []), "上一次运行被本地服务重启中断，文件快照和解析结果仍然保留。"];
    await saveRun(run);
  }
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "workspace.html" : pathname === "/review.html" ? "index.html" : pathname.slice(1);
  const target = normalize(join(staticRoot, requested));
  if (!target.startsWith(staticRoot)) return false;
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    response.writeHead(200, { "Content-Type": contentTypes[extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(target).pipe(response);
    return true;
  } catch {
    return false;
  }
}

function startJob(run) {
  const promise = executeAnalysisRun(run).finally(() => jobs.delete(run.id));
  jobs.set(run.id, promise);
}

async function handleApi(request, response, url) {
  if (await handleWorkApi(request, response, url, { sendJson, readJsonBody })) return true;
  if (request.method === "GET" && url.pathname === "/api/health") {
    const runtime = await resolveRuntime();
    let codexAvailable = true;
    let spreadsheetExportAvailable = true;
    try { await access(runtime.codex); } catch { codexAvailable = false; }
    try { await access(runtime.nodeModules); } catch { spreadsheetExportAvailable = false; }
    sendJson(response, 200, { ok: true, version: "0.2.0", dataRoot, providers: { anydoc: true, auditExtractor: true, codexLocal: codexAvailable, deterministic: true, spreadsheetExport: spreadsheetExportAvailable } });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/modules") {
    sendJson(response, 200, { modules: MODULES });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/providers") {
    const semantic = await listSemanticProviders();
    sendJson(response, 200, {
      providers: [
        { id: "auto", label: "自动选择", available: semantic.some(item => item.available), capabilities: { analysis: true, rewrite: true, assessment: true } },
        ...semantic,
        { id: "deterministic", label: "仅确定性核验", available: true, capabilities: { analysis: true, rewrite: false, assessment: false } },
      ],
    });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/style") {
    sendJson(response, 200, { profile: await loadStyleProfile() });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/projects") {
    sendJson(response, 200, { projects: await listProjects() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/projects") {
    const body = await readJsonBody(request);
    sendJson(response, 201, { project: await createProject(body.name) });
    return true;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
  if (request.method === "GET" && projectMatch) {
    const project = await loadProject(projectMatch[1]);
    const run = project.latestRunId ? await loadRun(project.id, project.latestRunId).catch(() => null) : null;
    sendJson(response, 200, { project, run });
    return true;
  }
  if (request.method === "PATCH" && projectMatch) {
    const body = await readJsonBody(request);
    const project = await loadProject(projectMatch[1]);
    const name = String(body.name || "").trim().slice(0, 100);
    if (!name) throw Object.assign(new Error("任务名称不能为空"), { statusCode: 400 });
    project.name = name;
    await saveProject(project);
    sendJson(response, 200, { project });
    return true;
  }

  const uploadMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/files$/);
  if (request.method === "POST" && uploadMatch) {
    const project = await loadProject(uploadMatch[1]);
    const encodedName = request.headers["x-file-name"] || url.searchParams.get("filename") || "file";
    let originalName;
    try { originalName = decodeURIComponent(String(encodedName)); } catch { originalName = String(encodedName); }
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > 150 * 1024 * 1024) throw Object.assign(new Error("单个文件不能超过150MB"), { statusCode: 413 });
    const snapshot = await nextSnapshotPath(project.id, originalName);
    await mkdir(resolve(snapshot.path, ".."), { recursive: true });
    try {
      await pipeline(request, createWriteStream(snapshot.path, { flags: "wx" }));
      const meta = await fileMetadata(snapshot.path);
      const record = {
        id: snapshot.fileId,
        name: snapshot.displayName,
        storedName: snapshot.storedName,
        extension: extname(snapshot.displayName).toLowerCase(),
        size: meta.size,
        sha256: await hashFile(snapshot.path),
        role: String(request.headers["x-file-role"] || "attachment"),
        sourceLastModified: request.headers["x-source-last-modified"] || null,
        snapshotCreatedAt: new Date().toISOString(),
        readOnlySnapshot: true,
        parse: { status: "running" },
      };
      project.files.push(record);
      await saveProject(project);
      try {
        record.parse = await extractSnapshot(project.id, record);
      } catch (error) {
        record.parse = { status: "failed", error: String(error.stack || error) };
      }
      await saveProject(project);
      sendJson(response, 201, { file: record, project });
    } catch (error) {
      await unlink(snapshot.path).catch(() => {});
      throw error;
    }
    return true;
  }

  const fileMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/files\/([a-zA-Z0-9_-]+)$/);
  if (request.method === "GET" && fileMatch) {
    const project = await loadProject(fileMatch[1]);
    const file = project.files.find(candidate => candidate.id === fileMatch[2]);
    if (!file) throw Object.assign(new Error("File not found"), { statusCode: 404 });
    const extracted = file.parse?.status === "ok"
      ? await loadExtractedFile(project.id, file)
      : { file, forensic: {}, markdown: "" };
    sendJson(response, 200, extracted);
    return true;
  }
  if (request.method === "PATCH" && fileMatch) {
    const body = await readJsonBody(request);
    const project = await loadProject(fileMatch[1]);
    const file = project.files.find(candidate => candidate.id === fileMatch[2]);
    if (!file) throw Object.assign(new Error("File not found"), { statusCode: 404 });
    const roles = ["main", "attachment", "data", "reference", "version-base", "version-current"];
    if (!roles.includes(body.role)) throw Object.assign(new Error("Invalid file role"), { statusCode: 400 });
    if (["main", "version-base", "version-current"].includes(body.role)) {
      for (const candidate of project.files) {
        if (candidate.id !== file.id && candidate.role === body.role) candidate.role = "attachment";
      }
    }
    file.role = body.role;
    await saveProject(project);
    sendJson(response, 200, { file, project });
    return true;
  }

  const versionSwapMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/version-swap$/);
  if (request.method === "POST" && versionSwapMatch) {
    const project = await loadProject(versionSwapMatch[1]);
    const base = project.files.find(file => file.role === "version-base");
    const current = project.files.find(file => file.role === "version-current");
    if (!base || !current) throw Object.assign(new Error("请先确认基准版和当前版"), { statusCode: 409 });
    base.role = "version-current";
    current.role = "version-base";
    await saveProject(project);
    sendJson(response, 200, { project, base: current, current: base });
    return true;
  }

  const analyzeMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/analyze$/);
  if (request.method === "POST" && analyzeMatch) {
    const body = await readJsonBody(request);
    const run = await createAnalysisRun(analyzeMatch[1], body);
    startJob(run);
    sendJson(response, 202, { run });
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)$/);
  if (request.method === "GET" && runMatch) {
    sendJson(response, 200, { run: await loadRun(runMatch[1], runMatch[2]) });
    return true;
  }

  const issueMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/issues\/([a-zA-Z0-9_-]+)$/);
  if (request.method === "PATCH" && issueMatch) {
    const body = await readJsonBody(request);
    const run = await loadRun(issueMatch[1], issueMatch[2]);
    const issue = run.issues.find(candidate => candidate.id === issueMatch[3]);
    if (!issue) throw Object.assign(new Error("Issue not found"), { statusCode: 404 });
    if (!['open', 'ignored', 'resolved'].includes(body.status)) throw Object.assign(new Error("Invalid status"), { statusCode: 400 });
    issue.status = body.status;
    issue.updatedAt = new Date().toISOString();
    await saveRun(run);
    sendJson(response, 200, { issue, run });
    return true;
  }

  const rewriteMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/issues\/([a-zA-Z0-9_-]+)\/rewrite$/);
  if (request.method === "POST" && rewriteMatch) {
    const body = await readJsonBody(request);
    const run = await loadRun(rewriteMatch[1], rewriteMatch[2]);
    const issue = run.issues.find(candidate => candidate.id === rewriteMatch[3]);
    if (!issue || issue.module !== "writing") throw Object.assign(new Error("Writing issue not found"), { statusCode: 404 });
    const preferredProvider = body.provider
      || (run.providerUsed && !run.providerUsed.includes("fallback") && run.providerUsed !== "deterministic" ? run.providerUsed : null)
      || (run.providerRequested !== "deterministic" ? run.providerRequested : "auto");
    const rewritten = await rewriteWithProvider({ providerId: preferredProvider, projectId: rewriteMatch[1], runId: rewriteMatch[2], issue, instruction: body.instruction, model: body.model });
    if (!rewritten.suggestedText) throw Object.assign(new Error("未生成有效改写结果"), { statusCode: 502 });
    issue.suggestionHistory = [...(issue.suggestionHistory || []), {
      text: issue.suggestedText,
      reason: issue.rewriteReason,
      instruction: body.instruction || "",
      generatedAt: new Date().toISOString(),
    }].filter(item => item.text).slice(-12);
    issue.suggestedText = rewritten.suggestedText;
    issue.rewriteReason = rewritten.rationale;
    issue.updatedAt = new Date().toISOString();
    await saveRun(run);
    sendJson(response, 200, { issue, run, provider: rewritten.provider, diagnostics: rewritten.diagnostics });
    return true;
  }

  const mappingMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/issues\/([a-zA-Z0-9_-]+)\/mapping$/);
  if (request.method === "POST" && mappingMatch) {
    const body = await readJsonBody(request);
    const project = await loadProject(mappingMatch[1]);
    const run = await loadRun(mappingMatch[1], mappingMatch[2]);
    const issue = run.issues.find(candidate => candidate.id === mappingMatch[3]);
    if (!issue) throw Object.assign(new Error("Issue not found"), { statusCode: 404 });
    const result = applyMappingChoice({ project, run, issue, candidateId: String(body.candidateId || "") });
    await saveProject(result.project);
    await saveRun(result.run);
    sendJson(response, 200, result);
    return true;
  }

  const acceptMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/issues\/([a-zA-Z0-9_-]+)\/accept$/);
  if (request.method === "POST" && acceptMatch) {
    const body = await readJsonBody(request);
    const run = await loadRun(acceptMatch[1], acceptMatch[2]);
    const issue = run.issues.find(candidate => candidate.id === acceptMatch[3]);
    if (!issue || issue.module !== "writing") throw Object.assign(new Error("Writing issue not found"), { statusCode: 404 });
    const finalText = String(body.finalText || issue.suggestedText || "").trim();
    const originalText = String(issue.originalText || issue.evidence?.[0]?.quote || "").trim();
    if (!originalText || !finalText) throw Object.assign(new Error("原文或最终版本为空"), { statusCode: 400 });
    issue.acceptedSuggestion = { text: finalText, instruction: body.instruction || "", acceptedAt: new Date().toISOString() };
    issue.status = "resolved";
    await saveRun(run);
    const profile = await rememberAcceptedStyleExample({ originalText, finalText, instruction: body.instruction, projectId: acceptMatch[1], issueId: issue.id });
    sendJson(response, 200, { issue, run, profile });
    return true;
  }

  const exportMatch = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/export$/);
  if (request.method === "GET" && exportMatch) {
    const project = await loadProject(exportMatch[1]);
    if (!project.latestRunId) throw Object.assign(new Error("尚无可导出的分析结果"), { statusCode: 409 });
    const run = await loadRun(project.id, project.latestRunId);
    const format = url.searchParams.get("format") || "html";
    if (format === "xlsx") {
      const exported = await exportIssuesWorkbook(project, run);
      const info = await stat(exported.outputPath);
      response.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": info.size,
        "Content-Disposition": 'attachment; filename="audit-issues.xlsx"',
        "Cache-Control": "no-store",
      });
      createReadStream(exported.outputPath).pipe(response);
    } else if (format === "json") {
      sendText(response, 200, JSON.stringify({ project, run }, null, 2), "application/json; charset=utf-8", { "Content-Disposition": 'attachment; filename="audit-report.json"' });
    } else if (format === "csv") {
      sendText(response, 200, issuesToCsv(run), "text/csv; charset=utf-8", { "Content-Disposition": 'attachment; filename="audit-issues.csv"' });
    } else {
      sendText(response, 200, issuesToHtml(project, run), "text/html; charset=utf-8", { "Content-Disposition": 'attachment; filename="audit-report.html"' });
    }
    return true;
  }
  return false;
}

await ensureStorage();
await recoverInterruptedRuns();
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) { sendJson(response, 403, { error: "请从本机工作台访问" }); return; }
      if (!await handleApi(request, response, url)) sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!await serveStatic(url.pathname, response)) sendText(response, 404, "Not found");
  } catch (error) {
    const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    sendJson(response, status, { error: error.message || String(error) });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Document audit workbench: http://127.0.0.1:${port}/`);
  console.log(`Local data snapshots: ${dataRoot}`);
});
