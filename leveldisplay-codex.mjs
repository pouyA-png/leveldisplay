#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SessionReader, SessionState, findSession } from './codex/session.mjs';
import { render } from './codex/render.mjs';
import { install, openTerminal } from './codex/install.mjs';

const help = `leveldisplay — Option for Codex (Node >= 18.3, no dependencies)

  leveldisplay-codex                  Print current session once
  leveldisplay-codex --watch          Animated companion in this terminal
  leveldisplay-codex --open           Open the companion in macOS Terminal
  leveldisplay-codex --install        Install command + supported native footer
  leveldisplay-codex --json           Machine-readable metrics, no transcript text

  --session ID    Pin a thread (defaults to CODEX_THREAD_ID / CODEX_SESSION_ID)
  --file PATH     Read a specific rollout JSONL
  --latest        Follow newest parent session (may switch between projects)
  --home PATH     Codex home (defaults to CODEX_HOME or ~/.codex)
  --bin-dir PATH  Install directory (defaults to ~/.local/bin)
  --no-color      Plain text output
  --once          Explicit single refresh

Without an ID, --watch selects the newest parent session and stays pinned.
Use a separate terminal/pane: Codex has no custom command footer hook.
Activity is a heuristic, not measured reasoning quality. ctx ~ is a last-request
estimate; usage windows come from Codex logs and can be stale while idle.
No network, credentials, transcript writes, telemetry, or extra model calls.
`;

function main() {
  const { values: v } = parseArgs({ options: {
    watch: { type: 'boolean' }, open: { type: 'boolean' }, install: { type: 'boolean' },
    json: { type: 'boolean' }, once: { type: 'boolean' }, latest: { type: 'boolean' },
    'no-color': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    session: { type: 'string' }, file: { type: 'string' }, home: { type: 'string' }, 'bin-dir': { type: 'string' },
  } });
  if (v.help) { console.log(help); return; }
  if ([v.watch, v.open, v.install, v.once].filter(Boolean).length > 1) throw new Error('Choose one of --watch, --open, --install, --once.');
  if ((v.file && v.session) || (v.latest && (v.file || v.session))) throw new Error('Choose one of --file, --session, --latest.');
  if (v.watch && v.json) throw new Error('--json is a single snapshot; use without --watch.');
  const home = path.resolve(v.home || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const script = fileURLToPath(import.meta.url);
  const session = v.session || (!v.latest && !v.file && (process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID));
  if (session && !/^[a-zA-Z0-9-]+$/.test(session)) throw new Error('Invalid session ID.');
  if (v.install) {
    console.log(JSON.stringify(install({ home, binDir: path.resolve(v['bin-dir'] || path.join(os.homedir(), '.local/bin')), script }), null, 2)); return;
  }
  let file = v.file ? path.resolve(v.file) : findSession(home, session);
  if (v.file && !fs.existsSync(file)) throw new Error('Session file does not exist.');
  if (v.open) {
    const args = ['--home', home];
    if (v.latest) args.push('--latest');
    else if (file) args.push('--file', file);
    else if (session) args.push('--session', session);
    openTerminal(args, script); console.log('Opened leveldisplay — Option for Codex in Terminal.'); return;
  }
  let reader = file ? new SessionReader(file) : null;
  let lastDiscovery = Date.now();
  function snapshot() {
    if ((!reader || v.latest) && Date.now() - lastDiscovery >= 3000) {
      const next = findSession(home, session); lastDiscovery = Date.now();
      if (next && next !== file) { file = next; reader = new SessionReader(next); }
    }
    return (reader ? reader.poll() : new SessionState()).snapshot();
  }
  const output = () => render(snapshot(), { color: !v['no-color'] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY), columns: process.stdout.columns || 160 });
  if (!v.watch) { console.log(v.json ? JSON.stringify(snapshot(), null, 2) : output()); return; }
  if (!process.stdout.isTTY || !process.stdin.isTTY) throw new Error('--watch requires a terminal. Use --once or --json for pipes.');
  const rawBefore = process.stdin.isRaw;
  let timer;
  function cleanup() {
    clearInterval(timer); process.stdin.setRawMode(Boolean(rawBefore)); process.stdin.pause();
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  }
  function stop() { cleanup(); process.exit(0); }
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  process.stdin.setRawMode(true); process.stdin.resume();
  process.stdin.on('data', data => { if (data.includes(3) || data.toString() === 'q') stop(); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, stop);
  function draw() {
    try {
      const rows = process.stdout.rows || 24;
      const lines = output().split('\n').slice(0, Math.max(1, rows - 2));
      process.stdout.write(`\x1b[H\x1b[J${lines.join('\r\n')}\r\n\x1b[2mOption for Codex · activity estimate · q to quit\x1b[0m`);
    } catch (e) { cleanup(); console.error(e.message); process.exit(1); }
  }
  draw(); timer = setInterval(draw, 300);
}
try { main(); } catch (e) { console.error(`leveldisplay-codex: ${e.message}`); process.exitCode = 1; }
