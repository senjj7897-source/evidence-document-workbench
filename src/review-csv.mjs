function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows) {
  const header = ["file_id", "file_name", "source_type", "attachment", "location", "content"];
  const body = rows.map(row => [
    row.fileId,
    row.fileName,
    row.kind,
    row.attachmentName || "",
    row.locationLabel,
    row.content,
  ]);
  return `\ufeff${[header, ...body].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function createReviewCsvBundle(review = {}) {
  const rows = Array.isArray(review.rows) ? review.rows : [];
  return {
    narrative: rowsToCsv(rows.filter(row => !["docx-table-cell", "cell", "sheet-profile"].includes(row.kind))),
    tables: rowsToCsv(rows.filter(row => row.kind === "docx-table-cell")),
    worksheets: rowsToCsv(rows.filter(row => ["cell", "sheet-profile"].includes(row.kind))),
  };
}
