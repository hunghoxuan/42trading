"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { matchObservedProduct, recognizeProductWithAI } = require("./productVision");

const observation = (name) => ({product_count:1, identity_clear:true, product_name:name,
  brand:"Lifebuoy", variant:"", size:"", barcode:"", texts:[name], colors:[], visible_price:null});
const catalog = (name) => [{sid:"LIFE", name, sku:"LIFE-01", barcodes:[], status:"ACTIVE"},
  {sid:"BODY", name:"Sữa tắm Lifebuoy", sku:"BODY-01", barcodes:[], status:"ACTIVE"},
  {sid:"OTHER", name:"Other Hand Sanitizer", sku:"OTHER-01", barcodes:[], status:"ACTIVE"}];

test("sanitizer recognition matches grounded brand names across English and Vietnamese", () => {
  assert.equal(matchObservedProduct(observation("Lifebuoy Hand Sanitizer"), catalog("Nước sát khuẩn tay Lifebuoy"))[0]?.product_sid, "LIFE");
  assert.equal(matchObservedProduct(observation("Nước sát khuẩn tay Lifebuoy"), catalog("Lifebuoy Hand Sanitizer"))[0]?.product_sid, "LIFE");
});

test("bilingual matching still requires label evidence and honors an unmatched barcode", () => {
  assert.deepEqual(matchObservedProduct({...observation("Hand Sanitizer"), brand:""}, catalog("Nước sát khuẩn tay")), []);
  assert.deepEqual(matchObservedProduct({...observation("Lifebuoy Hand Sanitizer"), texts:["Other Hand Sanitizer"]}, catalog("Lifebuoy")), []);
  assert.deepEqual(matchObservedProduct({...observation("Lifebuoy Hand Sanitizer"), barcode:"8931234567890", texts:["Lifebuoy Hand Sanitizer", "8931234567890"]}, catalog("Lifebuoy")), []);
});

test("generic English names and a missing brand field cannot veto readable Lifebuoy", () => {
  const products = catalog("Nước rửa tay Lifebuoy");
  for (const brand of ["Lifebuoy", "Lifebuoy Hand Santizier", ""]) {
    const found = matchObservedProduct({...observation("Lifebuoy Hand Santizier"), brand, texts:["Lifebuoy", "Hand Sanitizer"]}, products);
    assert.ok(found.some(item => item.product_sid === "LIFE"));
    assert.ok(found.every(item => item.product_sid !== "OTHER"));
  }
  assert.ok(matchObservedProduct({...observation("Lifebuoy antibacterial moisturising hand care"), texts:["Lifebuoy"]}, products).length);
});

test("recognition returns minimal search keywords even when AI puts product type in brand", async () => {
  for (const brand of ["Lifebuoy Hand Santizier", "Lifebuoy"]) {
    const observed = {...observation("Lifebuoy Hand Santizier"), brand, object_name:"bottle", texts:["Lifebuoy", "Hand Sanitizer"]};
    const result = await recognizeProductWithAI("data:image/png;base64,"+Buffer.from("fixture").toString("base64"),
      catalog("Nước rửa tay Lifebuoy"), {user_id:"fixture"}, async()=>({rawText:JSON.stringify(observed)}));
    assert.deepEqual(result.keywords, ["lifebuoy"]);
    assert.ok(result.candidates.some(item => item.product_sid === "LIFE"));
  }
});
