import { access } from "node:fs/promises";
import { resolveRuntime } from "../runtime.mjs";
import { executeCodexJson, runCodexAnalysis, runCodexAssessment, runCodexRewrite } from "./codex-local.mjs";

const registry = new Map();

export function registerSemanticProvider(adapter) {
  if (!adapter || !/^[a-z0-9][a-z0-9_-]*$/i.test(adapter.id || "")) throw new Error("AI provider id is invalid");
  if (typeof adapter.label !== "string" || !adapter.label.trim()) throw new Error(`AI provider ${adapter.id} requires a label`);
  if (typeof adapter.analyze !== "function") throw new Error(`AI provider ${adapter.id} requires analyze()`);
  registry.set(adapter.id, {
    priority: 0,
    capabilities: { analysis: true, assessment: typeof adapter.assess === "function", rewrite: typeof adapter.rewrite === "function", compose: typeof adapter.compose === "function" },
    isAvailable: async () => true,
    ...adapter,
  });
  return registry.get(adapter.id);
}

registerSemanticProvider({
  id: "codex-local",
  label: "本机 Codex",
  priority: 100,
  capabilities: { analysis: true, assessment: true, rewrite: true, compose: true },
  async isAvailable() {
    const runtime = await resolveRuntime();
    try { await access(runtime.codex); return true; } catch { return false; }
  },
  analyze: runCodexAnalysis,
  assess: runCodexAssessment,
  rewrite: runCodexRewrite,
  compose: executeCodexJson,
});

export async function listSemanticProviders() {
  const providers = [];
  for (const adapter of registry.values()) {
    let available = false;
    try { available = Boolean(await adapter.isAvailable()); } catch {}
    providers.push({
      id: adapter.id,
      label: adapter.label,
      priority: adapter.priority,
      capabilities: adapter.capabilities,
      available,
    });
  }
  return providers.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

export async function resolveSemanticProvider(requested = "auto", capability = "analysis") {
  const candidates = requested === "auto"
    ? [...registry.values()].sort((left, right) => right.priority - left.priority)
    : [registry.get(requested)].filter(Boolean);
  if (!candidates.length) throw new Error(`未注册的 AI 执行器：${requested}`);
  for (const adapter of candidates) {
    if (!adapter.capabilities?.[capability]) continue;
    if (capability === "rewrite" && typeof adapter.rewrite !== "function") continue;
    if (capability === "assessment" && typeof adapter.assess !== "function") continue;
    if (capability === "compose" && typeof adapter.compose !== "function") continue;
    if (await adapter.isAvailable()) return adapter;
  }
  throw new Error(`AI 执行器当前不可用：${requested}（能力：${capability}）`);
}

export async function analyzeWithProvider({ providerId = "auto", ...args }) {
  const adapter = await resolveSemanticProvider(providerId, "analysis");
  const result = await adapter.analyze(args);
  return { ...result, provider: result.provider || adapter.id };
}

export async function rewriteWithProvider({ providerId = "auto", ...args }) {
  const adapter = await resolveSemanticProvider(providerId, "rewrite");
  const result = await adapter.rewrite(args);
  return { ...result, provider: adapter.id };
}

export async function assessWithProvider({ providerId = "auto", ...args }) {
  const adapter = await resolveSemanticProvider(providerId, "assessment");
  const result = await adapter.assess(args);
  return { ...result, provider: result.provider || adapter.id };
}

export async function composeWithProvider({ providerId = process.env.WORKBENCH_COMPOSE_PROVIDER || 'codex-local', ...args }) {
  const adapter = await resolveSemanticProvider(providerId, 'compose');
  const result = await adapter.compose(args);
  return { ...result, provider: adapter.id };
}
