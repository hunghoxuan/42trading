import assert from "node:assert/strict";
import test from "node:test";

import {
  RESPONSIVE_PANEL_MOBILE_BREAKPOINT,
  normalizeResponsivePanelWidth,
  resolveResponsivePanelBorderClass,
  resolveResponsivePanelMotionClass,
} from "../../shared/components/ResponsivePanel.utils.js";

test("normalizeResponsivePanelWidth supports px numbers and percentage strings", () => {
  assert.equal(normalizeResponsivePanelWidth(280), "280px");
  assert.equal(normalizeResponsivePanelWidth("45%"), "45%");
  assert.equal(normalizeResponsivePanelWidth("320px"), "320px");
  assert.equal(normalizeResponsivePanelWidth(""), "100%");
});

test("resolveResponsivePanelMotionClass maps supported directions", () => {
  assert.equal(
    resolveResponsivePanelMotionClass("left-right"),
    "responsive-panel--motion-horizontal",
  );
  assert.equal(
    resolveResponsivePanelMotionClass("top-down"),
    "responsive-panel--motion-vertical",
  );
  assert.equal(
    resolveResponsivePanelMotionClass("zoom"),
    "responsive-panel--motion-zoom",
  );
});

test("resolveResponsivePanelBorderClass maps supported border modes", () => {
  assert.equal(
    resolveResponsivePanelBorderClass("none"),
    "responsive-panel--border-none",
  );
  assert.equal(
    resolveResponsivePanelBorderClass("mobile"),
    "responsive-panel--border-mobile",
  );
  assert.equal(
    resolveResponsivePanelBorderClass("always"),
    "responsive-panel--border-always",
  );
  assert.equal(
    resolveResponsivePanelBorderClass("desktop"),
    "responsive-panel--border-desktop",
  );
  assert.equal(
    resolveResponsivePanelBorderClass(""),
    "responsive-panel--border-desktop",
  );
});

test("responsive panel mobile breakpoint remains aligned with mobile collapse behavior", () => {
  assert.equal(RESPONSIVE_PANEL_MOBILE_BREAKPOINT, 768);
});
