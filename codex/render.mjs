// Same gradient, glyphs and violet ripple as the Claude statusline.
const RESET = '\x1b[0m';
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const dim = '\x1b[38;5;245m', faint = '\x1b[38;5;240m';
const green = rgb(120, 200, 130), amber = rgb(245, 166, 35);
const red = rgb(255, 69, 58), blue = rgb(110, 159, 212);
const words = [
  ['snoozing', 'loafing', 'marinating', 'hibernating', 'gathering dust'],
  ['noodling', 'puttering', 'percolating', 'moseying', 'doodling'],
  ['tinkering', 'wrangling', 'schlepping', 'whittling', 'burrowing'],
  ['bamboozling', 'zoomifying', 'turbo-noodling', 'cooking', 'clobbering'],
  ['ultracoding', 'galaxy-braining', 'berserking', 'transcending', 'frothing'],
];
export const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
export const clean = s => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 80);
const clamp = n => Math.min(100, Math.max(0, n));
export function focusBar(score, width = 32, now = Date.now()) {
  const filled = Math.round(clamp(score) / 100 * width);
  let out = '';
  for (let x = 0; x < width; x++) {
    if (score >= 80) {
      const travel = Math.floor(now / 300) * 300 / 120;
      const q = (((Math.abs(x - (width - 1) / 2) - travel) % 20) + 20) % 20;
      const level = Math.min(7, Math.round(7 * (1 + Math.cos(2 * Math.PI * q / 20)) / 2)) / 7;
      const ramp = (a, b) => Math.round(a + (b - a) * level);
      out += `\x1b[48;2;${ramp(62, 140)};${ramp(22, 80)};${ramp(118, 240)}m${rgb(208, 180, 255)}`;
    } else if (x < filled) {
      const stops = [[175, 82, 222], [255, 55, 95], [255, 159, 10]];
      const t = ((x / Math.max(1, width - 1) + (now / 400) % 2) % 1) * 2;
      const i = Math.floor(t), f = t - i;
      out += rgb(...stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)));
    } else out += faint;
    out += x < filled ? '▰' : '▱';
  }
  return out + RESET;
}
function meter(pct, color, width = 10) {
  const n = Math.round(clamp(pct) / 100 * width);
  return `${color}${'▰'.repeat(n)}${faint}${'▱'.repeat(width - n)}${RESET}`;
}
export function windowLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'usage';
  return minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}
export function render(state, { now = Date.now(), color = true, columns = 160 } = {}) {
  const score = state.score;
  const level = score >= 85 ? 4 : score >= 60 ? 3 : score >= 35 ? 2 : score >= 15 ? 1 : 0;
  const word = words[level][Math.floor(now / 90000) % 5];
  const pieces = [
    `${dim}${clean(state.model || 'codex')}${state.effort ? ` (${clean(state.effort)})` : ''}${RESET}`,
    `${focusBar(score, columns < 90 ? 16 : 32, now)} ${dim}${word}${RESET}`,
  ];
  if (Number.isFinite(state.contextPercent)) {
    const p = state.contextPercent;
    pieces.push(`${dim}ctx ~${RESET}${meter(p, p >= 85 ? red : p >= 70 ? amber : green)} ${dim}${Math.round(p)}%${RESET}`);
  }
  for (const limit of state.limits) {
    const p = limit.used_percent;
    const expired = limit.resets_at != null && limit.resets_at * 1000 <= now;
    pieces.push(`${dim}${windowLabel(limit.window_minutes)} ${RESET}${meter(p, p >= 90 ? red : p >= 75 ? amber : blue)} ${dim}${Math.round(p)}%${expired ? ' (stale)' : ''}${RESET}`);
  }
  if (!state.limits.length) pieces.push(`${dim}usage —${RESET}`);
  // Wrap only at metric boundaries; avoid corrupting the other application's screen.
  const lines = [''];
  for (const piece of pieces) {
    const last = lines.length - 1;
    const sep = lines[last] ? ` ${faint}·${RESET} ` : '';
    if (lines[last] && stripAnsi(lines[last] + sep + piece).length > columns) lines.push(piece);
    else lines[last] += sep + piece;
  }
  let activity = state.active ? state.tool || 'working' : state.hasSession ? 'idle' : 'waiting for a Codex session';
  if (state.plan && state.active) activity += ` · ${state.plan.done}/${state.plan.total} steps`;
  if (state.agents) activity += ` · ${state.agents} agent${state.agents === 1 ? '' : 's'}`;
  lines.push(`${blue}▸${RESET} ${dim}${activity}${RESET}`);
  const out = lines.join('\n');
  return color ? out : stripAnsi(out);
}
