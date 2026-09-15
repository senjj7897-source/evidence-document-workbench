import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { toMarkdown } from "@firecrawl/anydoc";
import { projectDir, readJson } from "./storage.mjs";
import { resolveRuntime } from "./runtime.mjs";

const execFileAsync = promisify(execFile);

export async function extractSnapshot(projectId, fileRecord) {
  const root = projectDir(projectId);
  const sourcePath = join(root, "snapshots", fileRecord.storedName);
  const forensicPath = join(root, "extracted", `${fileRecord.id}.forensic.json`);
  const markdownPath = join(root, "extracted", `${fileRecord.id}.md`);
  const { python } = await resolveRuntime();

  const startedAt = Date.now();
  const forensic = await execFileAsync(
    python,
    [join(process.cwd(), "workers", "extract.py"), sourcePath, forensicPath],
    { cwd: process.cwd(), windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  let pageMap = { status: "not_applicable" };
  if (process.platform === "win32" && /\.docx$/i.test(fileRecord.name || fileRecord.storedName || "")) {
    try {
      const mapped = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile", "-ExecutionPolicy", "Bypass",
          "-File", join(process.cwd(), "workers", "word_page_map.ps1"),
          "-InputPath", sourcePath,
          "-ForensicPath", forensicPath,
        ],
        { cwd: process.cwd(), windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
      );
      pageMap = { status: "ok", parser: "word-layout", ...JSON.parse(mapped.stdout.trim()) };
    } catch (error) {
      pageMap = { status: "unavailable", parser: "word-layout", error: String(error.message || error).slice(0, 500) };
    }
  }

  let quick = { status: "ok", parser: "anydoc", markdownPath: `${fileRecord.id}.md` };
  try {
    const markdown = await toMarkdown(sourcePath);
    await writeFile(markdownPath, markdown, "utf8");
    quick.characters = markdown.length;
  } catch (error) {
    quick = { status: "failed", parser: "anydoc", error: String(error.message || error) };
    await writeFile(markdownPath, "", "utf8");
  }

  const forensicPayload = await readJson(forensicPath, {});
  return {
    status: "ok",
    durationMs: Date.now() - startedAt,
    quick,
    forensic: {
      status: "ok",
      parser: "audit-extractor",
      kind: forensicPayload.kind,
      statistics: forensicPayload.statistics || {},
      pageMap,
      stderr: forensic.stderr?.trim() || undefined,
    },
  };
}

export async function loadExtractedFile(projectId, fileRecord) {
  const root = projectDir(projectId);
  const forensic = await readJson(join(root, "extracted", `${fileRecord.id}.forensic.json`), {});
  let markdown = "";
  try {
    markdown = await readFile(join(root, "extracted", `${fileRecord.id}.md`), "utf8");
  } catch {}
  return { file: fileRecord, forensic, markdown };
}
