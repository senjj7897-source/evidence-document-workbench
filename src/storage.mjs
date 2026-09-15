import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

export const dataRoot = resolve(process.env.WORKBENCH_DATA_DIR || join(process.cwd(), "workbench-data"));

export async function ensureStorage() {
  await mkdir(join(dataRoot, "projects"), { recursive: true });
}

export function safeId(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value || "")) throw new Error("Invalid identifier");
  return value;
}

export function sanitizeFilename(value) {
  const raw = basename(String(value || "file"));
  const cleaned = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  return cleaned.slice(0, 180) || `file-${Date.now()}`;
}

export function projectDir(projectId) {
  return join(dataRoot, "projects", safeId(projectId));
}

export function projectManifestPath(projectId) {
  return join(projectDir(projectId), "project.json");
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function createProject(name = "未命名审查任务") {
  await ensureStorage();
  const now = new Date().toISOString();
  const id = randomUUID();
  const root = projectDir(id);
  await mkdir(join(root, "snapshots"), { recursive: true });
  await mkdir(join(root, "extracted"), { recursive: true });
  await mkdir(join(root, "runs"), { recursive: true });
  await mkdir(join(root, "exports"), { recursive: true });
  const project = {
    id,
    name: String(name || "未命名审查任务").trim().slice(0, 100),
    createdAt: now,
    updatedAt: now,
    files: [],
    selectedModules: ["conflict", "logic", "data", "proofread", "open"],
    latestRunId: null,
  };
  await writeJsonAtomic(projectManifestPath(id), project);
  return project;
}

export async function loadProject(projectId) {
  const project = await readJson(projectManifestPath(projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  return project;
}

export async function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  await writeJsonAtomic(projectManifestPath(project.id), project);
  return project;
}

export async function hashFile(path) {
  const buffer = await readFile(path);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function nextSnapshotPath(projectId, originalName) {
  const fileId = randomUUID();
  const extension = extname(originalName).toLowerCase();
  const displayName = sanitizeFilename(originalName);
  const storedName = `${fileId}${extension}`;
  return {
    fileId,
    displayName,
    storedName,
    path: join(projectDir(projectId), "snapshots", storedName),
  };
}

export async function fileMetadata(path) {
  const info = await stat(path);
  return { size: info.size, modifiedAt: info.mtime.toISOString() };
}
