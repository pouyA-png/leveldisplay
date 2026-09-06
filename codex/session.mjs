import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const WINDOW = 16 * 60_000;
const terminalStates = new Set(['completed', 'errored', 'shutdown', 'not_found', 'interrupted']);
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const parse = s => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };
const toolName = n => String(n || '').split(/[.:]/).pop();
const label = n => /search|find|grep|glob/.test(n) ? 'searching' : /read|open|view/.test(n) ? 'reading' : /patch|edit|write/.test(n) ? 'editing' : /agent/.test(n) ? 'coordinating agents' : /exec|command|shell/.test(n) ? 'running tools' : 'working';

export class SessionState {
  constructor() {
    this.model = null; this.effort = null; this.contextPercent = null;
    this.limits = []; this.active = false; this.hasSession = false;
    this.pending = new Map(); this.children = new Map(); this.samples = [];
    this.plan = null; this.lastActivity = 0; this.totalOutput = null;
  }
  consume(e) {
    const p = e.payload || {}, ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts)) return;
    this.hasSession = true;
    if (e.type === 'turn_context') {
      this.model = p.model || this.model;
      this.effort = p.effort || p.reasoning_effort || this.effort;
    }
    if (e.type === 'event_msg') {
      if (p.type === 'task_started') {
        this.active = true; this.plan = null; this.pending.clear(); this.lastActivity = ts;
      }
      if (['task_complete', 'task_aborted', 'turn_aborted'].includes(p.type)) {
        this.active = false; this.pending.clear(); this.children.clear();
      }
      if (p.type === 'token_count') {
        const info = p.info;
        if (info) {
          const size = info.model_context_window, current = info.last_token_usage?.total_tokens;
          if (numeric(size) && size > 0 && numeric(current)) this.contextPercent = Math.min(100, current / size * 100);
          const total = info.total_token_usage?.output_tokens;
          if (numeric(total)) {
            const delta = this.totalOutput === null ? info.last_token_usage?.output_tokens || 0 : Math.max(0, total - this.totalOutput);
            if (numeric(delta) && delta > 0) this.samples.push({ ts, tools: 0, tokens: delta });
            this.totalOutput = total;
          }
        }
        if (p.rate_limits) {
          this.limits = [p.rate_limits.primary, p.rate_limits.secondary]
            .filter(x => x && numeric(x.used_percent))
            .map(x => ({ used_percent: Math.min(100, x.used_percent), window_minutes: x.window_minutes, resets_at: x.resets_at }));
        }
      }
    }
    if (e.type === 'response_item') {
      if (['function_call', 'custom_tool_call'].includes(p.type)) {
        const name = toolName(p.name), args = parse(p.arguments);
        this.pending.set(p.call_id, { name, id: name === 'close_agent' ? args?.id : null });
        this.samples.push({ ts, tools: 1, tokens: 0 }); this.lastActivity = ts;
        if (name === 'update_plan' && Array.isArray(args?.plan)) {
          this.plan = { total: args.plan.length, done: args.plan.filter(x => x.status === 'completed').length };
        }
      }
      if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
        const call = this.pending.get(p.call_id), output = parse(p.output);
        if (call?.name === 'spawn_agent' && (output?.agent_id || output?.task_name)) this.children.set(output.agent_id || output.task_name, ts);
        if (output?.status && typeof output.status === 'object') {
          for (const [id, status] of Object.entries(output.status)) {
            const kind = typeof status === 'string' ? status : Object.keys(status || {})[0];
            if (terminalStates.has(kind)) this.children.delete(id);
          }
        }
        if (call?.name === 'close_agent' && call.id) this.children.delete(call.id);
        this.pending.delete(p.call_id); this.lastActivity = ts;
      }
      if (p.type === 'message' && Array.isArray(p.content)) {
        for (const block of p.content) {
          const match = typeof block.text === 'string' && block.text.match(/Message Type: FINAL_ANSWER\s+Task name: ([^\n]+)\s+Sender: ([^\n]+)/);
          if (match) { this.children.delete(match[1].trim()); this.children.delete(match[2].trim()); }
        }
      }
      if (['message', 'reasoning'].includes(p.type) && p.role !== 'user') this.lastActivity = ts;
    }
    // Bound retained state even for sessions running for weeks.
    this.samples = this.samples.filter(x => x.ts >= ts - WINDOW);
    if (this.pending.size > 2000) this.pending.delete(this.pending.keys().next().value);
  }
  snapshot(now = Date.now()) {
    const samples = this.samples.filter(x => x.ts <= now && x.ts >= now - WINDOW);
    const tools = samples.reduce((n, x) => n + x.tools, 0), tokens = samples.reduce((n, x) => n + x.tokens, 0);
    const agents = this.active ? [...this.children.values()].filter(ts => now - ts < 30 * 60_000).length : 0;
    let score = 100 * Math.min(1, .4 * Math.min(1, tools / 16 / 5) + .3 * Math.min(1, tokens / 16 / 1500) + .45 * Math.min(1, agents / 3));
    const idle = now - this.lastActivity;
    if (idle > 120_000) score *= Math.max(0, 1 - (idle - 120_000) / 300_000);
    if (!this.active) score = 0;
    return { model: this.model, effort: this.effort, contextPercent: this.contextPercent,
      limits: this.limits, active: this.active, hasSession: this.hasSession,
      plan: this.plan, agents, score: Math.round(score),
      tool: this.pending.size ? label([...this.pending.values()].at(-1).name) : null };
  }
}

