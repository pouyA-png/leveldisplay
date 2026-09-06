#!/usr/bin/env node
// leveldisplay — minimalist Apple-style statusline for Claude Code.
// Line 1: model · [animated intensity bar + silly word] · ctx % · daily usage bar.
// Line 2 (when active): ▸ what it's working on · progress · ~rough ETA.
// Zero dependencies, no build step. Reads the stdin JSON Claude Code hands the
// statusline plus the session transcript (JSONL).

import fs from "node:fs";

// ---------- ANSI helpers ----------
const RESET = "\x1b[0m";
const DIM = "\x1b[38;5;245m"; // soft gray, quieter than bold white
const FAINT = "\x1b[38;5;240m"; // even dimmer, for empty bar cells / separators
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

const AMBER = rgb(245, 166, 35); // context warning
const RED = rgb(255, 69, 58); // context critical (Apple system red)
const USAGE_FILL = rgb(110, 159, 212); // muted SF blue
const CTX_FILL = rgb(120, 200, 130); // muted SF green (context healthy)

const SEP = ` ${FAINT}·${RESET} `;

// ---------- read stdin ----------
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  /* no stdin */
}
let stdin = {};
try {
  stdin = JSON.parse(raw);
} catch {
  /* keep empty */
}

// ---------- model ----------
const model = (stdin.model?.display_name ?? "claude").toLowerCase();

// ---------- session intensity from transcript tail ----------
// Signals over the last few minutes: tool-call rate, output-token burn,
// running subagents. Blended to 0-100.
function readTail(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function intensityScore(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return 0;
  let text;
  try {
    text = readTail(transcriptPath, 384 * 1024);
  } catch {
    return 0;
  }
  const now = Date.now();
  const WINDOW_MS = 16 * 60 * 1000;
  const AGENT_WINDOW_MS = 30 * 60 * 1000;

  let toolCalls = 0;
  let outTokens = 0;
  let lastActivity = 0;
  const agentStarts = new Map(); // tool_use id -> ts
  const finished = new Set(); // tool_use_ids with results

  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue; // first line of tail may be partial
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const age = now - ts;
    const blocks = e.message?.content;
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b.type === "tool_use" && b.name) {
          lastActivity = Math.max(lastActivity, ts);
          if (age <= WINDOW_MS) toolCalls++;
          if ((b.name === "Task" || b.name === "Agent") && age <= AGENT_WINDOW_MS) {
            agentStarts.set(b.id, ts);
          }
        } else if (b.type === "tool_result" && b.tool_use_id) {
          finished.add(b.tool_use_id);
        }
      }
    }
    if (e.type === "assistant" && age <= WINDOW_MS) {
      outTokens += e.message?.usage?.output_tokens ?? 0;
      lastActivity = Math.max(lastActivity, ts);
    }
  }

  let runningAgents = 0;
  for (const [id] of agentStarts) if (!finished.has(id)) runningAgents++;

  if (!lastActivity) return 0;

  const mins = WINDOW_MS / 60000;
  const toolScore = Math.min(1, toolCalls / mins / 5); // ~5 calls/min = max
  const burnScore = Math.min(1, outTokens / mins / 1500); // ~1.5k out-tok/min = max
  const agentScore = Math.min(1, runningAgents / 3); // 3+ agents = max
  let score = 100 * Math.min(1, 0.4 * toolScore + 0.3 * burnScore + 0.45 * agentScore);

  // Decay if the session has gone quiet (no activity in the last 2 minutes).
  const idleMs = now - lastActivity;
  if (idleMs > 2 * 60 * 1000) {
    score *= Math.max(0, 1 - (idleMs - 2 * 60 * 1000) / (5 * 60 * 1000));
  }
  return Math.round(score);
}

// HUD_FORCE_FOCUS=0..100 pins the intensity (for previewing the fire).
const forced = Number(process.env.HUD_FORCE_FOCUS);
const score =
  Number.isFinite(forced) && process.env.HUD_FORCE_FOCUS !== ""
    ? Math.min(100, Math.max(0, Math.round(forced)))
    : intensityScore(stdin.transcript_path);

// ---------- silly word per intensity level ----------
const WORDS = [
  ["snoozing", "loafing", "marinating", "hibernating", "gathering dust"],
  ["noodling", "puttering", "percolating", "moseying", "doodling"],
  ["tinkering", "wrangling", "schlepping", "whittling", "burrowing"],
  ["bamboozling", "zoomifying", "turbo-noodling", "cooking", "clobbering"],
  ["ultracoding", "galaxy-braining", "berserking", "transcending", "frothing"],
];
const level = score >= 85 ? 4 : score >= 60 ? 3 : score >= 35 ? 2 : score >= 15 ? 1 : 0;
// Rotate the word every 90s — stable across 300ms refreshes, fresh over time.
const word = WORDS[level][Math.floor(Date.now() / 90000) % WORDS[level].length];

