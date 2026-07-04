function createRuleNodeId(prefix = "node") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function makeEmptyConditionDraft() {
  return {
    id: createRuleNodeId("condition"),
    type: "condition",
    mode: "compare",
    comparator: ">",
    left: { kind: "var", value: "indicators.ema_fast" },
    right: { kind: "var", value: "indicators.ema_slow" },
    functionName: "retest",
    args: [{ kind: "var", value: "levels.pd_mid" }],
    target: null,
  };
}

export function makeEmptyGroupDraft(operator = "and") {
  return {
    id: createRuleNodeId("group"),
    type: "group",
    operator:
      operator === "or" ? "or" : operator === "then" ? "then" : "and",
    children: [makeEmptyConditionDraft()],
  };
}

export function ensureGroupRootDraft(node) {
  if (!node) return makeEmptyGroupDraft("and");
  if (node.type === "group") return node;
  return {
    id: createRuleNodeId("group"),
    type: "group",
    operator: "and",
    children: [node],
  };
}

export function appendGroupChild(group, { childType = "condition", operator = "and" } = {}) {
  if (!group || group.type !== "group") return group;
  const nextChild =
    childType === "group" ? makeEmptyGroupDraft(operator) : makeEmptyConditionDraft();
  return {
    ...group,
    children: [...(Array.isArray(group.children) ? group.children : []), nextChild],
  };
}

export function appendActionDraft(actions = [], action = "trade") {
  const actionType = String(action || "trade").trim() || "trade";
  return [
    ...actions,
    {
      id: createRuleNodeId("action"),
      action: actionType,
      type: actionType,
      trade_plan:
        actionType === "trade"
          ? {
              direction: "buy",
              type: "market",
              entry: null,
              sl: null,
              tp: null,
              tp1: null,
              tp2: null,
              tp3: null,
              rr: null,
              entry_model: "",
            }
          : undefined,
      message:
        actionType === "notify.toast" ||
        actionType === "notify.notification" ||
        actionType === "chart.note"
          ? ""
          : undefined,
      url: actionType === "webhook.post" ? "" : undefined,
      method: actionType === "webhook.post" ? "POST" : undefined,
    },
  ];
}
