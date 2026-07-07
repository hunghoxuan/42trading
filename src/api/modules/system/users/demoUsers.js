"use strict";

const DEFAULT_DEMO_PASSWORD = "123456";
const LEGACY_DEMO_USER_IDS = {
  user: "42pay.buyer",
  seller: "42pay.seller",
};
const LEGACY_REMOVED_USER_IDS = ["42pay.admin"];

function text(value, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function getDemoUsers(env = process.env) {
  const userUsername = text(env.UI_DEMO_USER_USERNAME, "user");
  const sellerUsername = text(env.UI_DEMO_SELLER_USERNAME, "seller");
  const traderUsername = text(env.UI_DEMO_TRADER_USERNAME, "trader");
  return [
    {
      user_id: userUsername,
      name: userUsername,
      email: text(env.UI_DEMO_USER_EMAIL, `${userUsername}@example.test`),
      roles: ["buyer"],
      password: text(env.UI_DEMO_USER_PASSWORD, DEFAULT_DEMO_PASSWORD),
      metadata: {
        full_name: "42Pay User",
      },
    },
    {
      user_id: sellerUsername,
      name: sellerUsername,
      email: text(env.UI_DEMO_SELLER_EMAIL, `${sellerUsername}@example.test`),
      roles: ["seller"],
      password: text(env.UI_DEMO_SELLER_PASSWORD, DEFAULT_DEMO_PASSWORD),
      metadata: {
        full_name: "42Pay Seller",
      },
    },
    {
      user_id: traderUsername,
      name: traderUsername,
      email: text(env.UI_DEMO_TRADER_EMAIL, `${traderUsername}@example.test`),
      roles: ["trader"],
      password: text(env.UI_DEMO_TRADER_PASSWORD, DEFAULT_DEMO_PASSWORD),
      metadata: {
        full_name: "42Trade Trader",
      },
    },
  ];
}

async function seedDemoUsers(
  repo,
  { makeSalt, hashPassword, now = new Date().toISOString(), env = process.env } = {},
) {
  if (!repo || typeof repo.getUserById !== "function" || typeof repo.upsertUser !== "function") {
    throw new Error("seedDemoUsers requires a repository with getUserById and upsertUser");
  }
  if (typeof makeSalt !== "function" || typeof hashPassword !== "function") {
    throw new Error("seedDemoUsers requires makeSalt and hashPassword callbacks");
  }

  let written = 0;
  for (const baseUser of getDemoUsers(env)) {
    const { password, ...baseUserFields } = baseUser;
    const legacyUserId = LEGACY_DEMO_USER_IDS[baseUser.user_id] || "";
    const existing =
      (await repo.getUserById(baseUser.user_id)) ||
      (legacyUserId ? await repo.getUserById(legacyUserId) : null);
    const salt = String(makeSalt() || "");
    await repo.upsertUser({
      ...(existing || {}),
      ...baseUserFields,
      is_active: true,
      password_salt: salt,
      password_hash: String(
        hashPassword(password, salt) || "",
      ),
      created_at: now,
      updated_at: now,
      metadata: {
        demo: true,
        source: "demo-bootstrap",
        ...(baseUser.metadata && typeof baseUser.metadata === "object"
          ? baseUser.metadata
          : {}),
      },
    });
    if (
      legacyUserId &&
      legacyUserId !== baseUser.user_id &&
      typeof repo.deleteUserById === "function"
    ) {
      await repo.deleteUserById(legacyUserId).catch(() => {});
    }
    written += 1;
  }
  if (typeof repo.deleteUserById === "function") {
    for (const legacyUserId of LEGACY_REMOVED_USER_IDS) {
      await repo.deleteUserById(legacyUserId).catch(() => {});
    }
  }
  return { ok: true, written };
}

module.exports = {
  DEFAULT_DEMO_PASSWORD,
  getDemoUsers,
  seedDemoUsers,
};
