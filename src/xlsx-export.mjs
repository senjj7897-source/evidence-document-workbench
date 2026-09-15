import { spawn } from "node:child_process";
import { access, lstat, mkdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectDir } from "./storage.mjs";
import { resolveRuntime } from "./runtime.mjs";

const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerRoot = join(sourceRoot, "workers", "xlsx-runtime");
const workerPath = join(workerRoot, "export_xlsx.mjs");

async function ensureArtifactRuntime(nodeModules) {
  await mkdir(workerRoot, { recursive: true });
  const linkPath = join(workerRoot, "node_modules");
  try {
    const info = await lstat(linkPath);
    if (!info.isSymbolicLink()) throw new Error(`${linkPath} 已存在且不是可替换的依赖链接`);
    const target = await readlink(linkPath);
    if (resolve(workerRoot, target) !== resolve(nodeModules) && resolve(target) !== resolve(nodeModules)) {
      await unlink(linkPath);
      await symlink(nodeModules, linkPath, "junction");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await access(nodeModules);
    await symlink(nodeModules, linkPath, "junction");
  }
}

function runWorker(executable, args, timeoutMs = 120_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: workerRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ stdout, stderr, exitCode: code, recoveredWindowsExit: false });
        return;
      }
      const completion = stdout.trim().split(/\r?\n/).reverse().map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).find(value => value?.outputPath && value?.validationPath && value?.previewDir);
      if (completion) {
        resolvePromise({ stdout, stderr, exitCode: code, completion, recoveredWindowsExit: true });
        return;
      }
      reject(Object.assign(new Error(`XLSX 生成失败（退出码 ${code}）${stderr ? `\n${stderr.trim()}` : ""}`), { stdout, stderr }));
    });
  });
}

export async function exportIssuesWorkbook(project, run) {
  const runtime = await resolveRuntime();
  await ensureArtifactRuntime(runtime.nodeModules);
  const exportDir = join(projectDir(project.id), "exports");
  await mkdir(exportDir, { recursive: true });
  const outputPath = join(exportDir, `audit-issues-${run.id}.xlsx`);
  const inputPath = join(exportDir, `.xlsx-input-${run.id}.json`);
  const validationPath = join(exportDir, `audit-issues-${run.id}.validation.json`);
  const previewDir = join(exportDir, `audit-issues-${run.id}-previews`);
  await writeFile(inputPath, JSON.stringify({ project, run }, null, 2), "utf8");
  try {
    await runWorker(runtime.node, [workerPath, inputPath, outputPath, validationPath, previewDir]);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
  await access(outputPath);
  await access(validationPath);
  await access(join(previewDir, "summary.png"));
  await access(join(previewDir, "issues.png"));
  await access(join(previewDir, "evidence.png"));
  return { outputPath, validationPath, previewDir };
}
