import { readFile, writeFile, mkdir, rm, access, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const project = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
const server = new URL(process.env.POS_MACOS_URL || 'https://hunghx.tail02c7f8.ts.net:8443/admin/pos');
if (server.protocol !== 'https:' || server.username || server.password || server.hash) throw new Error('POS_MACOS_URL must be HTTPS without credentials or a fragment');
const developer = '/Library/Developer/CommandLineTools';
let compiler = process.env.SWIFTC;
if (!compiler) {
  try { await access(`${developer}/usr/bin/swiftc`); compiler = `${developer}/usr/bin/swiftc`; }
  catch { compiler = execFileSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).trim(); }
}
const sdk = process.env.SDKROOT || (compiler.startsWith(developer)
  ? `${developer}/SDKs/MacOSX.sdk`
  : execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim());
const lipo = compiler.startsWith(developer) ? `${developer}/usr/bin/lipo` : 'lipo';
const build = join(project, 'build');
const app = join(build, '42Trade POS.app');
await rm(app, { recursive: true, force: true });
await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(join(app, 'Contents/Resources'), { recursive: true });
await mkdir(join(build, 'module-cache'), { recursive: true });
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
for (const arch of ['arm64', 'x86_64']) {
  run(compiler, ['-swift-version', '5', '-parse-as-library', '-O', '-module-name', 'PosMac',
    '-module-cache-path', join(build, 'module-cache'), '-target', `${arch}-apple-macos12.0`, '-sdk', sdk,
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'AVFoundation',
    join(project, 'Sources/TrustedOrigin.swift'), join(project, 'Sources/App.swift'), '-o', join(build, `pos-${arch}`)]);
}
run(lipo, ['-create', join(build, 'pos-arm64'), join(build, 'pos-x86_64'), '-output', join(app, 'Contents/MacOS/42TradePOS')]);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const entries = {
  CFBundleName: '42Trade POS', CFBundleDisplayName: '42Trade POS', CFBundleExecutable: '42TradePOS',
  CFBundleIdentifier: 'com.mozasolution.pos.macos', CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: pkg.version, CFBundleVersion: '1', LSMinimumSystemVersion: '12.0',
  CFBundleIconFile: 'AppIcon',
  NSPrincipalClass: 'NSApplication', NSCameraUsageDescription: '42Trade POS dùng camera để quét mã vạch và chụp sản phẩm.',
  POSServerURL: server.href,
};
await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${Object.entries(entries).map(([key, value]) => `<key>${key}</key><string>${escape(value)}</string>`).join('')}<key>NSHighResolutionCapable</key><true/></dict></plist>\n`);
await copyFile(join(project, 'README.txt'), join(app, 'Contents/Resources/README.txt'));
const iconset = join(build, 'AppIcon.iconset');
await mkdir(iconset, { recursive: true });
const logo = resolve(project, '../../admin/public/logo/payhub-p-pwa-512.png');
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), logo,
      '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(app, 'Contents/Resources/AppIcon.icns')]);
const identity = process.env.POS_MACOS_SIGN_IDENTITY || '-';
run('/usr/bin/codesign', ['--force', '--sign', identity, '--options', 'runtime', '--entitlements', join(project, 'entitlements.plist'),
  ...(identity === '-' ? ['--timestamp=none'] : ['--timestamp']), app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const filename = `42trade-pos-macos-v${pkg.version}-universal.zip`;
const zip = join(build, filename);
await rm(zip, { force: true });
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
const data = await readFile(zip);
const sha256 = createHash('sha256').update(data).digest('hex');
await writeFile(join(build, 'SHA256SUMS'), `${sha256}  ${filename}\n`);
await writeFile(join(build, 'release.json'), JSON.stringify({ version: pkg.version, filename, bytes: data.length, sha256,
  architectures: ['arm64', 'x86_64'], minimumMacOS: '12.0', signing: identity === '-' ? 'ad-hoc' : 'Developer ID (notarization still required)', builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(JSON.stringify({ app, zip, sha256, signing: identity === '-' ? 'ad-hoc; not notarized' : 'Developer ID; not notarized' }, null, 2));
