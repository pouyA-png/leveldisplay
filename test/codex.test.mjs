import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SessionState, SessionReader, findSession } from '../codex/session.mjs';
import { render, focusBar, stripAnsi, windowLabel } from '../codex/render.mjs';
import { footerConfig, install, shellQuote } from '../codex/install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, '.scratch'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.scratch', 'test-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const now = Date.parse('2026-09-06T12:00:00Z');
const event = (type, payload, ts = now) => ({ type, payload, timestamp: new Date(ts).toISOString() });
const line = e => JSON.stringify(e) + '\n';
const active = () => { const s = new SessionState(); s.consume(event('event_msg', { type: 'task_started' })); return s; };
const usage = (output = 300, lastOutput = 100) => event('event_msg', { type: 'token_count',
  info: { model_context_window: 100000, last_token_usage: { total_tokens: 25000, output_tokens: lastOutput }, total_token_usage: { total_tokens: 8000000, output_tokens: output } },
  rate_limits: { primary: { used_percent: 12, window_minutes: 10080, resets_at: now / 1000 + 100 }, secondary: null } });

test('uses actual model, reasoning, last context request and actual 7-day usage window', () => {
  const s = active(); s.consume(event('turn_context', { model: 'gpt-6-astra', effort: 'high' })); s.consume(usage());
  const result = s.snapshot(now);
  assert.equal(result.model, 'gpt-6-astra'); assert.equal(result.effort, 'high');
  assert.equal(result.contextPercent, 25); assert.equal(result.limits[0].window_minutes, 10080);
  const out = render(result, { color: false, now });
  assert.match(out, /ctx ~.*25%/); assert.match(out, /7d.*12%/); assert.doesNotMatch(out, /5h/);
});
test('null usage does not invent zeros or lose the previous known value', () => {
  const s = active(); assert.match(render(s.snapshot(now), { color: false, now }), /usage —/);
  s.consume(usage()); s.consume(event('event_msg', { type: 'token_count', info: null, rate_limits: null }));
  assert.equal(s.snapshot(now).limits[0].used_percent, 12);
});
test('supports both 5-hour and weekly windows; expired snapshots are marked stale', () => {
  const s = active(), e = usage(); e.payload.rate_limits.secondary = { used_percent: 30, window_minutes: 300, resets_at: now / 1000 - 1 };
  s.consume(e); const out = render(s.snapshot(now), { color: false, now });
  assert.match(out, /5h.*30% \(stale\)/); assert.match(out, /7d/);
  assert.equal(windowLabel(90), '90m'); assert.equal(windowLabel(undefined), 'usage');
});
test('duplicate cumulative token events do not double-count activity', () => {
  const s = active(); s.consume(usage(1000, 1000)); const before = s.snapshot(now).score;
  s.consume(usage(1000, 1000)); assert.equal(s.snapshot(now).score, before);
  s.consume(usage(2000, 1000)); assert.ok(s.snapshot(now).score > before);
});
test('custom and function tool calls pair with results without exposing commands', () => {
  const s = active();
  s.consume(event('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'a', input: 'SECRET_COMMAND' }));
  assert.equal(s.snapshot(now).tool, 'running tools'); assert.doesNotMatch(JSON.stringify(s), /SECRET_COMMAND/);
  s.consume(event('response_item', { type: 'custom_tool_call_output', call_id: 'a', output: 'SECRET_RESULT' }));
  assert.equal(s.snapshot(now).tool, null); assert.doesNotMatch(JSON.stringify(s), /SECRET_RESULT/);
});
test('plan steps and agents update from explicit lifecycle events', () => {
  const s = active();
  s.consume(event('response_item', { type: 'function_call', name: 'update_plan', call_id: 'p', arguments: JSON.stringify({ plan: [{ step: 'PRIVATE', status: 'completed' }, { status: 'in_progress' }] }) }));
  assert.deepEqual(s.snapshot(now).plan, { total: 2, done: 1 }); assert.doesNotMatch(JSON.stringify(s), /PRIVATE/);
  s.consume(event('response_item', { type: 'function_call', name: 'spawn_agent', call_id: 'a', arguments: '{"message":"PRIVATE"}' }));
  s.consume(event('response_item', { type: 'function_call_output', call_id: 'a', output: '{"agent_id":"child"}' }));
  assert.equal(s.snapshot(now).agents, 1);
  s.consume(event('response_item', { type: 'function_call_output', call_id: 'wait', output: '{"status":{"child":{"completed":"PRIVATE"}}}' }));
  assert.equal(s.snapshot(now).agents, 0);
  s.consume(event('event_msg', { type: 'task_complete' }));
  assert.equal(s.snapshot(now).score, 0); assert.match(render(s.snapshot(now), { color: false, now }), /idle/);
});
test('collaboration task-name spawn and final-answer notifications clear agents', () => {
  const s = active();
  s.consume(event('response_item', { type: 'function_call', name: 'spawn_agent', call_id: 'a' }));
  s.consume(event('response_item', { type: 'function_call_output', call_id: 'a', output: '{"task_name":"/root/child"}' }));
  assert.equal(s.snapshot(now).agents, 1);
  s.consume(event('response_item', { type: 'message', content: [{ text: 'Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/child\nPayload:\nPRIVATE' }] }));
  assert.equal(s.snapshot(now).agents, 0);
});
test('activity decays after silence and clears on abort', () => {
  const s = active(); s.consume(usage(24000, 24000)); assert.ok(s.snapshot(now).score > 0);
  assert.equal(s.snapshot(now + 7 * 60000).score, 0);
  s.consume(event('event_msg', { type: 'turn_aborted' })); assert.equal(s.snapshot(now).active, false);
});
test('incremental reader handles partial JSON, UTF-8, malformed lines, truncation and replacement', () => {
  const f = path.join(scratch, 'read.jsonl'); fs.writeFileSync(f, line(event('event_msg', { type: 'task_started' })));
  const r = new SessionReader(f); r.poll();
  const row = Buffer.from(line(event('turn_context', { model: 'asträ', effort: 'high' })));
  const split = row.indexOf(Buffer.from('ä')) + 1;
  fs.appendFileSync(f, row.subarray(0, split)); r.poll(); assert.equal(r.state.model, null);
  fs.appendFileSync(f, row.subarray(split)); r.poll(); assert.equal(r.state.model, 'asträ');
  const offset = r.offset; r.poll(); assert.equal(r.offset, offset);
  fs.appendFileSync(f, 'bad JSON\n' + line(usage())); r.poll(); assert.equal(r.state.contextPercent, 25);
  fs.writeFileSync(f, line(event('turn_context', { model: 'reset' }))); r.poll(); assert.equal(r.state.model, 'reset');
  const replacement = f + '.new'; fs.writeFileSync(replacement, line(event('turn_context', { model: 'replacement' })));
  fs.renameSync(replacement, f); r.poll(); assert.equal(r.state.model, 'replacement');
});
test('discovery excludes subagents and explicit missing IDs never select unrelated sessions', () => {
  const dir = path.join(scratch, 'home', 'sessions', '2026', '09', '06'); fs.mkdirSync(dir, { recursive: true });
  const parent = path.join(dir, 'rollout-parent.jsonl'), child = path.join(dir, 'rollout-child.jsonl');
  fs.writeFileSync(parent, line(event('session_meta', { source: 'cli' })));
  fs.writeFileSync(child, line(event('session_meta', { source: { subagent: { spawn: {} } } })));
  fs.utimesSync(child, new Date(now + 1000), new Date(now + 1000)); fs.utimesSync(parent, new Date(now), new Date(now));
  const home = path.join(scratch, 'home'); assert.equal(findSession(home), parent);
  assert.equal(findSession(home, 'child'), child); assert.equal(findSession(home, 'missing'), null);
});
test('gradient and ripple preserve bar geometry and animate; plain output contains no escapes', () => {
  for (const score of [0, 50, 80, 100]) {
    const bar = focusBar(score, 32, now); assert.equal(stripAnsi(bar).length, 32);
    assert.equal([...stripAnsi(bar)].filter(x => x === '▰').length, Math.round(score / 100 * 32));
  }
  assert.notEqual(focusBar(90, 32, now), focusBar(90, 32, now + 300));
  assert.match(focusBar(90, 32, now), /\x1b\[48;2;/);
  const s = active(); s.consume(usage());
  const plain = render(s.snapshot(now), { color: false, columns: 80, now }); assert.doesNotMatch(plain, /\x1b/);
  assert.ok(plain.split('\n').every(x => x.length <= 80));
});
test('footer installation preserves other config and is idempotent', () => {
  const original = 'model = "gpt-6-astra"\napproval_policy = "never"\n[tui.model_availability_nux]\nseen = true\n';
  const result = footerConfig(original); assert.ok(result.startsWith(original.trimEnd()));
  assert.equal(footerConfig(result), result);
  assert.equal(footerConfig('[tui]\nstatus_line = ["model"]\n'), '[tui]\nstatus_line = ["model"]\n');
  assert.equal(footerConfig('tui.status_line = ["model"]\n'), 'tui.status_line = ["model"]\n');
  assert.equal((footerConfig('[tui]\nnotifications = false\n').match(/\[tui\]/g) || []).length, 1);
});
test('installer never interprets examples inside TOML multiline instructions as config', () => {
  for (const quotes of ['"""', "''' ".trim()]) {
    const text = `developer_instructions = ${quotes}\nExample config:\n[tui]\n${quotes}\nmodel = "gpt-6-astra"\n`;
    assert.equal(footerConfig(text), text);
  }
});
test('installer validates config, preserves backup, and handles paths with spaces and quotes', () => {
  const dir = path.join(scratch, "user's home"), binDir = path.join(dir, 'bin'); fs.mkdirSync(dir);
  const fake = path.join(dir, 'codex'); fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const config = path.join(dir, 'config.toml'); fs.writeFileSync(config, 'model = "gpt-6-astra"\n');
  const result = install({ home: dir, binDir, script: path.join(root, 'leveldisplay-codex.mjs'), codex: fake });
  const run = spawnSync(result.command, ['--help'], { encoding: 'utf8' }); assert.equal(run.status, 0); assert.match(run.stdout, /Option for Codex/);
  const old = fs.readFileSync(path.join(dir, 'leveldisplay/config.before.toml'), 'utf8');
  install({ home: dir, binDir, script: path.join(root, 'leveldisplay-codex.mjs'), codex: fake });
  assert.equal(fs.readFileSync(path.join(dir, 'leveldisplay/config.before.toml'), 'utf8'), old);
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});
test('installer rolls back rejected config and refuses unrelated executable overwrite', () => {
  const dir = path.join(scratch, 'failed'), binDir = path.join(dir, 'bin'); fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.toml'), 'model = "existing"\n');
  assert.throws(() => install({ home: dir, binDir, script: 'irrelevant', codex: '/usr/bin/false' }), /restored/);
  assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), 'model = "existing"\n');
  fs.writeFileSync(path.join(binDir, 'leveldisplay-codex'), 'unrelated');
  assert.throws(() => install({ home: dir, binDir, script: 'irrelevant' }), /unrelated/);
});
test('CLI single snapshot works, rejects invalid switches, and does not emit ANSI into pipes', () => {
  const f = path.join(scratch, 'cli.jsonl'); fs.writeFileSync(f, line(event('turn_context', { model: 'test-model' })) + line(usage()));
  const run = args => spawnSync(process.execPath, [path.join(root, 'leveldisplay-codex.mjs'), ...args], { encoding: 'utf8' });
  let r = run(['--file', f, '--json']); assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).model, 'test-model');
  r = run(['--file', f]); assert.equal(r.status, 0); assert.doesNotMatch(r.stdout, /\x1b/);
  r = run(['--file', f, '--watch']); assert.equal(r.status, 1); assert.match(r.stderr, /requires a terminal/);
  r = run(['--watch', '--json']); assert.equal(r.status, 1);
  r = run(['--file', f, '--latest']); assert.equal(r.status, 1);
});
