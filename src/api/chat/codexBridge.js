"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_CODEX_BIN = String(
  process.env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex",
).trim();
const DEFAULT_TIMEOUT_MS = 240000;
const MAX_OUTPUT_CHARS = 12000;

function clipText(value, maxChars = MAX_OUTPUT_CHARS) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars))}\n...[truncated ${text.length - maxChars} chars]`;
}

function normalizeRole(value = "") {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  return role === "assistant" ? "assistant" : "user";
}

function buildTranscript(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  return items
    .map((message) => {
      const role = normalizeRole(message?.role).toUpperCase();
      const content = String(message?.content || "").trim();
      if (!content) return "";
      return `${role}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function classifyCodexIntent(message = "") {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return "context_answer";

  const repoTaskPatterns = [
    /\bfix\b/,
    /\bbug\b/,
    /\bimplement\b/,
    /\badd\b/,
    /\bupdate\b/,
    /\bchange\b/,
    /\bedit\b/,
    /\brefactor\b/,
    /\bwire\b/,
    /\bpatch\b/,
    /\bcreate\b/,
    /\bremove\b/,
    /\brename\b/,
    /\bcleanup\b/,
    /\bdebug\b/,
    /\btest\b/,
    /\breview\b/,
    /\bbuild\b/,
    /\bcompile\b/,
    /\broute\b/,
    /\bendpoint\b/,
    /\bcomponent\b/,
    /\bui\b/,
    /\bapi\b/,
    /\bserver\b/,
    /\brepo\b/,
    /\bcode\b/,
    /\bfile\b/,
    /\bsrc\/\b/,
    /\bpackage\.json\b/,
    /\b\.jsx?\b/,
    /\b\.tsx?\b/,
    /\b\.py\b/,
  ];

  return repoTaskPatterns.some((pattern) => pattern.test(text))
    ? "repo_task"
    : "context_answer";
}

function isAnalyzeContextRequest({
  route = "/",
  routeContext = null,
  message = "",
}) {
  const routeText = String(route || "").trim().toLowerCase();
  const analyzeMode = String(routeContext?.analyze_mode || "")
    .trim()
    .toLowerCase();
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;

  const onAnalyzeRoute =
    routeText.startsWith("/ai/analyze") || Boolean(analyzeMode);
  if (!onAnalyzeRoute) return false;

  return [
    "## session config",
    "## phase 1: top-down market analysis execution",
    "## analysis instructions",
    "## expected output schema",
    "## price precision rule",
    "multi_symbol_input=",
    "attached chart image evidence",
    "no_trade_abort",
    "trade_plan",
    "execution_plan",
    "respond only in valid minified json matching schema exactly",
    "you are an expert ict technical analyst",
    "schema_version=3.1",
  ].some((marker) => text.includes(marker));
}

