import { join } from "node:path";
import { dataRoot, readJson, writeJsonAtomic } from "./storage.mjs";

const stylePath = join(dataRoot, "style-profile.json");

export async function loadStyleProfile() {
  return await readJson(stylePath, {
    version: 1,
    mode: "light-naturalization",
    principles: [
      "不改变事实、数字、术语和结论",
      "删除空话、套话和机械排比",
      "减少宣传腔与过度强调",
      "让句子长短更自然，但不强行口语化"
    ],
    examples: [],
    updatedAt: null
  });
}

export async function rememberAcceptedStyleExample(example) {
  const profile = await loadStyleProfile();
  profile.examples.push({
    originalText: String(example.originalText || "").slice(0, 4000),
    finalText: String(example.finalText || "").slice(0, 4000),
    instruction: String(example.instruction || "").slice(0, 500),
    projectId: example.projectId || null,
    issueId: example.issueId || null,
    acceptedAt: new Date().toISOString()
  });
  profile.examples = profile.examples.filter(item => item.originalText && item.finalText).slice(-30);
  profile.updatedAt = new Date().toISOString();
  await writeJsonAtomic(stylePath, profile);
  return profile;
}
