import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loadExtractedFile } from "./parsers.mjs";
import { deduplicateIssues } from "./issues.mjs";
import { runDeterministicAnalysis } from "./providers/deterministic.mjs";
import { analyzeWithProvider, assessWithProvider } from "./providers/index.mjs";
import { buildCoveragePlan, finalizeCoverage } from "./coverage.mjs";
import { loadProject, projectDir, saveProject, writeJsonAtomic } from "./storage.mjs";

const semanticModules = new Set(["conflict", "logic", "proofread", "sentence", "writing", "data", "open", "deep"]);

export async function createAnalysisRun(projectId, options = {}) {
  const project = await loadProject(projectId);
  const requestedModules = Array.isArray(options.modules) && options.modules.length
    ? [...new Set(options.modules)]
    : project.selectedModules;
  const baseRun = project.latestRunId
    ? await loadRun(projectId, project.latestRunId).catch(() => null)
    : null;
  const inheritedModules = baseRun?.status === "completed" && options.replaceScope !== true
    ? (baseRun.modules || [])
    : [];
  const modules = [...new Set([...inheritedModules, ...requestedModules])];
  const run = {
    id: randomUUID(),
    projectId,
    status: "queued",
    progress: 0,
    stage: "等待开始",
    modules,
    requestedModules,
    baseRunId: baseRun?.status === "completed" && options.replaceScope !== true ? baseRun.id : null,
    providerRequested: options.provider || "auto",
    model: options.model || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    issues: [],
    warnings: [],
  };
  project.selectedModules = modules;
  project.latestRunId = run.id;
  await saveProject(project);
  await saveRun(run);
  return run;
}

export async function loadRun(projectId, runId) {
  const path = join(projectDir(projectId), "runs", `${runId}.json`);
  const { readJson } = await import("./storage.mjs");
  const run = await readJson(path);
  if (!run) throw Object.assign(new Error("Run not found"), { statusCode: 404 });
  return run;
}

export async function saveRun(run) {
  run.updatedAt = new Date().toISOString();
  await writeJsonAtomic(join(projectDir(run.projectId), "runs", `${run.id}.json`), run);
  return run;
}

async function updateRun(run, patch) {
  Object.assign(run, patch);
  await saveRun(run);
}

