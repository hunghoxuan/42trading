import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const project = dirname(fileURLToPath(import.meta.url));
const privateDir = resolve(homedir(), '.config/42trade/android');
const env = { ...process.env };
if (!env.POS_ANDROID_KEYSTORE) {
  env.POS_ANDROID_KEYSTORE = resolve(privateDir, 'pos-release.p12');
  await access(env.POS_ANDROID_KEYSTORE);
  const password = (await readFile(resolve(privateDir, 'release-password'), 'utf8')).trim();
  env.POS_ANDROID_STORE_PASSWORD = password;
  env.POS_ANDROID_KEY_PASSWORD = password;
  env.POS_ANDROID_KEY_ALIAS = '42trade-pos';
}
for (const name of ['POS_ANDROID_STORE_PASSWORD', 'POS_ANDROID_KEY_PASSWORD', 'POS_ANDROID_KEY_ALIAS']) {
  if (!env[name]) throw new Error(`${name} must be set for the existing release signing key`);
}
// Secrets are inherited as environment variables; never logged or passed on the command line.
const child = spawn(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
  '--no-daemon', '--console=plain', 'testReleaseUnitTest', 'lintRelease', 'assembleRelease', ...process.argv.slice(2),
], { cwd: project, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
