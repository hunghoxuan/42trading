# Rule Definitions

This folder is reserved for user-editable JSON rule definitions that conform to
`src/config/schema/rule.json`.

Built-in rules live in JavaScript under `src/shared/rules-engine/predefinedRules.js`
because many detector families need executable helpers, feature builders, or
multi-bar algorithms. JSON rules should stay declarative and portable.

Rule definitions describe reusable conditions. The shared rule engine evaluates
them against bars and context, then emits rule events.
