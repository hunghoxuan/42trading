"use strict";

function buildTranscriptPrompt(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  return items
    .map((message) => {
      const role = String(message?.role || "user")
        .trim()
        .toUpperCase();
      const content = String(message?.content || "").trim();
      if (!content) return "";
      return `${role}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function generateAiChatReply({
  apiKey,
  messages = [],
  model = "gpt-4o-mini",
  systemPrompt = "",
  timeoutMs = 45000,
}) {
  const resolvedKey = String(apiKey || "").trim();
  if (!resolvedKey) {
    throw new Error("OPENAI_API_KEY is missing in Settings.");
  }

  const [{ generateText }, { createOpenAI }] = await Promise.all([
    import("ai"),
    import("@ai-sdk/openai"),
  ]);

  const openai = createOpenAI({ apiKey: resolvedKey });
  const prompt = buildTranscriptPrompt(messages);

  if (!prompt) {
    return "I'm ready when you are.";
  }

  const result = await Promise.race([
    generateText({
      model: openai(model),
      system: String(systemPrompt || "").trim(),
      prompt,
      temperature: 0.3,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI chat request timed out.")), timeoutMs),
    ),
  ]);

  return String(result?.text || "").trim();
}

module.exports = {
  generateAiChatReply,
};
