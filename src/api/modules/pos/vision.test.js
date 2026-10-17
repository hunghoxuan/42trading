"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { recognizeProductImage, rankCandidates } = require("./vision");

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

const lifebuoyCatalog = [
  { sid: "CHOC", name: "choco bar", sku: "CHOC-01", price_minor: 13000 },
  { sid: "LIFE350", name: "sua tam lifebuoy sua tam 350g", sku: "P207993DMK5YJB", price_minor: 55000 },
  { sid: "LIFE1000", name: "Sữa tắm Lifebuoy đỏ 1kg", sku: "LIFE-1000", price_minor: 100000 },
  { sid: "DOVE", name: "Sữa tắm Dove trắng", sku: "DOVE-01", price_minor: 80000 },
];

test("a stray generic OCR word cannot suggest Choco Bar", () => {
  assert.deepEqual(rankCandidates("bar skin new", lifebuoyCatalog), []);
  assert.deepEqual(rankCandidates({ text: "choco", words: [{ text: "choco", confidence: 10 }] }, lifebuoyCatalog), []);
});

test("Lifebuoy label with an OCR letter error beats an unrelated short product name", () => {
  const result = rankCandidates([
    { text: "bar", words: [{ text: "bar", confidence: 43 }] },
    { text: "Lirebuoy", words: [{ text: "Lirebuoy", confidence: 33 }] },
  ], lifebuoyCatalog, { colors: [{ color: "white", weight: 0.7 }, { color: "red", weight: 0.2 }],
    visual_matches: [{ product_sid: "LIFE350", similarity: 0.96 }] });
  assert.equal(result[0].product_sid, "LIFE350");
  assert.ok(result[0].matched_keywords.includes("lifebuoy"));
  assert.ok(result.every((item) => item.product_sid !== "CHOC"));
});

test("Vietnamese accents and duplicate product-name words do not hide the brand", () => {
  const result = rankCandidates("SỮA TẮM LIFEBUOY 350g", lifebuoyCatalog);
  assert.equal(result[0].product_sid, "LIFE350");
});

test("stylized low-confidence brand lettering needs corroborating product-photo colors", () => {
  const read = { text: "MY Lirebuoy", words: [{ text: "MY", confidence: 66 }, { text: "Lirebuoy", confidence: 7 }] };
  assert.deepEqual(rankCandidates(read, lifebuoyCatalog), []);
  const result = rankCandidates(read, lifebuoyCatalog, { visual_matches: [{ product_sid: "LIFE350", similarity: 0.96 }] });
  assert.equal(result[0].product_sid, "LIFE350");
  assert.equal(result[0].confidence, "possible");
});

test("color evidence can refine a label match but cannot invent one", () => {
  const features = { colors: [{ color: "red", weight: 0.8 }], visual_matches: [{ product_sid: "CHOC", similarity: 1 }] };
  assert.deepEqual(rankCandidates("", lifebuoyCatalog, features), []);
  const result = rankCandidates("lifebuoy", lifebuoyCatalog, features);
  assert.equal(result[0].product_sid, "LIFE1000");
  assert.ok(result.every((item) => item.product_sid !== "CHOC"));
});

test("exact product code wins while a one-digit code is not an identity", () => {
  assert.equal(rankCandidates("P207993DMK5YJB", lifebuoyCatalog)[0].product_sid, "LIFE350");
  assert.deepEqual(rankCandidates("1", [{ sid: "SHORT", name: "Wrong product", sku: "1" }]), []);
});

test("recognition combines multiple label views and returns useful search keywords", async () => {
  let call = 0;
  const image = (value) => "data:image/png;base64," + Buffer.from(value).toString("base64");
  const result = await recognizeProductImage(image("full"), lifebuoyCatalog, async () => ++call === 1 ? "bar" : "Lifebuoy 350g",
    { ocr_images: [image("label")] });
  assert.equal(call, 2);
  assert.equal(result.candidates[0].product_sid, "LIFE350");
  assert.ok(result.keywords.includes("lifebuoy"));
});
