const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createChatStore,
  resolveChatRootDir,
} = require("./chatStore");

function makeTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chat-store-"));
}

test("resolveChatRootDir stores chat data under data/users/<user>/chat", () => {
  const projectRoot = "/tmp/forty-two-trade";
  assert.equal(
    resolveChatRootDir("alice", { projectRoot }),
    path.join(projectRoot, "data", "users", "alice", "chat"),
  );
  assert.equal(
    resolveChatRootDir("", { projectRoot }),
    path.join(projectRoot, "data", "users", "default", "chat"),
  );
});

test("chatStore persists conversations and per-message json files", async () => {
  const projectRoot = makeTempProjectRoot();
  const store = createChatStore({ projectRoot });

  const conversation = await store.saveConversation("alice", {
    conversation_id: "conv_alpha",
    mode: "codex",
    route: "/trades/ABC123XYZ",
    title: "Fix AI chat",
    codex_thread_id: "thread_123",
  });

  assert.equal(conversation.conversation_id, "conv_alpha");
  assert.equal(conversation.mode, "codex");
  assert.equal(conversation.codex_thread_id, "thread_123");

  const userMessage = await store.saveMessage("alice", "conv_alpha", {
    message_id: "msg_user_1",
    role: "user",
    parts: [{ type: "text", text: "Fix the AI chat route." }],
  });
  const assistantMessage = await store.saveMessage("alice", "conv_alpha", {
    message_id: "msg_assistant_1",
    role: "assistant",
    parts: [{ type: "text", text: "I updated the route." }],
  });

  assert.equal(userMessage.message_id, "msg_user_1");
  assert.equal(assistantMessage.role, "assistant");

  const list = await store.listConversations("alice");
  assert.equal(list.length, 1);
  assert.equal(list[0].conversation_id, "conv_alpha");
  assert.equal(list[0].message_count, 2);
  assert.match(list[0].preview, /I updated the route/);

  const loaded = await store.getConversationWithMessages("alice", "conv_alpha");
  assert.equal(loaded.conversation.conversation_id, "conv_alpha");
  assert.equal(loaded.conversation.codex_thread_id, "thread_123");
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.messages[0].message_id, "msg_user_1");
  assert.equal(loaded.messages[1].message_id, "msg_assistant_1");

  const conversationOnly = await store.getConversation("alice", "conv_alpha");
  assert.equal(conversationOnly.codex_thread_id, "thread_123");

  const messageFile = path.join(
    projectRoot,
    "data",
    "users",
    "alice",
    "chat",
    "conversations",
    "conv_alpha",
    "messages",
    "msg_user_1.json",
  );
  assert.equal(fs.existsSync(messageFile), true);
});