export async function executeAnalysisRun(run) {
  try {
    await updateRun(run, { status: "running", progress: 8, stage: "读取审计级证据", startedAt: run.startedAt || new Date().toISOString() });
    const project = await loadProject(run.projectId);
    const readyFiles = project.files.filter(file => file.parse?.status === "ok");
    if (!readyFiles.length) throw new Error("没有可分析的已解析文件");
    const items = [];
    for (const file of readyFiles) items.push(await loadExtractedFile(project.id, file));

    const requestedModules = Array.isArray(run.requestedModules) && run.requestedModules.length
      ? run.requestedModules
      : run.modules;
    const baseRun = run.baseRunId
      ? await loadRun(run.projectId, run.baseRunId).catch(() => null)
      : null;
    const inheritedIssues = baseRun?.status === "completed"
      ? (baseRun.issues || []).filter(issue => !requestedModules.includes(issue.module))
      : [];

    await updateRun(run, { progress: 26, stage: "执行结构化核验" });
    const deterministicIssues = await runDeterministicAnalysis({ items, modules: requestedModules, fieldMappings: project.fieldMappings || {} });
    let allIssues = [...inheritedIssues, ...deterministicIssues];
    let assessment = requestedModules.includes("assessment") ? null : baseRun?.assessment || null;
    let reviewProtocol = requestedModules.includes("assessment") ? null : baseRun?.reviewProtocol || null;
    let providerUsed = "deterministic";
    const semantic = requestedModules.filter(module => semanticModules.has(module));
    let coverage = finalizeCoverage(buildCoveragePlan({ items, modules: semantic }), []);

    if (requestedModules.includes("open") && run.providerRequested === "deterministic") {
      run.warnings.push("开放发现需要语义模型；本轮仅运行了确定性核验，未生成模块外的问题或改进建议。");
    }
    if (requestedModules.includes("deep") && run.providerRequested === "deterministic") {
      run.warnings.push("深度建议需要语义模型；本轮仅运行了确定性核验，未生成专业优化方案。");
    }
    if (requestedModules.includes("sentence") && run.providerRequested === "deterministic") {
      run.warnings.push("逐句精审需要语义模型；本轮仅运行了确定性核验，未生成逐句语言、歧义与建议改法。");
    }
    if (requestedModules.includes("assessment") && run.providerRequested === "deterministic") {
      run.warnings.push("改进评估需要语义模型；本轮未生成整份报告的改进评估与路线图。");
    }

    const wantsCodex = run.providerRequested !== "deterministic" && semantic.length > 0 && process.env.WORKBENCH_USE_CODEX !== "0";
    if (wantsCodex) {
      await updateRun(run, { progress: 44, stage: "Codex语义审查" });
      const codexStartedAt = Date.now();
      const heartbeat = setInterval(() => {
        run.progress = Math.min(78, run.progress + 2);
        run.stage = `Codex语义审查 · ${Math.max(1, Math.round((Date.now() - codexStartedAt) / 1000))}秒`;
        saveRun(run).catch(() => {});
      }, 5000);
      try {
        const codexResult = await analyzeWithProvider({
          providerId: run.providerRequested,
          projectId: project.id,
          runId: run.id,
          items,
          modules: semantic,
          model: run.model,
        });
        allIssues.push(...codexResult.issues);
        coverage = codexResult.coverage || coverage;
        providerUsed = codexResult.provider;
        run.providerDiagnostics = codexResult.diagnostics;
      } catch (error) {
        run.warnings.push(`Codex语义分析未完成，已保留确定性核验结果：${String(error.message || error).slice(0, 500)}`);
        providerUsed = "deterministic-fallback";
      } finally {
        clearInterval(heartbeat);
      }
    }

    const wantsAssessment = requestedModules.includes("assessment") && run.providerRequested !== "deterministic" && process.env.WORKBENCH_USE_CODEX !== "0";
    if (wantsAssessment) {
      await updateRun(run, { progress: 80, stage: "生成整体改进评估" });
      try {
        const assessmentResult = await assessWithProvider({
          providerId: run.providerRequested,
          projectId: project.id,
          runId: run.id,
          items,
          modules: ["assessment"],
          model: run.model,
          onStage: async patch => updateRun(run, patch),
        });
        assessment = assessmentResult.assessment;
        reviewProtocol = assessmentResult.reviewProtocol || null;
        if (assessmentResult.warnings?.length) run.warnings.push(...assessmentResult.warnings);
        providerUsed = assessmentResult.provider;
        run.assessmentDiagnostics = assessmentResult.diagnostics;
      } catch (error) {
        run.warnings.push(`整体改进评估未完成：${String(error.message || error).slice(0, 500)}`);
        if (providerUsed === "deterministic") providerUsed = "deterministic-fallback";
      }
    }

    await updateRun(run, { progress: 92, stage: "合并问题与证据" });
    allIssues = deduplicateIssues(allIssues).map(issue => ({ ...issue, runId: run.id }));
    await updateRun(run, {
      status: "completed",
      progress: 100,
      stage: "分析完成",
      providerUsed,
      issues: allIssues,
      assessment,
      reviewProtocol,
      coverage,
      completedAt: new Date().toISOString(),
      summary: {
        total: allIssues.length,
        high: allIssues.filter(issue => issue.severity === "high").length,
        medium: allIssues.filter(issue => issue.severity === "medium").length,
        low: allIssues.filter(issue => issue.severity === "low").length,
      },
    });
  } catch (error) {
    await updateRun(run, {
      status: "failed",
      stage: "分析失败",
      error: String(error.stack || error),
    });
  }
  return run;
}
