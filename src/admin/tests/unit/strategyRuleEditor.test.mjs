import assert from "node:assert/strict";
import test from "node:test";

import {
  appendActionDraft,
  appendGroupChild,
  ensureGroupRootDraft,
  makeEmptyConditionDraft,
  makeEmptyGroupDraft,
} from "../../shared/utils/strategyRuleEditor.js";

test("appendGroupChild adds a sibling condition into an existing group", () => {
  const base = makeEmptyGroupDraft("and");
  const next = appendGroupChild(base, { childType: "condition" });

  assert.equal(next.children.length, 2);
  assert.equal(next.children[0].type, "condition");
  assert.equal(next.children[1].type, "condition");
  assert.notEqual(next.children[0].id, next.children[1].id);
});

test("appendGroupChild can add a nested OR group for advanced rule combinations", () => {
  const base = makeEmptyGroupDraft("and");
  const next = appendGroupChild(base, { childType: "group", operator: "or" });

  assert.equal(next.children.length, 2);
  assert.equal(next.children[1].type, "group");
  assert.equal(next.children[1].operator, "or");
  assert.equal(next.children[1].children.length, 1);
  assert.equal(next.children[1].children[0].type, "condition");
});

test("appendActionDraft appends a new trailing action without mutating earlier items", () => {
  const existing = [{ id: "action_1", type: "trade.open.long" }];
  const next = appendActionDraft(existing, "notify.toast");

  assert.equal(existing.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[0].type, "trade.open.long");
  assert.equal(next[1].type, "notify.toast");
  assert.notEqual(next[0].id, next[1].id);
});

test("makeEmptyConditionDraft keeps the expected default operands", () => {
  const node = makeEmptyConditionDraft();

  assert.deepEqual(
    { comparator: node.comparator, left: node.left, right: node.right, type: node.type },
    {
      type: "condition",
      comparator: ">",
      left: { kind: "var", value: "indicators.ema_fast" },
      right: { kind: "var", value: "indicators.ema_slow" },
    },
  );
});

test("ensureGroupRootDraft wraps a single condition so top-level group controls stay visible", () => {
  const condition = makeEmptyConditionDraft();
  const next = ensureGroupRootDraft(condition);

  assert.equal(next.type, "group");
  assert.equal(next.operator, "and");
  assert.equal(next.children.length, 1);
  assert.equal(next.children[0].id, condition.id);
});
