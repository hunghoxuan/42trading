const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("fs");
const path = require("path");

const {
  buildCodexExecArgs,
  buildCodexChatPrompt,
  classifyCodexIntent,
  runCodexChat,
  streamCodexChat,
  tryParseCodexEvent,
} = require("./codexBridge");

test("buildCodexChatPrompt includes repo, route, detected context, trade context, and transcript", () => {
  const prompt = buildCodexChatPrompt({
    repoRoot: "/tmp/42trade",
    route: "/trades/ABC123XYZ",
    userRole: "system",
    routeContext: {
      route: "/trades/ABC123XYZ",
      detected_trade_sid: "ABC123XYZ",
      detected_symbol: "BTCUSD",
    },
    tradeContext: { sid: "ABC123XYZ", symbol: "BTCUSD" },
    messages: [
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "Fix the AI route." },
    ],
  });

  assert.match(prompt, /Repository root: \/tmp\/42trade/);
  assert.match(prompt, /UI route: \/trades\/ABC123XYZ/);
  assert.match(prompt, /Detected route context JSON:/);
  assert.match(prompt, /"detected_symbol": "BTCUSD"/);
  assert.match(prompt, /"symbol": "BTCUSD"/);
  assert.match(prompt, /ASSISTANT:\nHow can I help\?/);
  assert.match(prompt, /USER:\nFix the AI route\./);
  assert.match(prompt, /Latest user request:\nFix the AI route\./);
});

test("classifyCodexIntent keeps snapshot-style requests in context mode", () => {
  assert.equal(classifyCodexIntent("show me latest snapshot of btcusd"), "context_answer");
  assert.equal(classifyCodexIntent("what trade is this?"), "context_answer");
  assert.equal(classifyCodexIntent("fix the btcusd snapshot routing"), "repo_task");
});

test("buildCodexChatPrompt tells Codex not to report code changes for context answers", () => {
  const prompt = buildCodexChatPrompt({
    repoRoot: "/tmp/42trade",
    route: "/ai/analyze/EURUSD",
    userRole: "system",
    routeContext: {
      route: "/ai/analyze/EURUSD",
      detected_symbol: "BTCUSD",
      market_context: {
        symbol: "BTCUSD",
        latest_snapshot_file: "BTCUSD_master.png",
        latest_snapshot_path: "data/market_data/BTCUSD/BTCUSD_master.png",
      },
    },
    messages: [
      { role: "user", content: "show me latest snapshot of btcusd" },
    ],
  });

  assert.match(prompt, /Detected latest request intent: context_answer/);
  assert.match(prompt, /Do not edit files, do not describe code changes/);
  assert.match(prompt, /latest snapshot/);
  assert.match(prompt, /BTCUSD_master\.png/);
});

test("buildCodexChatPrompt keeps analyze snapshot prompts in context mode", () => {
  const prompt = buildCodexChatPrompt({
    repoRoot: "/tmp/42trade",
    route: "/ai/analyze/GBPUSD",
    userRole: "system",
    routeContext: {
      route: "/ai/analyze/GBPUSD",
      detected_symbol: "GBPUSD",
      analyze_mode: "snapshot_files",
      requested_symbols: ["GBPUSD"],
      requested_timeframes: ["D", "4H", "15M", "5M"],
      symbol_files: [{ symbol: "GBPUSD", files: ["GBPUSD_MASTER.png"] }],
    },
    messages: [
      {
        role: "user",
        content: [
          "## SESSION CONFIG",
          "Symbols: GBPUSD",
          "Use only this snapshot file for the symbol.",
          "Return your response as JSON exactly matching this structure:",
          "Use only the attached chart image evidence.",
          "If structure is unclear, return NO_TRADE_ABORT.",
        ].join("\n"),
      },
    ],
  });

  assert.match(prompt, /Detected latest request intent: context_answer/);
  assert.doesNotMatch(prompt, /The latest request is a repo task\./);
  assert.match(prompt, /GBPUSD_MASTER\.png/);
});

test("buildCodexChatPrompt keeps schema-heavy analyze prompts in context mode", () => {
  const prompt = buildCodexChatPrompt({
    repoRoot: "/tmp/42trade",
    route: "/ai/analyze/EURUSD",
    userRole: "system",
    routeContext: {
      route: "/ai/analyze/EURUSD",
      detected_symbol: "EURUSD",
      analyze_mode: "snapshot_files",
      requested_symbols: ["EURUSD"],
      requested_timeframes: ["D", "4H", "15M", "5M"],
      symbol_files: [{ symbol: "EURUSD", files: ["EURUSD_MASTER.png"] }],
    },
    messages: [
      {
        role: "user",
        content: [
          "## SESSION CONFIG",
          "Symbols: EURUSD",
          "## PHASE 1: TOP-DOWN MARKET ANALYSIS EXECUTION",
          "## PRICE PRECISION RULE (MANDATORY)",
          "Respond ONLY in valid minified JSON matching schema exactly.",
          "IMPORTANT: You MUST include execution_plan with entry, stop_loss, tp1/tp2/tp3 populated.",
          "You are an expert ICT technical analyst.",
          "schema_version=3.1",
        ].join("\n"),
      },
    ],
  });

  assert.match(prompt, /Detected latest request intent: context_answer/);
  assert.doesNotMatch(prompt, /The latest request is a repo task\./);
  assert.match(prompt, /EURUSD_MASTER\.png/);
});