// ---------- flashy animated gradient bar (ultracode vibes) ----------
// Gradient purple -> pink -> orange, phase drifts with time so it shimmers
// on every statusline refresh.
const GRAD = [
  [175, 82, 222], // purple
  [255, 55, 95], // pink
  [255, 159, 10], // orange
];
function gradRgbAt(t) {
  const x = Math.min(0.999, Math.max(0, t)) * (GRAD.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const [r1, g1, b1] = GRAD[i];
  const [r2, g2, b2] = GRAD[i + 1];
  return [
    Math.round(r1 + (r2 - r1) * f),
    Math.round(g1 + (g2 - g1) * f),
    Math.round(b1 + (b2 - b1) * f),
  ];
}
// ---------- ultracode ripple (authentic, reverse-engineered) ----------
// The /effort picker's "ultracode" animation, extracted from the Claude Code
// binary: an 8-step violet ramp rgb(62,22,118)->rgb(140,80,240) painted as
// cell BACKGROUNDS, banded by a radial raised-cosine with wavelength 20 cols,
// rings translating outward from the origin. Original runs 0.03 col/ms at
// 80ms ticks (2.4 cols/frame); at our ~300ms repaints we keep the same
// per-frame delta instead (2.5 cols/frame = 1/120 col/ms) so the rings roll
// smoothly instead of strobing. Glyphs over the ripple use the original's
// track-glyph lavender #d0b4ff.
const RAMP = Array.from({ length: 8 }, (_, i) => {
  const q = i / 7;
  const L = (a, b) => Math.round(a + (b - a) * q);
  return [L(62, 140), L(22, 80), L(118, 240)];
});
const RIPPLE_FG = rgb(208, 180, 255); // #d0b4ff

function rippleBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  const t = Math.floor(Date.now() / 300) * 300; // quantize to repaint bucket
  const travel = t / 120; // 1/120 col/ms, always-lit (rings drift forever)
  const origin = (width - 1) / 2; // rings emanate from the bar's center
  let out = "";
  for (let x = 0; x < width; x++) {
    const d = Math.abs(x - origin);
    const q = (((d - travel) % 20) + 20) % 20;
    const lvl = Math.min(7, Math.round((7 * (1 + Math.cos((2 * Math.PI * q) / 20))) / 2));
    const [r, g, b] = RAMP[lvl];
    out += `\x1b[48;2;${r};${g};${b}m${RIPPLE_FG}${x < filled ? "▰" : "▱"}`;
  }
  return out + RESET;
}

function focusBar(pct, width = 32) {
  if (pct >= 80) return rippleBar(pct, width);
  const filled = Math.round((pct / 100) * width);
  const phase = (Date.now() / 400) % 2; // shimmer drift
  let out = "";
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      const t = (i / Math.max(1, width - 1) + phase) % 1;
      const [r, g, b] = gradRgbAt(t);
      out += `${rgb(r, g, b)}▰`;
    } else {
      out += `${FAINT}▱`;
    }
  }
  return out + RESET;
}

// ---------- context window usage ----------
// Prefer Claude Code's native used_percentage; fall back to input_tokens/size
// for older builds. NaN when neither is available -> the bar is skipped.
const ctxWin = stdin.context_window;
let ctxPct = NaN;
if (ctxWin) {
  if (typeof ctxWin.used_percentage === "number" && Number.isFinite(ctxWin.used_percentage)) {
    ctxPct = ctxWin.used_percentage;
  } else {
    const used = ctxWin.current_usage?.input_tokens;
    const size = ctxWin.context_window_size;
    if (typeof used === "number" && typeof size === "number" && size > 0) {
      ctxPct = (used / size) * 100;
    }
  }
}

function contextBar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const fillColor = pct >= 85 ? RED : pct >= 70 ? AMBER : CTX_FILL;
  return (
    fillColor +
    "▰".repeat(filled) +
    FAINT +
    "▱".repeat(width - filled) +
    RESET
  );
}

// ---------- daily (5h) usage bar ----------
const fiveHour = stdin.rate_limits?.five_hour?.used_percentage;
function usageBar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const fillColor = pct >= 90 ? RED : pct >= 75 ? AMBER : USAGE_FILL;
  return (
    fillColor +
    "▰".repeat(filled) +
    FAINT +
    "▱".repeat(width - filled) +
    RESET
  );
}

// ---------- live progress line (what it's working on + rough ETA) ----------
// Best-effort from the transcript: prefers TodoWrite progress (ETA from the
// completion rate); else running agents/workflows (ETA from the median runtime
// of finished ones); else the current tool. Returns null when idle so the
// second line simply disappears. Every ETA is a "~" estimate, never a promise.
const GREEN = rgb(120, 200, 130);
const VIOLET = rgb(175, 82, 222);

