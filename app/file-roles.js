export function versionStem(name) {
  return String(name || "").toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/(?:^|[_\-\s（(])(v(?:ersion)?\s*\d+(?:\.\d+)*|final|update|updated|基准版|当前版|旧版|新版|修订稿|终稿|定稿)(?=$|[_\-\s）)])/gi, "")
    .replace(/[\s_\-（）()]/g, "");
}

export function versionScore(name) {
  const text = String(name || "").toLowerCase();
  const numbered = text.match(/(?:^|[_\-\s（(])v(?:ersion)?\s*(\d+(?:\.\d+)?)/i);
  if (numbered) return Number(numbered[1]);
  if (/(基准版|旧版|base|old)/i.test(text)) return -100;
  if (/(当前版|新版|最新|final|update|updated|修订稿|终稿|定稿)/i.test(text)) return 100;
  return null;
}

export function inferUploadRoles(files, existingFiles = []) {
  const roles = files.map(file => /\.(xlsx?|xlsm|csv)$/i.test(file.name) ? "data" : "attachment");
  const documents = files.map((file, index) => ({ file, index, score: versionScore(file.name), stem: versionStem(file.name) }))
    .filter(item => /\.(docx?|docm|pdf)$/i.test(item.file.name));
  const groups = new Map();
  for (const item of documents) {
    const group = groups.get(item.stem) || [];
    group.push(item);
    groups.set(item.stem, group);
  }
  for (const group of groups.values()) {
    const candidates = group.filter(item => item.score !== null);
    if (candidates.length < 2) continue;
    candidates.sort((left, right) => left.score - right.score || left.index - right.index);
    roles[candidates[0].index] = "version-base";
    roles[candidates[candidates.length - 1].index] = "version-current";
  }
  if (!existingFiles.some(file => file.role === "main")) {
    const main = documents.find(item => roles[item.index] === "attachment");
    if (main) roles[main.index] = "main";
  }
  return roles;
}

export function recommendAnalysisModules(files) {
  const items = [...(files || [])];
  const names = items.map(file => String(file.name || "").toLowerCase());
  const selected = new Set(["proofread", "open"]);
  const documents = items.filter(file => /\.(docx?|docm|pdf|rtf)$/i.test(file.name || ""));
  if (documents.length) {
    selected.add("logic");
    selected.add("sentence");
    selected.add("deep");
    selected.add("assessment");
  }
  if (documents.length >= 2) selected.add("conflict");
  if (names.some(name => /\.(xlsx?|xlsm|csv)$/.test(name))) selected.add("data");
  const roles = inferUploadRoles(items);
  if (roles.includes("version-base") && roles.includes("version-current")) selected.add("version");
  return [...selected];
}
