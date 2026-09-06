# leveldisplay

A minimalist, Apple-style statusline for [Claude Code](https://code.claude.com) that shows **how hard the session is thinking**, **how full the context window is**, **what it is working on right now** and **how much of your 5-hour usage window is gone** — in one animated line, plus a second line while it works.

```
fable · ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ cooking · ctx ▰▰▰▰▱▱▱▱▱▱ 42% · usage ▰▰▰▰▱▱▱▱▱▱ 42%
▸ Agent: review the auth module ▰▰▰▱▱ 3/5 · ~4m left
```

Single file. Zero dependencies. No build step. Just Node.

## What it shows

| Segment | Meaning |
|---|---|
| `fable` | Current model name |
| 32-cell animated bar | **Thinking intensity** (0–100), derived live from the session transcript |
| silly word | Intensity tier in plain words: `snoozing` → `noodling` → `tinkering` → `cooking` → `ultracoding` |
| `ctx` bar + `%` | **Context window fill** (green → amber at 70% → red at 85%), from Claude Code's own `used_percentage` |
| `usage` bar + `%` | Your 5-hour rate-limit window (blue → amber at 75% → red at 90%) |
| `▸ …` second line | **What it is doing right now** with progress and a rough ETA — only shown while something is running |

### How intensity is measured

The script tails the session transcript (JSONL) and blends three signals over a 16-minute window:

- **tool-call rate** (~5 calls/min = max, weight 0.4)
- **output-token burn** (~1.5k tokens/min = max, weight 0.3)
- **running subagents** (3+ = max, weight 0.45)

The score decays once the session has been idle for 2 minutes.

### The ultracode ripple

At intensity ≥ 80 the bar switches to the **authentic ultracode ripple** — the violet ring animation from Claude Code's `/effort` picker, reverse-engineered from the official binary: an 8-step background ramp `rgb(62,22,118) → rgb(140,80,240)`, banded by a radial raised-cosine with a 20-column wavelength, rings rolling outward from the bar's center, glyphs in lavender `#d0b4ff`. The travel speed is adapted to the statusline's ~300 ms repaint cadence so the rings drift smoothly instead of strobing.

Below 80 the filled cells shimmer through a purple → pink → orange gradient whose phase drifts with time.

### The second line

While the session is busy, a second line shows what it is working on. It is read from the tail of the transcript (last 512 KB) with a three-tier fallback:

1. **Task list progress** — `▸ <current task> ▰▰▰▱▱ 3/5 · ~4m left`, ETA from the completion rate so far.
2. **Running subagents or workflows** — `▸ <what they do> 2/4 · ~6m left`, ETA from the median runtime of the ones already finished.
3. **Current tool call** — `▸ <tool description> · 35s`, only if it started within the last 45 seconds.

If none applies the line disappears. Every ETA is a `~` linear estimate, never a promise.

## Install

Requires Node ≥ 18 and a terminal with truecolor (24-bit ANSI) support.

1. Clone (or just download `leveldisplay.mjs`):

   ```bash
   git clone https://github.com/pouyA-png/leveldisplay.git ~/leveldisplay
   ```

2. Point Claude Code at it in `~/.claude/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node ~/leveldisplay/leveldisplay.mjs"
     }
   }
   ```

   (If `node` isn't on the PATH Claude Code uses, give the absolute path to your node binary.)

3. Restart Claude Code. Done.

### Install as a Claude Code skill

This repo also ships a skill that does the wiring for you. Copy it into your skills folder:

```bash
git clone https://github.com/pouyA-png/leveldisplay.git ~/leveldisplay
cp -r ~/leveldisplay/skills/leveldisplay ~/.claude/skills/leveldisplay
```

Then tell Claude Code: *"install leveldisplay"* — the skill edits your `settings.json` safely (preserving existing keys and hooks) and verifies the script runs.

> Note: statuslines can't be shipped as plugin components — `statusLine` is only configurable via `settings.json`, which is why installation goes through a skill or the manual steps above.

## Preview / tuning

- `HUD_FORCE_FOCUS=0..100` pins the intensity, e.g. to preview the ripple:

  ```bash
  echo '{"model":{"display_name":"fable"}}' | HUD_FORCE_FOCUS=100 node leveldisplay.mjs
  ```

- Word pools rotate every 90 s; tweak the `WORDS` arrays to taste.
- Bar width: `FOCUS_WIDTH` (intensity, default 32) and the `width = 10` defaults in `contextBar` / `usageBar`.

## License

MIT
