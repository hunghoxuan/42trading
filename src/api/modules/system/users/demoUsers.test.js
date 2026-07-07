const test = require("node:test");
const assert = require("node:assert/strict");

const { seedDemoUsers, getDemoUsers } = require("./demoUsers");

function createInMemoryRepo(initialUsers = []) {
  const users = new Map(initialUsers.map((user) => [user.user_id, { ...user }]));
  return {
    async getUserById(userId) {
      return users.get(userId) || null;
    },
    async listUsers() {
      return Array.from(users.values()).map((user) => ({ ...user }));
    },
    async upsertUser(user) {
      users.set(user.user_id, { ...user });
      return { ok: true, user: { ...user } };
    },
    async deleteUserById(userId) {
      users.delete(userId);
      return { ok: true };
    },
  };
}

test("seedDemoUsers seeds the configured demo accounts", async () => {
  const repo = createInMemoryRepo();
  let saltCounter = 0;
  const env = {
    UI_DEMO_USER_USERNAME: "user",
    UI_DEMO_USER_PASSWORD: "user-pass",
    UI_DEMO_USER_EMAIL: "user@example.test",
    UI_DEMO_SELLER_USERNAME: "seller",
    UI_DEMO_SELLER_PASSWORD: "seller-pass",
    UI_DEMO_SELLER_EMAIL: "seller@example.test",
    UI_DEMO_TRADER_USERNAME: "trader",
    UI_DEMO_TRADER_PASSWORD: "trader-pass",
    UI_DEMO_TRADER_EMAIL: "trader@example.test",
  };
  const result = await seedDemoUsers(repo, {
    makeSalt: () => `salt-${++saltCounter}`,
    hashPassword: (password, salt) => `hash(${password}|${salt})`,
    now: "2026-07-01T00:00:00.000Z",
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(result.written, 3);

  const users = await repo.listUsers();
  assert.equal(users.length, 3);
  assert.deepEqual(
    users.map((user) => ({
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      password_salt: user.password_salt,
      password_hash: user.password_hash,
    })),
    [
      {
        user_id: "user",
        name: "user",
        email: "user@example.test",
        roles: ["buyer"],
        password_salt: "salt-1",
        password_hash: "hash(user-pass|salt-1)",
      },
      {
        user_id: "seller",
        name: "seller",
        email: "seller@example.test",
        roles: ["seller"],
        password_salt: "salt-2",
        password_hash: "hash(seller-pass|salt-2)",
      },
      {
        user_id: "trader",
        name: "trader",
        email: "trader@example.test",
        roles: ["trader"],
        password_salt: "salt-3",
        password_hash: "hash(trader-pass|salt-3)",
      },
    ],
  );
});

test("seedDemoUsers refreshes existing demo accounts to the canonical role and password set", async () => {
  const repo = createInMemoryRepo([
    {
      user_id: "seller",
      name: "seller",
      email: "seller@example.test",
      roles: ["seller"],
      is_active: true,
      password_salt: "existing-salt",
      password_hash: "existing-hash",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      metadata: { demo: true },
    },
  ]);
  const env = {
    UI_DEMO_USER_USERNAME: "user",
    UI_DEMO_USER_PASSWORD: "user-pass",
    UI_DEMO_SELLER_USERNAME: "seller",
    UI_DEMO_SELLER_PASSWORD: "seller-pass",
    UI_DEMO_TRADER_USERNAME: "trader",
    UI_DEMO_TRADER_PASSWORD: "trader-pass",
  };

  const result = await seedDemoUsers(repo, {
    makeSalt: () => "unused",
    hashPassword: (password, salt) => `${password}:${salt}`,
    now: "2026-07-01T00:00:00.000Z",
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(result.written, 3);

  const seller = await repo.getUserById("seller");
  assert.equal(seller.password_salt, "unused");
  assert.equal(seller.password_hash, "seller-pass:unused");
  assert.deepEqual(seller.roles, ["seller"]);

  const trader = await repo.getUserById("trader");
  assert.equal(trader.password_salt, "unused");
  assert.equal(trader.password_hash, "trader-pass:unused");
  assert.deepEqual(trader.roles, ["trader"]);

  const users = await repo.listUsers();
  assert.equal(users.length, getDemoUsers(env).length);
});

test("seedDemoUsers migrates legacy 42pay demo ids to the new user and seller ids", async () => {
  const repo = createInMemoryRepo([
    {
      user_id: "42pay.buyer",
      name: "42pay.buyer",
      email: "42pay.buyer@example.test",
      roles: ["buyer"],
      is_active: true,
      password_salt: "old-user-salt",
      password_hash: "old-user-hash",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    {
      user_id: "42pay.seller",
      name: "42pay.seller",
      email: "42pay.seller@example.test",
      roles: ["seller"],
      is_active: true,
      password_salt: "old-seller-salt",
      password_hash: "old-seller-hash",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    {
      user_id: "42pay.admin",
      name: "42pay.admin",
      email: "42pay.admin@example.test",
      roles: ["admin"],
      is_active: true,
      password_salt: "old-admin-salt",
      password_hash: "old-admin-hash",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  const env = {
    UI_DEMO_USER_USERNAME: "user",
    UI_DEMO_USER_PASSWORD: "user-pass",
    UI_DEMO_SELLER_USERNAME: "seller",
    UI_DEMO_SELLER_PASSWORD: "seller-pass",
    UI_DEMO_TRADER_USERNAME: "trader",
    UI_DEMO_TRADER_PASSWORD: "trader-pass",
  };

  const result = await seedDemoUsers(repo, {
    makeSalt: () => "salt",
    hashPassword: (password, salt) => `${password}:${salt}`,
    now: "2026-07-01T00:00:00.000Z",
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(await repo.getUserById("42pay.buyer"), null);
  assert.equal(await repo.getUserById("42pay.seller"), null);
  assert.equal(await repo.getUserById("42pay.admin"), null);

  const migratedUser = await repo.getUserById("user");
  const migratedSeller = await repo.getUserById("seller");
  const migratedTrader = await repo.getUserById("trader");
  assert.equal(migratedUser.email, "user@example.test");
  assert.equal(migratedUser.password_hash, "user-pass:salt");
  assert.equal(migratedSeller.email, "seller@example.test");
  assert.equal(migratedSeller.password_hash, "seller-pass:salt");
  assert.equal(migratedTrader.password_hash, "trader-pass:salt");
});
