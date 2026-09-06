#!/usr/bin/env node
// Installs the tested native build into the matching npm package, preserving its
// packaged code-mode host, resources, authentication and executable entrypoint.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { footerConfig } from '../install.mjs';

const version = '0.153.4';
const marker = '// leveldisplay native footer opt-in';
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function locatePackage(searchPath = process.env.PATH || '') {
  for (const dir of searchPath.split(path.delimiter)) {
    try {
      const entry = fs.realpathSync(path.join(dir, 'codex'));
      if (path.basename(entry) === 'codex.js') return path.dirname(path.dirname(entry));
    } catch { /* try the next PATH directory */ }
  }
  throw new Error('Could not locate npm Codex. Pass --package-root /path/to/@openai/codex.');
}

export function installNative({ packageRoot, binary, restore = false, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), platform = process.platform, arch = process.arch }) {
  if (platform !== 'darwin' || arch !== 'arm64') throw new Error('This native artifact targets macOS arm64 only.');
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== '@openai/codex' || pkg.version !== version) throw new Error(`Requires the matching @openai/codex ${version}; refusing to replace another version.`);
  const candidates = [path.join(packageRoot, 'node_modules/@openai/codex-darwin-arm64'), path.join(path.dirname(packageRoot), 'codex-darwin-arm64')];
  const vendor = candidates.find(p => fs.existsSync(path.join(p, 'vendor/aarch64-apple-darwin/bin/codex')));
  if (!vendor) throw new Error('Codex arm64 binary package not found.');
  const target = path.join(vendor, 'vendor/aarch64-apple-darwin/bin/codex');
  const launcher = path.join(packageRoot, 'bin/codex.js');
  const backup = path.join(packageRoot, '.leveldisplay-native-backup');
  const backupBinary = path.join(backup, 'codex'), backupLauncher = path.join(backup, 'codex.js');
  if (restore) {
    if (!fs.existsSync(backupBinary) || !fs.existsSync(backupLauncher)) throw new Error('No complete native installation backup found.');
    fs.copyFileSync(backupBinary, target + '.leveldisplay-stage');
    fs.renameSync(target + '.leveldisplay-stage', target);
    fs.copyFileSync(backupLauncher, launcher);
    return { restored: true, version };
  }
  if (!binary) throw new Error('Pass --binary /path/to/tested/codex.');
  const check = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (check.status !== 0 || check.stdout.trim() !== `codex-cli ${version}`) throw new Error('Native binary version check failed.');
  const oldLauncher = fs.readFileSync(launcher, 'utf8');
  const insertion = 'const env = {\n  ...process.env,';
  if (!oldLauncher.includes(marker) && !oldLauncher.includes(insertion)) throw new Error('Unexpected launcher structure; refusing to patch it.');
  const updated = oldLauncher.includes(marker) ? oldLauncher : oldLauncher.replace(insertion,
    `${insertion}\n  ${marker}\n  CODEX_LEVELDISPLAY: process.env.CODEX_LEVELDISPLAY ?? "1",`);
  const config = path.join(home, 'config.toml');
  const hadConfig = fs.existsSync(config);
  const oldConfig = hadConfig ? fs.readFileSync(config, 'utf8') : '';
  const newConfig = footerConfig(oldConfig);
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(backupBinary)) fs.copyFileSync(target, backupBinary);
  if (!fs.existsSync(backupLauncher)) fs.copyFileSync(launcher, backupLauncher);
  const staged = target + '.leveldisplay-stage';
  fs.copyFileSync(binary, staged); fs.chmodSync(staged, 0o755);
  fs.renameSync(staged, target);
  try {
    fs.writeFileSync(launcher, updated);
    if (newConfig !== oldConfig) {
      fs.mkdirSync(home, { recursive: true });
      if (!fs.existsSync(path.join(backup, 'config.before.toml'))) fs.writeFileSync(path.join(backup, 'config.before.toml'), oldConfig, { mode: 0o600 });
      fs.writeFileSync(config, newConfig, { mode: 0o600 });
    }
    const result = spawnSync(process.execPath, [launcher, '--version'], { encoding: 'utf8' });
    if (result.status !== 0 || result.stdout.trim() !== `codex-cli ${version}`) throw new Error('Installed launcher verification failed.');
    const validate = spawnSync(process.execPath, [launcher, 'features', 'list'], { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8' });
    if (validate.status !== 0) throw new Error('Installed config verification failed.');
  } catch (e) {
    fs.copyFileSync(backupBinary, target + '.leveldisplay-stage');
    fs.renameSync(target + '.leveldisplay-stage', target);
    fs.copyFileSync(backupLauncher, launcher);
    if (newConfig !== oldConfig) {
      if (hadConfig) fs.writeFileSync(config, oldConfig, { mode: 0o600 });
      else if (fs.existsSync(config)) fs.unlinkSync(config);
    }
    throw e;
  }
  return { installed: true, version, sha256: digest(target), backup, footer: newConfig !== oldConfig ? 'configured' : 'existing settings preserved', restartRequired: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { binary: { type: 'string' }, 'package-root': { type: 'string' }, home: { type: 'string' }, restore: { type: 'boolean' } } });
    console.log(JSON.stringify(installNative({ packageRoot: values['package-root'] || locatePackage(), binary: values.binary && path.resolve(values.binary), home: values.home, restore: values.restore }), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