function buildCodexChatPrompt({
  messages = [],
  route = "/",
  userRole = "user",
  tradeContext = null,
  routeContext = null,
  repoRoot = "",
}) {
  const transcript = buildTranscript(messages);
  const latestUserMessage = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => normalizeRole(message?.role) === "user");
  const latestUserText = String(latestUserMessage?.content || "").trim();
  let intent = classifyCodexIntent(latestUserText);
  if (
    intent === "repo_task" &&
    isAnalyzeContextRequest({
      route,
      routeContext,
      message: latestUserText,
    })
  ) {
    intent = "context_answer";
  }
  const promptParts = [
    "You are Codex operating inside the 42Trade repository.",
    "First classify the latest user request as either `repo_task` or `context_answer`.",
    "Use `repo_task` only when the user is clearly asking for a code, file, repo, bugfix, implementation, refactor, or verification task.",
    "Use `context_answer` for product questions, route questions, trade questions, symbol questions, snapshot requests, and requests to explain or show current data/context.",
    `Repository root: ${String(repoRoot || "").trim() || "."}`,
    `UI route: ${String(route || "/").trim() || "/"}`,
    `UI user role: ${String(userRole || "user").trim() || "user"}`,
    `Detected latest request intent: ${intent}`,
  ];

  if (intent === "repo_task") {
    promptParts.push(
      "The latest request is a repo task.",
      "Inspect the codebase, make the smallest safe change that satisfies the latest request, and verify your work when feasible.",
      "You may read and edit files in the repository.",
      "If you run verification, report only checks you actually ran and their result.",
      "Keep the final response concise and implementation-focused.",
    );
  } else {
    promptParts.push(
      "The latest request is NOT a repo task.",
      "Do not edit files, do not describe code changes, and do not return an implementation report.",
      "Answer the user directly from the provided route, trade, market, and conversation context.",
      "If the user asks for the latest snapshot, return the most relevant latest snapshot file/path you can infer from the provided context and say plainly if no snapshot is available.",
      "Keep the final response concise and user-facing.",
    );
  }

  if (tradeContext) {
    promptParts.push(
      `Trade context JSON:\n${JSON.stringify(tradeContext, null, 2)}`,
    );
  }

  if (routeContext) {
    promptParts.push(
      `Detected route context JSON:\n${JSON.stringify(routeContext, null, 2)}`,
    );
  }

  if (transcript) {
    promptParts.push(`Conversation transcript:\n${transcript}`);
  }

  if (latestUserMessage?.content) {
    promptParts.push(
      `Latest user request:\n${String(latestUserMessage.content).trim()}`,
    );
  }

  return promptParts.join("\n\n");
}

function resolveCodexBin(explicitBin = "") {
  const candidate = String(explicitBin || DEFAULT_CODEX_BIN).trim();
  return candidate || "codex";
}

function createJsonLineSplitter(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += String(chunk || "");
    let splitIndex = buffer.indexOf("\n");
    while (splitIndex >= 0) {
      const line = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex + 1);
      if (line) onLine(line);
      splitIndex = buffer.indexOf("\n");
    }
  };
}

