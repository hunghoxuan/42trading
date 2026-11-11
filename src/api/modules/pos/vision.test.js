"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { recognizeProductImage, rankCandidates } = require("./vision");
const { recognizeProductWithAI, parseProductObservation, matchObservedProduct } = require("./productVision");

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

const observedProduct = (overrides = {}) => ({ product_count: 1, identity_clear: true,
  object_name: "body wash bottle", product_name: "Sữa tắm Lifebuoy", brand: "Lifebuoy", variant: "", size: "350g", barcode: "",
  texts: ["Lifebuoy", "Sữa tắm", "350 g"], colors: ["white", "red"], visible_price: null, ...overrides });

test("AI name ranks the matching Lifebuoy size first and keeps same-brand options selectable", () => {
  const result = matchObservedProduct(observedProduct(), lifebuoyCatalog);
  assert.deepEqual(result.map(item => item.product_sid), ["LIFE350", "LIFE1000"]);
  assert.equal(result[0].confidence, "high");
  assert.equal(result[1].confidence, "possible");
});

test("generic objects, uncertain identity, unsupported brands, and multiple products produce no suggestions", () => {
  for (const observed of [observedProduct({ identity_clear: false }), observedProduct({ product_count: 2 }),
    observedProduct({ texts: ["bar white skin"], product_name: "choco bar", brand: "Choco" }),
    observedProduct({ product_name: "Sữa tắm", brand: "" }), observedProduct({ product_name: "Unknown Shampoo", brand: "Unknown", texts: ["Unknown Shampoo"] })]) {
    assert.deepEqual(matchObservedProduct(observed, lifebuoyCatalog), []);
  }
});

test("AI matching normalizes Vietnamese accents, product type synonyms and equivalent size units", () => {
  const observed = observedProduct({ product_name: "Lifebuoy body wash", size: "0.35 kg", texts: ["LIFEBUOY BODY WASH", "0.35 kg"] });
  assert.deepEqual(matchObservedProduct(observed, lifebuoyCatalog).map(item => item.product_sid), ["LIFE350", "LIFE1000"]);
});

test("English Handwash finds Vietnamese nước rửa tay and OR matching keeps same-brand choices available", () => {
  const handWash = observedProduct({ product_name: "Lifebuoy Handwash", size: "350ml",
    texts: ["Lifebuoy", "Handwash", "350ml"] });
  const catalog = [
    { sid: "LIFEHAND", name: "Lifebuoy nước rửa tay dịu nhẹ 350ml", sku: "LH-350", price_minor: 42000 },
    { ...lifebuoyCatalog[1], description: "Sữa tắm Lifebuoy 350 g" },
    lifebuoyCatalog[2], lifebuoyCatalog[0],
  ];
  const matches = matchObservedProduct(handWash, catalog);
  assert.equal(matches[0].product_sid, "LIFEHAND");
  assert.equal(matches[0].confidence, "high");
  assert.ok(matches.some(item => item.product_sid === "LIFE350" && item.confidence === "possible"));
  assert.ok(matches.every(item => item.product_sid !== "CHOC"));

  const enrichedCatalog = [{ ...lifebuoyCatalog[1], category: "Chăm sóc cá nhân", supplier: "Lifebuoy Vietnam",
    description: "Sữa tắm bảo vệ da chai 350 g" }];
  const bodyWash = observedProduct({ product_name: "Lifebuoy shower gel", size: "350g",
    texts: ["Lifebuoy", "Shower Gel", "350g"] });
  assert.equal(matchObservedProduct(bodyWash, enrichedCatalog)[0].product_sid, "LIFE350");
});

test("AI variant differences rank same-brand options lower, while unknown barcode never falls back", () => {
  const variant = matchObservedProduct(observedProduct({ variant: "aloe vera" }), lifebuoyCatalog);
  assert.equal(variant[0].product_sid, "LIFE350");
  assert.ok(variant.every(item => item.confidence === "possible"));
  assert.deepEqual(matchObservedProduct(observedProduct({ barcode: "8931234567890", texts: ["Lifebuoy Sữa tắm", "8931234567890"] }), lifebuoyCatalog), []);
});

test("AI visible price is separate from the register price and missing prices stay null", async () => {
  const observed = observedProduct({ texts: ["Lifebuoy Sữa tắm 350g", "70.000 đ"], visible_price: { text: "70.000 đ", amount: 70000, currency: "VND" } });
  let request;
  const result = await recognizeProductWithAI("data:image/png;base64," + Buffer.from("image").toString("base64"), lifebuoyCatalog,
    { user_id: "cashier-1" }, async (input) => { request = input; return { rawText: JSON.stringify(observed) }; });
  assert.equal(request.userId, "cashier-1");
  assert.equal(request.messages[0].content[1].type, "image");
  assert.equal(result.observed.visible_price.amount, 70000);
  assert.equal(result.candidates[0].retail_price_minor, 55000);
  assert.deepEqual(result.keywords, ["lifebuoy"]);
  assert.notEqual(result.colors, result.observed.colors, "response serializer must not treat a shared array as circular");
  assert.equal(parseProductObservation(JSON.stringify(observedProduct())).visible_price, null);
});

test("savings claims and prices absent from transcribed text are not reported as selling prices", () => {
  const price = { text: "14.500Đ", amount: 14500, currency: "VND" };
  assert.equal(parseProductObservation(JSON.stringify(observedProduct({ texts: ["Lifebuoy", "TIẾT KIỆM 14.500Đ"], visible_price: price }))).visible_price, null);
  assert.equal(parseProductObservation(JSON.stringify(observedProduct({ visible_price: price }))).visible_price, null);
});

test("malformed AI responses and invalid prices fail explicitly", () => {
  assert.throws(() => parseProductObservation("not JSON"), /invalid result/);
  assert.throws(() => parseProductObservation(JSON.stringify(observedProduct({ texts: "Lifebuoy" }))), /invalid result/);
  assert.throws(() => parseProductObservation(JSON.stringify(observedProduct({ visible_price: { text: "", amount: -1 } }))), /invalid price/);
  assert.throws(() => parseProductObservation(JSON.stringify(observedProduct({ product_name: "Unreadable", texts: [] }))), /clear identity without readable product text/);
});

test("missing AI configuration and provider failures do not fall back to old weak OCR matches", async () => {
  const image = "data:image/png;base64," + Buffer.from("image").toString("base64");
  await assert.rejects(recognizeProductWithAI(image, lifebuoyCatalog, { user_id: "cashier-1" }), /Configure Gemini/);
  await assert.rejects(recognizeProductWithAI(image, lifebuoyCatalog, { user_id: "cashier-1" }, async () => { throw new Error("provider unavailable"); }), /provider unavailable/);
});
