import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = { limit: 10, format: "jsonl" };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--root") options.root = argv[++i];
    else if (key === "--query") options.query = argv[++i];
    else if (key === "--topic") options.topic = argv[++i];
    else if (key === "--entity") options.entity = argv[++i];
    else if (key === "--year") options.year = argv[++i];
    else if (key === "--type") options.type = argv[++i];
    else if (key === "--temporal") options.temporal = argv[++i];
    else if (key === "--finalization") options.finalization = argv[++i];
    else if (key === "--role") options.role = argv[++i];
    else if (key === "--scope") options.scope = argv[++i];
    else if (key === "--limit") options.limit = Number(argv[++i]);
    else if (key === "--format") options.format = argv[++i];
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (!options.root) throw new Error("Required: --root PATH");
  if (!options.query && !options.topic && !options.entity && !options.year && !options.type && !options.temporal && !options.finalization && !options.role && !options.scope) throw new Error("Provide --query or at least one structured filter");
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error("--limit must be 1..100");
  if (!new Set(["jsonl", "markdown"]).has(options.format)) throw new Error("--format must be jsonl or markdown");
  options.root = resolve(options.root);
  return options;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function terms(value) {
  const normalized = normalize(value);
  const result = new Set();
  for (const match of String(value || "").normalize("NFKC").toLowerCase().matchAll(/[a-z]+\d*[a-z\d_]*|\d{4}|[\p{Script=Han}]{2,}/gu)) {
    const token = match[0].replaceAll("_", "");
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 8) result.add(token);
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let i = 0; i <= token.length - size; i += 1) result.add(token.slice(i, i + size));
      }
    } else if (token.length >= 2) result.add(token);
  }
  if (normalized) result.add(normalized);
  return [...result];
}

function textScore(query, value, weight) {
  if (!query) return 0;
  const queryNorm = normalize(query);
  const valueNorm = normalize(value);
  if (!valueNorm) return 0;
  let score = valueNorm.includes(queryNorm) ? weight : 0;
  const queryTerms = terms(query).filter((term) => term.length >= 2);
  if (!queryTerms.length) return score;
  const matched = queryTerms.filter((term) => valueNorm.includes(normalize(term)));
  score += weight * 0.75 * (matched.length / queryTerms.length);
  return score;
}

function excerpt(text, query, max = 260) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const queryTerms = terms(query).sort((a, b) => b.length - a.length);
  let index = -1;
  for (const term of queryTerms) {
    index = normalize(compact).indexOf(normalize(term));
    if (index >= 0) break;
  }
  if (index < 0) return Array.from(compact).slice(0, max).join("");
  const start = Math.max(0, index - Math.floor(max / 3));
  const slice = Array.from(compact).slice(start, start + max).join("");
  return `${start > 0 ? "…" : ""}${slice}${start + max < compact.length ? "…" : ""}`;
}

function matchesFilter(record, options) {
  if (options.temporal && record.temporal_status !== options.temporal) return false;
  if (options.finalization && record.finalization_status !== options.finalization) return false;
  if (options.role && record.material_role !== options.role) return false;
  if (options.scope && record.policy_scope !== options.scope) return false;
  if (options.topic && !record.primary_topics?.some((value) => normalize(value).includes(normalize(options.topic)))) return false;
  if (options.entity && !record.entities?.some((value) => normalize(value).includes(normalize(options.entity)))) return false;
  if (options.year && String(record.period?.year || "") !== String(options.year)) return false;
  if (options.type && normalize(record.document_type) !== normalize(options.type)) return false;
  return true;
}

function intentScore(query, record) {
  if (!query) return 0;
  let score = 0;
  const queryYear = query.match(/20\d{2}/)?.[0];
  if (queryYear) score += String(record.period?.year || "") === queryYear ? 60 : -45;
  if (/现行|当前|有效|执行.*制度/.test(query)) {
    const policyName = normalize(query.replace(/现行|当前|最新|有效/g, ""));
    if (policyName.length >= 6 && normalize(record.title).includes(policyName)) score += 120;
    const status = record.temporal_status || record.version_status;
    if (status === "current_confirmed") score += 70;
    if (status === "current_candidate_unverified") score += 55;
    if (record.material_role === "policy" || (!record.material_role && record.document_type === "internal_policy")) score += 40;
    if (record.finalization_status === "draft" || ["repealed_confirmed", "historical_candidate"].includes(status)) score -= 140;
    if (["meeting_proposal", "periodic_or_case_report", "reference_explanation"].includes(record.material_role)) score -= 35;
  }
  if (/监管依据|监管规定|监管要求/.test(query) && (record.policy_scope === "外部规则" || (!record.policy_scope && record.authority_level === "external_regulator"))) score += 45;
  if (/会议纪要/.test(query)) {
    if (record.title.includes("会议纪要")) score += 45;
    if (/贯彻落实|签报|附件/.test(record.title)) score -= 12;
    const ordinal = query.match(/第\s*(\d+)\s*次/);
    if (ordinal) {
      const n = ordinal[1];
      const targetText = `${record.title} ${record.source_primary}`;
      if (new RegExp(`第\\s*${n}\\s*(?:次|号)|MRCO[-_/]?\\d{4}[-_/]?${n}(?:\\D|$)`, "i").test(targetText)) score += 90;
      else score -= 25;
    }
  }
  return score;
}