function tryParseCodexEvent(line = "") {
  const text = String(line || "").trim();
  if (!text.startsWith("{")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildCodexExecArgs({
  repoRoot,
  threadId = "",
  outputFile = "",
  imagePaths = [],
}) {
  const args = threadId ? ["exec", "resume"] : ["exec"];
  if (!threadId) {
    args.push("--cd", repoRoot, "--color", "never");
  }
  for (const imagePath of Array.isArray(imagePaths) ? imagePaths : []) {
    const safePath = String(imagePath || "").trim();
    if (safePath) args.push("-i", safePath);
  }
  args.push("--json");
  if (outputFile) {
    args.push("--output-last-message", outputFile);
  }
  args.push("--dangerously-bypass-approvals-and-sandbox");
  if (threadId) {
    args.push(String(threadId).trim());
  }
  args.push("-");
  return args;
}

function streamCodexChat({
  messages = [],
  route = "/",
  userRole = "user",
  tradeContext = null,
  routeContext = null,
  repoRoot,
  codexThreadId = "",
  codexBin = "",
  imagePaths = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  onSpawn = null,
  onEvent = null,
  onThreadStarted = null,
  onAgentMessage = null,
  onCommandStarted = null,
  onCommandCompleted = null,
}) {
  const resolvedRepoRoot = path.resolve(String(repoRoot || process.cwd()));
  const prompt = buildCodexChatPrompt({
    messages,
    route,
    userRole,
    tradeContext,
    routeContext,
    repoRoot: resolvedRepoRoot,
  });
  if (!prompt.trim()) {
    return Promise.resolve({
      reply: "Codex mode is ready.",
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      threadId: String(codexThreadId || "").trim(),
      usage: null,
      events: [],
    });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-"));
  const outputFile = path.join(tmpDir, "last-message.txt");
  const args = buildCodexExecArgs({
    repoRoot: resolvedRepoRoot,
    threadId: codexThreadId,
    outputFile,
    imagePaths,
  });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let stopRequested = false;
    let child;
    let lastAgentMessage = "";
    let activeThreadId = String(codexThreadId || "").trim();
    let usage = null;
    const events = [];

    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    const handleEvent = (event) => {
      events.push(event);
      onEvent?.(event);
      if (event?.type === "thread.started" && event.thread_id) {
        activeThreadId = String(event.thread_id || "").trim();
        onThreadStarted?.(activeThreadId, event);
        return;
      }
      if (event?.type === "item.started" && event.item?.type === "command_execution") {
        onCommandStarted?.(event.item);
        return;
      }
      if (event?.type === "item.completed" && event.item?.type === "command_execution") {
        onCommandCompleted?.(event.item);
        return;
      }
      if (event?.type === "item.completed" && event.item?.type === "agent_message") {
        const text = String(event.item?.text || "").trim();
        if (text) {
          lastAgentMessage = text;
          onAgentMessage?.(text, event.item, event);
        }
        return;
      }
      if (event?.type === "turn.completed" && event.usage) {
        usage = event.usage;
      }
    };

    try {
      child = spawnImpl(resolveCodexBin(codexBin), args, {
        cwd: resolvedRepoRoot,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      onSpawn?.({
        stop() {
          stopRequested = true;
          try {
            child.kill("SIGTERM");
          } catch {}
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 1500).unref?.();
        },
      });
    } catch (error) {
      finish(error);
      return;
    }

    const handleStdoutLine = createJsonLineSplitter((line) => {
      stdout += `${line}\n`;
      const event = tryParseCodexEvent(line);
      if (event) handleEvent(event);
    });

    child.stdout.on("data", (chunk) => {
      handleStdoutLine(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", (error) => {
      finish(error);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1500).unref?.();
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    child.on("close", (code) => {
      let reply = lastAgentMessage;
      try {
        if (!reply && fs.existsSync(outputFile)) {
          reply = String(fs.readFileSync(outputFile, "utf8") || "").trim();
        }
      } catch {}

      if (stopRequested) {
        finish(null, {
          reply: lastAgentMessage || "",
          exitCode: Number(code || 0),
          stdout: clipText(stdout),
          stderr: clipText(stderr),
          timedOut: false,
          stopped: true,
          threadId: activeThreadId,
          usage,
          events,
        });
        return;
      }

      if (timedOut) {
        finish(
          new Error(
            `Codex execution timed out after ${Math.round((Number(timeoutMs) || DEFAULT_TIMEOUT_MS) / 1000)}s.`,
          ),
        );
        return;
      }

      if (code !== 0) {
        const detail = [reply, clipText(stderr), clipText(stdout)]
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .join("\n\n");
        finish(
          new Error(
            detail || `Codex exited with code ${code == null ? "unknown" : code}.`,
          ),
        );
        return;
      }

      finish(null, {
        reply: reply || "Codex completed without a final message.",
        exitCode: Number(code || 0),
        stdout: clipText(stdout),
        stderr: clipText(stderr),
        timedOut: false,
        stopped: false,
        threadId: activeThreadId,
        usage,
        events,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function runCodexChat({
  messages = [],
  route = "/",
  userRole = "user",
  tradeContext = null,
  routeContext = null,
  codexThreadId = "",
  repoRoot,
  codexBin = "",
  imagePaths = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
}) {
  return streamCodexChat({
    messages,
    route,
    userRole,
    tradeContext,
    routeContext,
    codexThreadId,
    repoRoot,
    codexBin,
    imagePaths,
    timeoutMs,
    spawnImpl,
  });
}

module.exports = {
  buildCodexChatPrompt,
  buildCodexExecArgs,
  classifyCodexIntent,
  streamCodexChat,
  tryParseCodexEvent,
  runCodexChat,
};
