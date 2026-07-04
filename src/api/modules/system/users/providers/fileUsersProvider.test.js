const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createFileUsersProvider } = require("./fileUsersProvider");

function makeTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "file-users-provider-"));
}

test("fileUsersProvider migrates legacy system user json files into canonical object-store folders", async () => {
  const projectRoot = makeTempProjectRoot();
  const legacyRoot = path.join(projectRoot, "data", "system", "users");
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(
    path.join(legacyRoot, "alice.json"),
    JSON.stringify({ user_id: "alice", email: "alice@example.test" }),
  );

  const provider = createFileUsersProvider({
    rootDir: legacyRoot,
    objectStore: {
      provider: "json",
      projectRoot,
      dataRoot: path.join(projectRoot, "data", "users"),
      cache: { provider: "memory" },
    },
  });

  const user = await provider.getUserById("alice");
  assert.equal(user.email, "alice@example.test");

  const canonicalPath = path.join(
    projectRoot,
    "data",
    "users",
    "__system__",
    "system_users",
    "alice",
    "data.json",
  );
  assert.equal(fs.existsSync(canonicalPath), true);
  assert.equal(fs.existsSync(path.join(legacyRoot, "alice.json")), false);
});
