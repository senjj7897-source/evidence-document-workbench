import test from "node:test";
import assert from "node:assert/strict";
import { captureScrollPositions, restoreScrollPositions } from "../app/view-state.js";

function fakeRoot(values) {
  const nodes = new Map(Object.entries(values).map(([selector, scrollTop]) => [selector, { scrollTop }]));
  return { nodes, querySelector: selector => nodes.get(selector) || null };
}

test("selecting another issue preserves each workbench column scroll position", () => {
  const before = fakeRoot({ ".issues-panel": 617, ".detail-panel": 204, ".left-panel": 88 });
  const positions = captureScrollPositions(before);
  const after = fakeRoot({ ".issues-panel": 0, ".detail-panel": 0, ".left-panel": 0 });

  restoreScrollPositions(after, positions);

  assert.equal(after.nodes.get(".issues-panel").scrollTop, 617);
  assert.equal(after.nodes.get(".detail-panel").scrollTop, 204);
  assert.equal(after.nodes.get(".left-panel").scrollTop, 88);
});

test("selecting analysis modules preserves the setup page scroll position", () => {
  const before = fakeRoot({ ".setup-layout": 742 });
  const positions = captureScrollPositions(before);
  const after = fakeRoot({ ".setup-layout": 0 });

  restoreScrollPositions(after, positions);

  assert.equal(after.nodes.get(".setup-layout").scrollTop, 742);
});
