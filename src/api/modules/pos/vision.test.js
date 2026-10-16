"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { recognizeProductImage } = require("./vision");

test("image text ranks catalog candidates and returns inventory price", async () => {
  const image = "data:image/png;base64," + Buffer.from("fake image").toString("base64");
  const result = await recognizeProductImage(image, [
    { sid: "P1", name: "Arabica Coffee", sku: "COF-01", barcodes: [], price_minor: 25000, vat_rate_bps: 0 },
    { sid: "P2", name: "Green Tea", sku: "TEA-02", barcodes: [], price_minor: 30000, vat_rate_bps: 0 },
  ], async () => "Arabica Coffee");
  assert.equal(result.candidates[0].product_sid, "P1");
  assert.equal(result.candidates[0].retail_price_minor, 25000);
  assert.equal(result.candidates.length, 1);
});
