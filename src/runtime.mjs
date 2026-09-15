import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

async function executableOrFallback(candidate, fallback) {
  try {
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return fallback;
  }
}

const userProfile = process.env.USERPROFILE || process.env.HOME || "";
const runtimeRoot = join(userProfile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");

export async function resolveRuntime() {
  const node = await executableOrFallback(
    process.env.WORKBENCH_NODE || join(runtimeRoot, "node", "bin", "node.exe"),
    process.execPath,
  );
  const python = await executableOrFallback(
    process.env.WORKBENCH_PYTHON || join(runtimeRoot, "python", "python.exe"),
    "python",
  );
  const codex = await executableOrFallback(
    process.env.WORKBENCH_CODEX || join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin", "codex.exe"),
    "codex",
  );
  return { node, nodeModules: join(runtimeRoot, "node", "node_modules"), python, codex, runtimeRoot };
}