// Append-only reader: parses once, then only new bytes. Never retains transcripts,
// tool arguments, user text, credentials or reasoning content in display state.
export class SessionReader {
  constructor(file) { this.file = file; this.reset(); }
  reset() {
    this.state = new SessionState(); this.offset = 0; this.ino = null;
    this.partial = ''; this.decoder = new StringDecoder('utf8'); this.skipping = false;
  }
  poll() {
    let fd;
    try {
      fd = fs.openSync(this.file, 'r');
      const stat = fs.fstatSync(fd);
      if (this.ino !== stat.ino || stat.size < this.offset) this.reset();
      this.ino = stat.ino;
      const buf = Buffer.alloc(64 * 1024);
      while (this.offset < stat.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, stat.size - this.offset), this.offset);
        if (!n) break;
        this.offset += n;
        this.partial += this.decoder.write(buf.subarray(0, n));
        let end;
        while ((end = this.partial.indexOf('\n')) >= 0) {
          const row = this.partial.slice(0, end); this.partial = this.partial.slice(end + 1);
          if (!this.skipping) { const e = parse(row); if (e) this.state.consume(e); }
          this.skipping = false;
        }
        if (this.partial.length > 4 * 1024 * 1024) { this.partial = ''; this.skipping = true; }
      }
    } catch (e) {
      if (!['ENOENT', 'EACCES'].includes(e.code)) throw e;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    return this.state;
  }
}

function filesUnder(root) {
  const result = [];
  function walk(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && e.name.endsWith('.jsonl')) result.push(f);
    }
  }
  walk(root); return result;
}
export function findSession(home, id) {
  const files = filesUnder(path.join(home, 'sessions'));
  if (id) return files.find(f => path.basename(f).endsWith(`-${id}.jsonl`)) || null;
  const sorted = files.map(f => { try { return [f, fs.statSync(f).mtimeMs]; } catch { return [f, 0]; } }).sort((a, b) => b[1] - a[1]);
  for (const [file] of sorted) {
    let fd;
    try {
      fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(128 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const meta = parse(buf.subarray(0, n).toString('utf8').split('\n')[0])?.payload;
      if (meta && !(typeof meta.source === 'object' && meta.source?.subagent) && !(typeof meta.thread_source === 'object' && meta.thread_source?.subagent)) return file;
    } catch (e) {
      if (!['ENOENT', 'EACCES'].includes(e.code)) throw e;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return null;
}
