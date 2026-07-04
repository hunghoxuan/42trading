export function parseTextList(value, options = {}) {
  const uppercase =
    typeof options === "boolean" ? options : Boolean(options?.uppercase);
  return [
    ...new Set(
      String(value || "")
        .split(/[\n,]/)
        .map((s) => {
          const trimmed = s.trim();
          return uppercase ? trimmed.toUpperCase() : trimmed;
        })
        .filter(Boolean),
    ),
  ];
}
