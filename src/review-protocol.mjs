function text(value) {
  return String(value ?? "").trim();
}

function sourceEntries(item, { maxCellsPerSheet }) {
  const file = item.file || {};
  const forensic = item.forensic || {};
  const entries = [];
  for (const block of forensic.blocks || []) {
    if (block.type === "table" && Array.isArray(block.rows)) {
      for (const row of block.rows) {
        for (const cell of row || []) {
          if (!text(cell.text)) continue;
          entries.push({
            fileId: file.id,
            fileName: file.name,
            locationLabel: `${block.location?.label || block.id || "表格"}!${cell.address || `R${cell.row}C${cell.column}`}`,
            content: text(cell.text),
            kind: "docx-table-cell",
            tableLabel: block.location?.label || block.id || "表格",
          });
        }
      }
      continue;
    }
    if (!text(block.text)) continue;
    entries.push({
      fileId: file.id,
      fileName: file.name,
      locationLabel: block.location?.label || block.id || "未定位",
      content: text(block.text),
      kind: block.type || "block",
    });
  }
  for (const page of forensic.pages || []) {
    if (!text(page.text)) continue;
    entries.push({
      fileId: file.id,
      fileName: file.name,
      locationLabel: page.location?.label || `第${page.page}页`,
      content: text(page.text),
      kind: "page",
    });
  }
  const appendSheets = (sheets, attachmentName = null) => {
    for (const sheet of sheets || []) {
      const allCells = sheet.cells || [];
      let selectedCells = allCells;
      let profiledSheet = false;
      if (allCells.length > maxCellsPerSheet) {
        profiledSheet = true;
        const selected = new Map();
        const add = cell => selected.set(cell.address, cell);
        allCells.slice(0, 150).forEach(add);
        allCells.filter(cell => cell.formula).slice(0, 350).forEach(add);
        allCells.slice(-100).forEach(add);
        selectedCells = [...selected.values()];
        const dateValues = allCells
          .map(cell => text(cell.cachedValue ?? cell.value))
          .filter(value => /^\d{4}-\d{2}-\d{2}/.test(value))
          .sort();
        const prefix = attachmentName ? `附件:${attachmentName}/` : "";
        entries.push({
          fileId: file.id,
          fileName: file.name,
          locationLabel: `${prefix}${sheet.name}!工作表概况`,
          content: [
            `非空单元格=${allCells.length}`,
            `公式=${sheet.formulaCount ?? allCells.filter(cell => cell.formula).length}`,
            `最大行=${sheet.maxRow ?? "未知"}`,
            `最大列=${sheet.maxColumn ?? "未知"}`,
            dateValues.length ? `日期范围=${dateValues[0]}至${dateValues.at(-1)}` : null,
            `语义抽样=${selectedCells.length}个关键单元格；全量单元格仍由确定性数据核验处理`,
          ].filter(Boolean).join("; "),
          kind: "sheet-profile",
          attachmentName,
          summarizedCells: allCells.length - selectedCells.length,
          rawCells: allCells.length,
        });
      }
      for (const cell of selectedCells) {
        const value = cell.formula
          ? `公式=${cell.formula}; 缓存值=${cell.cachedValue ?? cell.value ?? ""}`
          : text(cell.value);
        if (!text(value)) continue;
        const prefix = attachmentName ? `附件:${attachmentName}/` : "";
        entries.push({
          fileId: file.id,
          fileName: file.name,
          locationLabel: `${prefix}${sheet.name}!${cell.address}`,
          content: text(value),
          kind: "cell",
          attachmentName,
          profiledSheet,
        });
      }
    }
  };
  appendSheets(forensic.sheets);
  for (const workbook of forensic.embeddedWorkbooks || []) {
    appendSheets(workbook.sheets, workbook.name || "嵌入式工作簿");
  }
  return entries;
}

function renderEntry(entry) {
  return `[${entry.locationLabel}] ${entry.content}`;
}

export function createReviewPackets(items = [], { maxCharacters = 16000 } = {}) {
  const safeLimit = Math.max(200, Number(maxCharacters) || 16000);
  const maxCellsPerSheet = 600;
  const packets = [];
  const entries = items.flatMap(item => sourceEntries(item, { maxCellsPerSheet }));
  let current = null;
  for (const entry of entries) {
    const line = renderEntry(entry);
    if (!current || current.fileId !== entry.fileId || current.content.length + line.length + 1 > safeLimit) {
      current = {
        id: `packet-${packets.length + 1}`,
        fileId: entry.fileId,
        fileName: entry.fileName,
        content: `===== FILE ${entry.fileId} | ${entry.fileName} =====\n${line}`,
        entryCount: 1,
      };
      packets.push(current);
    } else {
      current.content += `\n${line}`;
      current.entryCount += 1;
    }
  }
  return {
    packets,
    manifest: {
      files: new Set(entries.map(entry => entry.fileId)).size,
      entries: entries.length,
      cells: entries.filter(entry => entry.kind === "cell").length,
      tableCells: entries.filter(entry => entry.kind === "docx-table-cell").length,
      rawCells: entries.reduce((total, entry) => total + (entry.kind === "cell" && !entry.profiledSheet ? 1 : entry.rawCells || 0), 0),
      summarizedCells: entries.reduce((total, entry) => total + (entry.summarizedCells || 0), 0),
      attachments: new Set(entries.map(entry => entry.attachmentName).filter(Boolean)).size,
      packetCount: packets.length,
      omittedEntries: 0,
      complete: true,
    },
    rows: entries,
  };
}
