"use strict";

let workerPromise = null;
let queue = Promise.resolve();

function imageBuffer(dataUrl) {
  const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("Upload a PNG, JPEG, or WebP image");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error("Image must be below 4 MB");
  return buffer;
}

async function extractText(buffer) {
  if (!workerPromise) {
    const { createWorker } = require("tesseract.js");
    workerPromise = createWorker("eng").catch((error) => { workerPromise = null; throw error; });
  }
  const work = queue.then(async () => {
    const worker = await workerPromise;
    const result = await worker.recognize(buffer);
    return String(result.data?.text || "");
  });
  queue = work.catch(() => {});
  return work;
}

function rankCandidates(text, products) {
  const normalized = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const compact = normalized.replace(/\s/g, "");
  const words = new Set(normalized.split(/\s+/).filter((word) => word.length >= 3));
  return products.map((product) => {
    let score = 0;
    let explanation = "";
    for (const code of [product.sku, ...(product.barcodes || [])]) {
      if (code && compact.includes(String(code).toLowerCase().replace(/[^a-z0-9]/g, ""))) {
        score = 1;
        explanation = "Code found in image text";
        break;
      }
    }
    if (score < 1) {
      const nameWords = String(product.name || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
      const matched = nameWords.filter((word) => words.has(word)).length;
      if (matched) {
        score = matched / Math.max(1, nameWords.length);
        explanation = matched + " product-name words found in image text";
      }
    }
    return { product_sid: product.sid, name: product.name, image: product.image,
      retail_price_minor: product.price_minor, vat_rate_bps: product.vat_rate_bps,
      score, explanation };
  }).filter((item) => item.score >= 0.35).sort((a, b) => b.score - a.score).slice(0, 5);
}

async function recognizeProductImage(dataUrl, products, extractor = extractText) {
  const buffer = imageBuffer(dataUrl);
  const recognizedText = await extractor(buffer);
  return { candidates: rankCandidates(recognizedText, products), recognized_text: recognizedText.slice(0, 500) };
}

module.exports = { recognizeProductImage, rankCandidates, imageBuffer };
