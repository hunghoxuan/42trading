import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir, rename, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The optional destination lets an isolated Android worktree publish to the running Mac mini UI.
const project = dirname(fileURLToPath(import.meta.url));
const apk = resolve(process.argv[2] || `${project}/app/build/outputs/apk/release/app-release.apk`);
const destination = resolve(process.argv[3] || `${project}/../../admin/public/downloads/pos-android`);
const bytes = await readFile(apk);
if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Expected an APK/ZIP file');
const gradle = await readFile(`${project}/app/build.gradle`, 'utf8');
const version = gradle.match(/versionName '([^']+)'/)?.[1];
if (!version) throw new Error('Missing Android version');
const sha256 = createHash('sha256').update(bytes).digest('hex');
await mkdir(destination, { recursive: true });
const page = resolve(`${project}/../../admin/public/downloads/pos-android/index.html`);
if (page !== resolve(destination, 'index.html')) await copyFile(page, resolve(destination, 'index.html'));
await writeFile(resolve(destination, '.gitignore'), '*.apk\nrelease.json\nSHA256SUMS\n');
await writeFile(resolve(destination, '42trade-pos.apk.tmp'), bytes);
await rename(resolve(destination, '42trade-pos.apk.tmp'), resolve(destination, '42trade-pos.apk'));
await writeFile(resolve(destination, 'SHA256SUMS'), `${sha256}  42trade-pos.apk\n`);
await writeFile(resolve(destination, 'release.json'), JSON.stringify({ version, variant: /debug/.test(apk) ? 'Bản thử nghiệm (debug)' : 'Bản phát hành', bytes: (await stat(apk)).size, sha256, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(JSON.stringify({ apk, destination, version, sha256, downloadPath: '/downloads/pos-android/42trade-pos.apk' }, null, 2));
