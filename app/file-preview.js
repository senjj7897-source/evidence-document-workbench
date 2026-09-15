function escapePreviewHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

export function renderPreviewMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  if (!lines.some(line => line.trim())) return '<div class="preview-empty">没有可显示的解析内容</div>';

  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '<div class="preview-space" aria-hidden="true"></div>';
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5);
      return `<h${level} class="preview-heading">${escapePreviewHtml(heading[2])}</h${level}>`;
    }
    if (/^\|?\s*:?-{3,}/.test(trimmed)) return "";
    if (trimmed.includes("|") && trimmed.split("|").filter(Boolean).length > 1) {
      const cells = trimmed.split("|").map(cell => cell.trim()).filter(Boolean);
      return `<div class="preview-table-row">${cells.map(cell => `<span>${escapePreviewHtml(cell)}</span>`).join("")}</div>`;
    }
    if (/^[-*+]\s+/.test(trimmed)) return `<p class="preview-list">${escapePreviewHtml(trimmed.replace(/^[-*+]\s+/, ""))}</p>`;
    return `<p>${escapePreviewHtml(trimmed)}</p>`;
  }).join("");
}