function basename(p) {
  return typeof p === "string" ? p.split("/").pop() : "";
}
function truncate(s, n) {
  s = String(s ?? "");
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function miniBar(frac, width = 5) {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  return GREEN + "▰".repeat(filled) + FAINT + "▱".repeat(width - filled) + RESET;
}
function toolLabel(name, input) {
  input = input || {};
  switch (name) {
    case "Bash":
      return input.description || "running command";
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return "editing " + basename(input.file_path || input.notebook_path);
    case "Read":
      return "reading " + basename(input.file_path);
    case "Grep":
    case "Glob":
      return "searching" + (input.pattern ? ` ${String(input.pattern).slice(0, 24)}` : "");
    case "Task":
    case "Agent":
      return input.description || "subagent";
    case "Workflow":
      return "workflow" + (input.name ? ` ${input.name}` : "");
    case "Skill":
      return input.skill ? `/${input.skill}` : "skill";
    default:
      if (name && name.startsWith("mcp__")) return name.split("__").slice(1).join(" ");
      return name ? name.toLowerCase() : "working";
  }
}

function progressLine(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  let text;
  try {
    text = readTail(transcriptPath, 512 * 1024);
  } catch {
    return null;
  }
  const now = Date.now();
  const todoEvents = []; // [ts, completed, total, activeLabel]
  const agents = new Map(); // id -> {ts, label}
  const finishedAt = new Map(); // tool_use_id -> result ts
  let lastTool = null; // {ts, label}

  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const blocks = e.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (b.type === "tool_use" && b.name) {
        if (b.name === "TodoWrite") {
          const todos = b.input?.todos;
          if (Array.isArray(todos) && todos.length) {
            const done = todos.filter((t) => t.status === "completed").length;
            const ip = todos.find((t) => t.status === "in_progress");
            todoEvents.push([ts, done, todos.length, ip ? ip.activeForm || ip.content : null]);
          }
        } else if (b.name === "Task" || b.name === "Agent" || b.name === "Workflow") {
          agents.set(b.id, { ts, label: toolLabel(b.name, b.input) });
        }
        lastTool = { ts, label: toolLabel(b.name, b.input) };
      } else if (b.type === "tool_result" && b.tool_use_id) {
        finishedAt.set(b.tool_use_id, ts);
      }
    }
  }

  // 1) TodoWrite progress — the richest signal when present.
  if (todoEvents.length) {
    const [t1, c1, total, lbl] = todoEvents[todoEvents.length - 1];
    if (c1 >= total) return `${GREEN}✓${RESET} ${DIM}all ${total} steps done${RESET}`;
    const [t0, c0] = todoEvents[0];
    let rate = 0; // todos per ms
    if (t1 > t0 && c1 > c0) rate = (c1 - c0) / (t1 - t0);
    else if (c1 > 0) rate = c1 / Math.max(1, now - t0);
    const eta = rate > 0 ? ` ${DIM}· ~${fmtDur((total - c1) / rate)} left${RESET}` : "";
    const what = lbl ? truncate(lbl, 40) : "working";
    return `${AMBER}▸${RESET} ${DIM}${what}${RESET} ${miniBar(c1 / total)} ${DIM}${c1}/${total}${RESET}${eta}`;
  }

  // 2) Running agents / workflows (Pouya's usual mode).
  const running = [...agents.entries()].filter(([id]) => !finishedAt.has(id));
  if (running.length) {
    const startTs = Math.min(...running.map(([, a]) => a.ts));
    const done = [...agents.keys()].filter((id) => finishedAt.has(id)).length;
    const total = agents.size;
    const durs = [...agents.entries()]
      .filter(([id]) => finishedAt.has(id))
      .map(([id, a]) => finishedAt.get(id) - a.ts)
      .filter((d) => d > 0)
      .sort((x, y) => x - y);
    let eta = "";
    if (durs.length) {
      const med = durs[Math.floor(durs.length / 2)];
      const remain = med - (now - startTs);
      if (remain > 0) eta = ` ${DIM}· ~${fmtDur(remain)} left${RESET}`;
    }
    const what = running.length === 1 ? truncate(running[0][1].label, 36) : `${running.length} agents`;
    const mid =
      total > 1
        ? ` ${miniBar(done / total)} ${DIM}${done}/${total}${RESET}`
        : ` ${DIM}${fmtDur(now - startTs)}${RESET}`;
    return `${VIOLET}▸${RESET} ${DIM}${what}${RESET}${mid}${eta}`;
  }

  // 3) Current tool — only if there was activity in the last 45s.
  if (lastTool && now - lastTool.ts < 45000) {
    return `${USAGE_FILL}▸${RESET} ${DIM}${truncate(lastTool.label, 44)} · ${fmtDur(now - lastTool.ts)}${RESET}`;
  }
  return null;
}

// ---------- assemble ----------
const FOCUS_WIDTH = 32;
const parts = [
  `${DIM}${model}${RESET}`,
  `${focusBar(score, FOCUS_WIDTH)} ${DIM}${word}${RESET}`,
];
if (Number.isFinite(ctxPct)) {
  parts.push(`${DIM}ctx ${RESET}${contextBar(ctxPct)} ${DIM}${Math.round(ctxPct)}%${RESET}`);
}
if (typeof fiveHour === "number" && !Number.isNaN(fiveHour)) {
  parts.push(`${DIM}usage ${RESET}${usageBar(fiveHour)} ${DIM}${Math.round(fiveHour)}%${RESET}`);
}

const lines = [parts.join(SEP)];
const progress = progressLine(stdin.transcript_path);
if (progress) lines.push(progress);
console.log(lines.join("\n"));
