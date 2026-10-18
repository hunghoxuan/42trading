import { access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const project = dirname(fileURLToPath(import.meta.url));
let compiler = process.env.SWIFTC || '/Library/Developer/CommandLineTools/usr/bin/swiftc';
try { await access(compiler); } catch { compiler = execFileSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).trim(); }
const sdk = process.env.SDKROOT || (compiler.startsWith('/Library/Developer/CommandLineTools/')
  ? '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk'
  : execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim());
await mkdir(join(project, 'build/check-module-cache'), { recursive: true });
const output = join(project, 'build/origin-checks');
execFileSync(compiler, ['-swift-version', '5', '-parse-as-library', '-sdk', sdk, '-module-cache-path', join(project, 'build/check-module-cache'),
  join(project, 'Sources/TrustedOrigin.swift'), join(project, 'OriginChecks.swift'), '-o', output], { stdio: 'inherit' });
execFileSync(output, [], { stdio: 'inherit' });