async function loadJsonl(path) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSONL at ${path}:${index + 1}`); }
  });
}

export async function searchKnowledgeBase(options) {
  const navRoot = join(options.root, "00-导航");
  const [catalog, chunks] = await Promise.all([
    loadJsonl(join(navRoot, "catalog.jsonl")),
    options.query ? loadJsonl(join(navRoot, "chunks.jsonl")) : Promise.resolve([]),
  ]);

  const allowed = new Map(catalog.filter((record) => matchesFilter(record, options)).map((record) => [record.kb_id, record]));
  const scored = new Map();
  for (const record of allowed.values()) {
    let score = 0;
    if (options.query) {
      score += textScore(options.query, record.title, 80);
      score += textScore(options.query, record.document_numbers?.join(" "), 90);
      score += textScore(options.query, record.report_codes?.join(" "), 90);
      score += textScore(options.query, record.primary_topics?.join(" "), 55);
      score += textScore(options.query, record.entities?.join(" "), 35);
      score += textScore(options.query, record.source_primary, 30);
      score += textScore(options.query, record.summary, 20);
      score += textScore(options.query, record.related_topics?.join(" "), 10);
      score += intentScore(options.query, record);
    } else score = 1;
    scored.set(record.kb_id, { record, score, best_chunk: null, chunk_score: 0 });
  }

  if (options.query) {
    for (const chunk of chunks) {
      const candidate = scored.get(chunk.kb_id);
      if (!candidate) continue;
      const score = textScore(options.query, `${chunk.heading_path?.join(" ")} ${chunk.text}`, 32);
      if (score > candidate.chunk_score) {
        candidate.chunk_score = score;
        candidate.best_chunk = chunk;
      }
    }
  }

  const ranked = [...scored.values()]
    .map((item) => ({ ...item, total: item.score + item.chunk_score }))
    .filter((item) => !options.query || item.total > 0)
    .sort((a, b) => b.total - a.total || a.record.title.localeCompare(b.record.title, "zh-CN"));
  const seenFamilies = new Set();
  const collapsed = [];
  for (const item of ranked) {
    const key = `${item.record.strict_version_family || item.record.version_family}|${item.record.version_year_hint || item.record.period?.year || ""}|${item.record.finalization_status || ''}|${normalize(item.record.title)}`;
    if (seenFamilies.has(key)) continue;
    seenFamilies.add(key);
    collapsed.push(item);
    if (collapsed.length >= options.limit) break;
  }
  const results = collapsed
    .map((item) => ({
      score: Math.round(item.total * 10) / 10,
      kb_id: item.record.kb_id,
      title: item.record.title,
      note_path: item.record.note_path,
      source_primary: item.record.source_primary,
      source_aliases: item.record.source_aliases,
      category: item.record.category,
      document_type: item.record.document_type,
      authority_level: item.record.authority_level,
      entities: item.record.entities,
      primary_topics: item.record.primary_topics,
      period: item.record.period,
      document_numbers: item.record.document_numbers,
      report_codes: item.record.report_codes,
      version_status: item.record.version_status,
      temporal_status: item.record.temporal_status,
      finalization_status: item.record.finalization_status,
      material_role: item.record.material_role,
      policy_scope: item.record.policy_scope,
      strict_version_family: item.record.strict_version_family,
      status_evidence: item.record.status_evidence,
      confirmed_repealed_by: item.record.confirmed_repealed_by,
      revision_mode: item.record.revision_mode,
      authority_verification: item.record.authority_verification,
      unresolved: item.record.unresolved,
      extraction_quality: item.record.extraction_quality,
      matched_heading: item.best_chunk?.heading_path || [],
      matched_lines: item.best_chunk ? [item.best_chunk.start_line, item.best_chunk.end_line] : null,
      excerpt: excerpt(item.best_chunk?.text || item.record.summary, options.query || ""),
    }));

  return results;
}

async function main() {
  const options = parseArgs(process.argv);
  const results = await searchKnowledgeBase(options);
  if (options.format === "jsonl") {
    for (const result of results) console.log(JSON.stringify(result));
  } else {
    console.log(`# 检索结果：${options.query || "结构化筛选"}\n`);
    for (const result of results) {
      console.log(`- **${result.title}**（${result.score}）`);
      console.log(`  - 条目：${result.note_path}`);
      console.log(`  - 来源：${result.source_primary}`);
      console.log(`  - 状态：${result.temporal_status || result.version_status} / ${result.finalization_status || "unknown"} / ${result.extraction_quality}`);
      if (result.material_role) console.log(`  - 材料角色：${result.material_role} / ${result.policy_scope}`);
      if (result.excerpt) console.log(`  - 命中：${result.excerpt}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
