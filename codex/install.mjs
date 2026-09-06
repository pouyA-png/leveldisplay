import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const footerItems = ['model-with-reasoning', 'context-used', 'five-hour-limit', 'weekly-limit', 'run-state', 'task-progress'];
export const shellQuote = s => `'${String(s).replaceAll("'", "'\\''")}'`;

export function footerConfig(text) {
  // Do not replace a user's existing footer. TOML is not a regular language;
  // only add our simple table/key when there is no pre-existing assignment.
  if (text.includes('"""') || text.includes("'''")) return text;
  if (/^\s*(?:["']?tui["']?\s*\.\s*)?["']?status_line["']?\s*=/m.test(text) || /^\s*["']?tui["']?\s*=/m.test(text)) return text;
  const key = `status_line = ${JSON.stringify(footerItems)}\n`;
  const table = /^\s*\[\s*["']?tui["']?\s*\][^\n]*\n?/m;
  if (table.test(text)) return text.replace(table, match => `${match.trimEnd()}\n${key}`);
  return `${text.trimEnd()}\n\n[tui]\n${key}`;
}

export function install({ home, binDir, script, node = process.execPath, codex = 'codex' }) {
  const target = path.join(binDir, 'leveldisplay-codex');
  const wrapper = `#!/bin/sh\n# Installed by leveldisplay: Option for Codex\nexec ${shellQuote(node)} ${shellQuote(script)} "$@"\n`;
  let existing;
  try { existing = fs.lstatSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing) {
    const stat = existing;
    if (!stat.isFile() || !fs.readFileSync(target, 'utf8').includes('# Installed by leveldisplay: Option for Codex')) throw new Error(`Refusing to overwrite an unrelated command: ${target}`);
  }
  const config = path.join(home, 'config.toml');
  const old = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : '';
  const updated = footerConfig(old);
  fs.mkdirSync(home, { recursive: true });
  if (updated !== old) {
    const backupDir = path.join(home, 'leveldisplay');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backup = path.join(backupDir, 'config.before.toml');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, old, { mode: 0o600 });
    const staging = path.join(backupDir, `config.${process.pid}.toml`);
    fs.writeFileSync(staging, updated, { mode: 0o600 });
    fs.renameSync(staging, config);
    const result = spawnSync(codex, ['features', 'list'], { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      fs.writeFileSync(config, old, { mode: 0o600 });
      throw new Error('Codex config validation failed; restored previous config. Check that codex is on PATH.');
    }
  }
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(target, wrapper, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  return { command: target, footer: updated === old ? 'existing footer or complex TOML preserved; no config changes' : 'installed and validated by Codex' };
}

export function openTerminal(args, script) {
  if (process.platform !== 'darwin') throw new Error('Automatic terminal opening is macOS-only. Run leveldisplay-codex --watch in a separate terminal or pane.');
  const command = [process.execPath, script, '--watch', ...args].map(shellQuote).join(' ');
  // Pass AppleScript via stdin and escape its string independently of the shell.
  const literal = JSON.stringify(command);
  const source = `tell application "Terminal"\nactivate\nset hud to do script ${literal}\nset custom title of hud to "leveldisplay — Codex"\nend tell\n`;
  const result = spawnSync('/usr/bin/osascript', ['-'], { input: source, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not open Terminal. Run leveldisplay-codex --watch in a separate terminal.');
}
