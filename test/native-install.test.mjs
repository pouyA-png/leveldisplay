import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installNative } from '../codex/native/install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, '.scratch'), { recursive: true });
const temp = fs.mkdtempSync(path.join(root, '.scratch/native-install-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
function fixture(name) {
  const packageRoot = path.join(temp, name);
  const target = path.join(packageRoot, 'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.mkdirSync(path.join(packageRoot, 'bin'));
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.153.4' }));
  fs.writeFileSync(target, '#!/bin/sh\n# STOCK\necho codex-cli 0.153.4\n', { mode: 0o755 });
  const launcher = path.join(packageRoot, 'bin/codex.js');
  fs.writeFileSync(launcher, `import {spawnSync} from 'node:child_process';\nconst env = {\n  ...process.env,\n};\nconst r = spawnSync(${JSON.stringify(target)},process.argv.slice(2),{env,encoding:'utf8'}); process.stdout.write(r.stdout); process.exit(r.status);\n`);
  const binary = path.join(packageRoot, 'custom');
  fs.writeFileSync(binary, '#!/bin/sh\n# CUSTOM\nif [ "$1" = "--footer" ]; then echo "${CODEX_LEVELDISPLAY:-0}"; else echo codex-cli 0.153.4; fi\n', { mode: 0o755 });
  return { packageRoot, target, launcher, binary, home: path.join(packageRoot, 'home'), platform: 'darwin', arch: 'arm64' };
}
test('native installer opts launcher in, preserves backup, and restores stock exactly', () => {
  const f = fixture('normal'), binaryBefore = fs.readFileSync(f.target), launcherBefore = fs.readFileSync(f.launcher);
  const result = installNative(f); assert.equal(result.installed, true);
  assert.match(fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8'), /run-state/);
  let run = spawnSync(process.execPath, [f.launcher, '--footer'], { encoding: 'utf8', env: { ...process.env, CODEX_LEVELDISPLAY: '' } });
  // An explicitly set environment value wins, including disabling the opt-in.
  assert.equal(run.stdout.trim(), '0');
  const env = { ...process.env }; delete env.CODEX_LEVELDISPLAY;
  run = spawnSync(process.execPath, [f.launcher, '--footer'], { encoding: 'utf8', env }); assert.equal(run.stdout.trim(), '1');
  installNative(f); installNative({ ...f, restore: true });
  assert.deepEqual(fs.readFileSync(f.target), binaryBefore); assert.deepEqual(fs.readFileSync(f.launcher), launcherBefore);
});
test('native installer restores both artifacts after installed-launcher failure', () => {
  const f = fixture('failure'), binaryBefore = fs.readFileSync(f.target), launcherBefore = fs.readFileSync(f.launcher);
  fs.writeFileSync(f.binary, '#!/bin/sh\nif [ "$CODEX_LEVELDISPLAY" = 1 ]; then exit 1; fi\necho codex-cli 0.153.4\n', { mode: 0o755 });
  assert.throws(() => installNative(f), /verification failed/);
  assert.deepEqual(fs.readFileSync(f.target), binaryBefore); assert.deepEqual(fs.readFileSync(f.launcher), launcherBefore);
});
test('native installer refuses mismatched package version without modification', () => {
  const f = fixture('mismatch'), before = fs.readFileSync(f.target);
  fs.writeFileSync(path.join(f.packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.154.0' }));
  assert.throws(() => installNative(f), /matching/); assert.deepEqual(fs.readFileSync(f.target), before);
});
