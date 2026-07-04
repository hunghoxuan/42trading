const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "settings-store-"));
}

test("settingsStore migrates legacy settings files into canonical object-store folders and removes legacy files", async () => {
  const projectRoot = makeTempProjectRoot();
  const usersRoot = path.join(projectRoot, "data", "users");
  const userSettingsDir = path.join(usersRoot, "alice", "settings");
  fs.mkdirSync(path.join(userSettingsDir, "settings"), { recursive: true });
  fs.mkdirSync(path.join(userSettingsDir, "notification_config"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(userSettingsDir, "api_key"), { recursive: true });
  fs.writeFileSync(
    path.join(userSettingsDir, "settings", "ANALYSE_SETTINGS.json"),
    JSON.stringify({ data: { theme: "dark" } }),
  );
  fs.writeFileSync(
    path.join(userSettingsDir, "notification_config", "trade_added.json"),
    JSON.stringify({ data: { toast: true } }),
  );
  fs.writeFileSync(
    path.join(userSettingsDir, "api_key", "OPENAI_API_KEY.json"),
    JSON.stringify({ data: { value: "sk-test" } }),
  );

  const objectStorePath = require.resolve("../objects/objectStoreRepo");
  const settingsStorePath = require.resolve("./settingsStore");
  delete require.cache[objectStorePath];
  delete require.cache[settingsStorePath];
  process.env.OBJECT_STORE_PROJECT_ROOT = projectRoot;

  const settingsStore = require("./settingsStore");

  const analyse = await settingsStore.getUserSettingData(
    "alice",
    "settings",
    "ANALYSE_SETTINGS",
  );
  const notification = await settingsStore.getUserSettingData(
    "alice",
    "notification_config",
    "trade_added",
  );
  const apiKey = await settingsStore.getUserSettingData(
    "alice",
    "api_key",
    "OPENAI_API_KEY",
  );

  assert.deepEqual(analyse, { theme: "dark" });
  assert.deepEqual(notification, { toast: true });
  assert.deepEqual(apiKey, { value: "sk-test" });

  assert.equal(
    fs.existsSync(
      path.join(
        usersRoot,
        "alice",
        "settings_store",
        "settings_ANALYSE_SETTINGS",
        "data.json",
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        usersRoot,
        "alice",
        "settings_store",
        "notification_config_preferences",
        "data.json",
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(usersRoot, "alice", "providers", "OPENAI", "data.json"),
    ),
    true,
  );

  assert.equal(
    fs.existsSync(path.join(userSettingsDir, "settings", "ANALYSE_SETTINGS.json")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(userSettingsDir, "notification_config", "trade_added.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(userSettingsDir, "api_key", "OPENAI_API_KEY.json")),
    false,
  );

  delete process.env.OBJECT_STORE_PROJECT_ROOT;
  delete require.cache[objectStorePath];
  delete require.cache[settingsStorePath];
});