test("buildCodexExecArgs resumes a persistent thread when one exists", () => {
  assert.deepEqual(
    buildCodexExecArgs({
      repoRoot: "/tmp/42trade",
      threadId: "thread_123",
      outputFile: "/tmp/out.txt",
    }),
    [
      "exec",
      "resume",
      "--json",
      "--output-last-message",
      "/tmp/out.txt",
      "--dangerously-bypass-approvals-and-sandbox",
      "thread_123",
      "-",
    ],
  );
});

test("buildCodexExecArgs includes image attachments for codex vision runs", () => {
  assert.deepEqual(
    buildCodexExecArgs({
      repoRoot: "/tmp/42trade",
      outputFile: "/tmp/out.txt",
      imagePaths: ["/tmp/a.png", "/tmp/b.png"],
    }),
    [
      "exec",
      "--cd",
      "/tmp/42trade",
      "--color",
      "never",
      "-i",
      "/tmp/a.png",
      "-i",
      "/tmp/b.png",
      "--json",
      "--output-last-message",
      "/tmp/out.txt",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ],
  );
});

test("tryParseCodexEvent ignores logs and parses json events", () => {
  assert.equal(tryParseCodexEvent("2026-01-01 WARN noisy log"), null);
  assert.deepEqual(
    tryParseCodexEvent('{"type":"thread.started","thread_id":"abc"}'),
    { type: "thread.started", thread_id: "abc" },
  );
});

test("streamCodexChat parses thread and agent events from codex json output", async () => {
  let recorded = null;
  const seenThreadIds = [];
  const seenAgentMessages = [];

  function spawnStub(command, args) {
    recorded = { command, args };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write() {
        process.nextTick(() => {
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"thread.started","thread_id":"thread_abc"}\n'),
          );
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Handled prompt from stream"}}\n'),
          );
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n'),
          );
        });
      },
      end() {
        setTimeout(() => child.emit("close", 0), 10);
      },
    };
    child.kill = () => {};
    return child;
  }

  const result = await streamCodexChat({
    repoRoot: "/tmp/42trade",
    route: "/settings",
    userRole: "system",
    messages: [{ role: "user", content: "Inspect the providers page." }],
    codexBin: "/tmp/mock-codex",
    timeoutMs: 5000,
    spawnImpl: spawnStub,
    onThreadStarted: (threadId) => seenThreadIds.push(threadId),
    onAgentMessage: (text) => seenAgentMessages.push(text),
  });

  assert.equal(recorded.command, "/tmp/mock-codex");
  assert.ok(recorded.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(recorded.args.includes("--json"));
  assert.equal(result.threadId, "thread_abc");
  assert.equal(result.reply, "Handled prompt from stream");
  assert.deepEqual(seenThreadIds, ["thread_abc"]);
  assert.deepEqual(seenAgentMessages, ["Handled prompt from stream"]);
});

test("runCodexChat returns the final parsed codex reply", async () => {
  function spawnStub(command, args) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write() {
        process.nextTick(() => {
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Final codex reply"}}\n'),
          );
        });
      },
      end() {
        setTimeout(() => child.emit("close", 0), 10);
      },
    };
    child.kill = () => {};
    return child;
  }

  const result = await runCodexChat({
    repoRoot: "/tmp/42trade",
    route: "/settings",
    userRole: "system",
    messages: [{ role: "user", content: "Inspect the providers page." }],
    codexBin: "/tmp/mock-codex",
    timeoutMs: 5000,
    spawnImpl: spawnStub,
  });

  assert.equal(result.reply, "Final codex reply");
});

test("streamCodexChat resolves cleanly when stopped by controller", async () => {
  let control = null;

  function spawnStub() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write() {
        process.nextTick(() => {
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Partial reply"}}\n'),
          );
          setTimeout(() => child.emit("close", 0), 20);
        });
      },
      end() {},
    };
    child.kill = () => {};
    return child;
  }

  const resultPromise = streamCodexChat({
    repoRoot: "/tmp/42trade",
    route: "/settings",
    userRole: "system",
    messages: [{ role: "user", content: "Stop me." }],
    codexBin: "/tmp/mock-codex",
    timeoutMs: 5000,
    spawnImpl: spawnStub,
    onSpawn: (nextControl) => {
      control = nextControl;
      setTimeout(() => control?.stop?.(), 5);
    },
  });

  const result = await resultPromise;
  assert.equal(result.stopped, true);
  assert.equal(result.reply, "Partial reply");
});
