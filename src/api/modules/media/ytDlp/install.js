"use strict";

const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const binDir = path.join(projectRoot, "data", "modules", "yt-dlp", "runtime", "bin");

function assetName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux" && process.arch === "arm64") return "yt-dlp_linux_aarch64";
  if (process.platform === "linux") return "yt-dlp_linux";
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "42trade-yt-dlp-installer" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 8) return reject(new Error("Too many download redirects"));
        return resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed with HTTP ${response.statusCode}`));
      }
      const stream = fs.createWriteStream(destination, { mode: 0o755 });
      response.pipe(stream);
      stream.on("finish", () => stream.close(resolve));
      stream.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const destination = path.join(binDir, name);
  const temporary = `${destination}.download`;
  const releaseAsset = assetName();
  const releaseRoot = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
  const checksumPath = path.join(binDir, "SHA2-256SUMS.download");
  await Promise.all([
    download(`${releaseRoot}/${releaseAsset}`, temporary),
    download(`${releaseRoot}/SHA2-256SUMS`, checksumPath),
  ]);
  const expected = fs
    .readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.at(-1) === releaseAsset)?.[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(temporary)).digest("hex");
  fs.rmSync(checksumPath, { force: true });
  if (!expected || actual !== expected.toLowerCase()) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`SHA-256 verification failed for ${releaseAsset}`);
  }
  fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, destination);
  const version = execFileSync(destination, ["--version"], { encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(binDir, "..", "version.txt"), `${version}\n`, { mode: 0o600 });
  process.stdout.write(`yt-dlp ${version} installed at ${destination}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
