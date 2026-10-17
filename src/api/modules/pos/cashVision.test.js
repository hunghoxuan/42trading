"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { recognizeCashImage, parseCashRecognition } = require("./cashVision");
const { handlePosRequest } = require("./httpHandlers");
const image = "data:image/png;base64," + Buffer.from("image fixture").toString("base64");
const result = notes => ({ currency: "VND", notes, uncertain: false, unrecognized_count: 0 });

test("sums physical-note quantities, merges denominations, ignores model-supplied totals", async () => {
  const out = await recognizeCashImage(image, { user_id: "cashier-1" }, async request => {
    assert.equal(request.userId, "cashier-1");
    assert.equal(request.messages[0].content[1].source.media_type, "image/png");
    assert.equal(request.messages[0].content[1].source.data, image.split(",")[1]);
    assert.match(request.messages[0].content[0].text, /Each physical note counts ONCE/);
    return { rawText: JSON.stringify({ ...result([{ denomination: 100000, quantity: 2 },
      { denomination: 20000, quantity: 1 }, { denomination: 20000, quantity: 2 }]), total_minor: 999 }) };
  });
  assert.equal(out.total_minor, 260000);
  assert.deepEqual(out.notes, [{ denomination: 100000, quantity: 2 }, { denomination: 20000, quantity: 3 }]);
});

test("empty, unclear and partially hidden notes require review", () => {
  assert.equal(parseCashRecognition(JSON.stringify(result([]))).uncertain, true);
  const unclear = { ...result([{ denomination: 50000, quantity: 1 }]), unrecognized_count: 2 };
  assert.equal(parseCashRecognition('```json\n' + JSON.stringify(unclear) + '\n```').uncertain, true);
});

test("rejects unsupported currencies, malformed output, denomination and quantity guesses", async () => {
  for (const invalid of ["text", JSON.stringify({ ...result([]), currency: "USD" }),
    JSON.stringify(result([{ denomination: 30000, quantity: 1 }])),
    JSON.stringify(result([{ denomination: 100000, quantity: 1.5 }])),
    JSON.stringify(result([{ denomination: 100000, quantity: -1 }])),
    JSON.stringify({ ...result([]), uncertain: "false" })]) assert.throws(() => parseCashRecognition(invalid));
  let called = false;
  await assert.rejects(recognizeCashImage("https://example.test/photo.png", { user_id: "1" }, () => { called = true; }), /Upload a PNG/);
  assert.equal(called, false);
  await assert.rejects(recognizeCashImage(image, { user_id: "1" }), error => error.status === 503);
});

test("cash recognition endpoint requires sales permission and passes actor to service", async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({ image }))]); req.method = "POST";
  let output;
  await handlePosRequest({ req, res: {}, url: new URL("http://localhost/pos/cash/recognize"),
    requirePermission: (_req, _res, permission) => { assert.equal(permission, "apis.pos.sales.write"); return true; },
    getActor: async () => ({ user_id: "cashier" }),
    service: { recognizeCash: async (payload, actor) => { assert.equal(actor.user_id, "cashier"); assert.equal(payload.image, image); return { ok: true }; } },
    json: (_res, status, body) => { assert.equal(status, 200); output = body; },
  });
  assert.deepEqual(output, { ok: true });
  await handlePosRequest({ req: { method: "POST" }, res: {}, url: new URL("http://localhost/pos/cash/recognize"),
    requirePermission: () => false, getActor: () => { throw new Error("must not execute"); } });
});
