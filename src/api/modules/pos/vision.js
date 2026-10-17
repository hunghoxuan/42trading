"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
let workerPromise = null;
let queue = Promise.resolve();

function imageBuffer(dataUrl) {
  const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("Upload a PNG, JPEG, or WebP image");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error("Image must be below 4 MB");
  return buffer;
}

async function extractText(buffer, options = {}) {
  if (!workerPromise) {
    const { createWorker } = require("tesseract.js");
    const cachePath = path.join(os.tmpdir(), "42trade-pos-ocr");
    fs.mkdirSync(cachePath, { recursive: true });
    workerPromise = createWorker("eng", 1, { cachePath }).catch((error) => { workerPromise = null; throw error; });
  }
  const work = queue.then(async () => {
    const worker = await workerPromise;
    await worker.setParameters({ tessedit_pageseg_mode: options.line ? "7" : "11", user_defined_dpi: "0" });
    const { data } = await worker.recognize(buffer, {}, { text: true, tsv: true });
    const words = String(data.tsv || "").split("\n").slice(1).flatMap((line) => {
      const cells = line.split("\t");
      return cells[0] === "5" && cells[11]?.trim() ? [{ text: cells.slice(11).join(" "), confidence: Number(cells[10]) || 0 }] : [];
    });
    return { text: String(data.text || ""), words, confidence: data.confidence || 0 };
  });
  queue = work.catch(() => {});
  return work;
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const GENERIC = new Set("the and for with from new all bar sua tam xa phong nuoc rua tay bao ve diet khuan skin body soap hang san pham ml gr kg each".split(" "));
function tokens(text) { return [...new Set(normalizeText(text).split(/\s+/).filter(Boolean))]; }

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
function wordSimilarity(a, b) {
  if (a === b) return 1;
  if (/\d/.test(a + b) || Math.min(a.length, b.length) < 5) return 0;
  const distance = editDistance(a, b);
  return distance <= (Math.max(a.length, b.length) >= 9 ? 2 : 1) ? 1 - distance / Math.max(a.length, b.length) : 0;
}

const COLOR_WORDS = {
  red: ["do", "red"], blue: ["xanh duong", "xanh bien", "blue"], green: ["xanh la", "green", "matcha"],
  white: ["trang", "white"], black: ["den", "black"], yellow: ["vang", "yellow"], pink: ["hong", "pink"],
  orange: ["cam", "orange"], purple: ["tim", "purple"], brown: ["nau", "brown"], gray: ["xam", "gray"],
};

function rankCandidates(evidence, products, features = {}) {
  const observations = (Array.isArray(evidence) ? evidence : [evidence]).map((item) => typeof item === "string"
    ? { text: item, words: tokens(item).map((text) => ({ text, confidence: 100 })) } : item);
  const observed = new Map();
  for (const item of observations) for (const word of item.words || []) {
    if (word.confidence < 5) continue;
    for (const token of tokens(word.text)) if (token.length >= (word.confidence < 25 ? 5 : 3)) observed.set(token, Math.max(observed.get(token) || 0, word.confidence));
  }
  const text = observations.map((item) => normalizeText(item.text)).join(" ");
  const frequency = new Map();
  const catalog = products.filter((product) => product.status !== "ARCHIVED").map((product) => {
    const words = tokens(product.name);
    for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1);
    return { product, words };
  });
  const colors = Array.isArray(features.colors) ? features.colors.filter((item) => COLOR_WORDS[item.color] && Number(item.weight) >= 0.07).slice(0, 4) : [];
  const visual = new Map((Array.isArray(features.visual_matches) ? features.visual_matches : []).slice(0, 200)
    .map((item) => [String(item.product_sid), Math.max(0, Math.min(1, Number(item.similarity) || 0))]));
  const results = catalog.flatMap(({ product, words }) => {
    const codes = [product.sku, ...(product.barcodes || [])].map((code) => normalizeText(code).replace(/\s/g, ""));
    const foundCode = codes.find((code) => code.length >= 6 && /\d/.test(code) && observations.some((item) => normalizeText(item.text).replace(/\s/g, "").includes(code)));
    const matches = words.flatMap((word) => {
      if (word.length < 3 || GENERIC.has(word)) return [];
      let best = 0, confidence = 0;
      for (const [read, quality] of observed) {
        const similarity = wordSimilarity(word, read);
        if (similarity > best || (similarity === best && quality > confidence)) { best = similarity; confidence = quality; }
      }
      if (!best || (confidence < 25 && (visual.get(product.sid) || 0) < 0.9)) return [];
      const idf = Math.log(1 + catalog.length / (frequency.get(word) || 1));
      return [{ word, similarity: best, confidence, weight: best * Math.min(1, idf / 5) }];
    });
    const anchors = matches.filter((item) => item.word.length >= 6 && item.similarity >= 0.8);
    const meaningful = matches.filter((item) => item.word.length >= 4);
    const phrase = normalizeText(product.name);
    const exactPhrase = phrase.length >= 7 && (` ${text} `).includes(` ${phrase} `);
    // A generic/short OCR token such as "bar" is never enough to identify a product.
    if (!foundCode && !anchors.length && meaningful.length < 2 && !(exactPhrase && meaningful.length && meaningful[0].confidence >= 60)) return [];
    const best = Math.max(0, ...matches.map((item) => item.similarity));
    const coverage = Math.min(1, meaningful.length / 2);
    let score = foundCode ? 0.99 : 0.52 * best + 0.16 * coverage + 0.12 * Math.min(2, anchors.length) + (exactPhrase ? 0.08 : 0);
    const normalizedName = ` ${normalizeText(product.name)} `;
    const namedColors = Object.entries(COLOR_WORDS).filter(([, values]) => values.some((value) => normalizedName.includes(` ${value} `))).map(([color]) => color);
    const matchingColors = colors.filter((item) => namedColors.includes(item.color)).map((item) => item.color);
    if (!foundCode) {
      score += matchingColors.length ? 0.04 : 0;
      if (namedColors.length && colors.length && !matchingColors.length) score -= 0.06;
      score += 0.09 * (visual.get(product.sid) || 0);
      if (matches.length && matches.every((item) => item.confidence < 25)) score -= 0.04;
    }
    if (score < 0.64) return [];
    return [{ product_sid: product.sid, name: product.name, image: product.image,
      retail_price_minor: product.price_minor, vat_rate_bps: product.vat_rate_bps,
      score: Math.min(foundCode ? 0.99 : 0.96, score), matched_keywords: matches.map((item) => item.word), colors: matchingColors,
      confidence: foundCode || score >= 0.84 ? "high" : "possible",
      explanation: foundCode ? "Code found on label" : matches.map((item) => item.word).join(" · "),
      _strength: matches.reduce((sum, item) => sum + item.weight, 0),
    }];
  });
  const strength = Math.max(0, ...results.map((item) => item._strength));
  return results.filter((item) => item.score === 0.99 || item._strength >= strength * 0.55)
    .sort((a, b) => b.score - a.score || b._strength - a._strength).slice(0, 5).map(({ _strength, ...item }) => item);
}

async function recognizeProductImage(dataUrl, products, extractor = extractText, features = {}) {
  const images = [dataUrl, ...(Array.isArray(features.ocr_images) ? features.ocr_images.slice(0, 2) : [])];
  const observations = [];
  for (const image of [...new Set(images)]) observations.push(await extractor(imageBuffer(image)));
  for (const image of (Array.isArray(features.line_images) ? features.line_images.slice(0, 8) : [])) {
    observations.push(await extractor(imageBuffer(image), { line: true }));
  }
  const candidates = rankCandidates(observations, products, features);
  const recognizedText = observations.map((item) => typeof item === "string" ? item : item.text).join("\n");
  return { candidates, recognized_text: recognizedText.slice(0, 1000),
    keywords: [...new Set(candidates.flatMap((item) => item.matched_keywords))].slice(0, 8),
    colors: Array.isArray(features.colors) ? features.colors.filter((item) => COLOR_WORDS[item.color]).slice(0, 4).map((item) => item.color) : [] };
}

module.exports = { recognizeProductImage, rankCandidates, imageBuffer, normalizeText };
