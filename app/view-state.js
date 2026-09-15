const scrollSelectors = [".setup-layout", ".issues-panel", ".detail-panel", ".left-panel", ".assessment-panel"];

export function captureScrollPositions(root) {
  return Object.fromEntries(scrollSelectors.map(selector => [selector, root.querySelector(selector)?.scrollTop || 0]));
}

export function restoreScrollPositions(root, positions = {}) {
  for (const selector of scrollSelectors) {
    const node = root.querySelector(selector);
    if (node) node.scrollTop = Number(positions[selector] || 0);
  }
}
