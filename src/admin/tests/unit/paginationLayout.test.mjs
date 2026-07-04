import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paginationBarSource = readFileSync(
  new URL("../../shared/components/PaginationBar.jsx", import.meta.url),
  "utf8",
);

const masterDetailLayoutSource = readFileSync(
  new URL("../../shared/components/MasterDetailLayout.jsx", import.meta.url),
  "utf8",
);

test("pagination bar uses compact page-size labels and hides nav when only one page", () => {
  assert.doesNotMatch(paginationBarSource, /\/page/);
  assert.match(paginationBarSource, /const showNav = showControls && totalPages > 1;/);
  assert.match(paginationBarSource, /const displayLabel =[\s\S]*`\$\{current\}\/\$\{totalPages\}`/);
});

test("master detail layout enforces 200px minimum sidebar width", () => {
  assert.match(masterDetailLayoutSource, /minmax\(200px,\s*\$\{width\}\)/);
});

test("master detail layout supports collapsing the sidebar column to fill remaining space", () => {
  assert.match(masterDetailLayoutSource, /sidebarCollapsed = false/);
  assert.match(masterDetailLayoutSource, /collapsedSidebarWidth = 0/);
  assert.match(masterDetailLayoutSource, /gridTemplateColumns:\s*sidebarCollapsed/);
});
