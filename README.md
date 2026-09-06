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

## Option for Codex

**Want the bars inside Codex's own footer?** Use the
[native-footer option](codex/native/README.md): a tested custom build of Codex CLI
0.153.4 for macOS arm64. It requires restarting Codex after installation, and npm
upgrades replace the patch.

### Companion option (no custom Codex build)

Codex users can run the same gradient bars, violet ripple and activity words in a
**companion terminal**, alongside Codex CLI or the Codex desktop app. This option
reads Codex's local session logs; the Claude statusline stays independent.

Illustrative display:

```text
gpt-6-astra (high) · ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ burrowing · ctx ~▰▰▰▱▱▱▱▱▱▱ 28% · 7d ▰▱▱▱▱▱▱▱▱▱ 12%
▸ running tools · 2/4 steps · 1 agent
```

### Install

Requires Node ≥ 18.3 and a local Codex installation. No npm packages, API keys or
additional model calls. From this repository:

```sh
node leveldisplay-codex.mjs --install
leveldisplay-codex --open             # macOS: opens an animated Terminal companion
```

On Linux, WSL, or in an existing separate terminal/pane:

```sh
leveldisplay-codex --watch
```

The installer creates `~/.local/bin/leveldisplay-codex`, referencing this checkout
and the exact Node executable used for installation. Keep the checkout in place
and ensure `~/.local/bin` is on `PATH`. Updates take effect when the display restarts.

It also adds this **native Codex CLI footer**, validated with `codex features list`:

```toml
[tui]
status_line = ["model-with-reasoning", "context-used", "five-hour-limit", "weekly-limit", "run-state", "task-progress"]
```

Existing custom footers and configs containing TOML multiline strings are preserved
without modification. Other settings—including model, reasoning, permissions,
authentication and MCP servers—are preserved. Before changing config, the installer
saves a local backup at `~/.codex/leveldisplay/config.before.toml`. Failed Codex
validation restores the original configuration. Restart Codex CLI for its native
footer to refresh; the companion can attach to an already-running session.

**Stock Codex display boundary:** Codex's supported [`tui.status_line` setting](https://developers.openai.com/codex/config-reference/#tui-status_line)
accepts built-in item identifiers, not arbitrary rendering commands. The native
footer therefore shows Codex's own metrics. The animated artwork lives in the
companion terminal. This does not inject a footer into the desktop chat interface,
patch Codex, or write over its terminal UI.

### Session selection and metrics

```sh
leveldisplay-codex --session THREAD_ID --watch  # pin a thread
leveldisplay-codex --file /path/to/rollout.jsonl --once
leveldisplay-codex --latest --watch            # explicitly follow latest parent session
leveldisplay-codex --json                      # inspect sanitized metrics
```

- An explicit session/file takes priority. Otherwise `CODEX_THREAD_ID` or
  `CODEX_SESSION_ID` pins the invoking Codex session. Outside Codex, the newest
  parent session is selected and remains pinned until restart. Subagent sessions
  are excluded from automatic selection. `--latest` deliberately allows switching.
- Model and reasoning effort come from recorded turn settings, not hard-coded names.
- Activity uses the same 16-minute tool-call/output-token/agent heuristic as the
  Claude version. It is **activity, not intelligence or measured thinking depth**.
  It decays during silence and returns to zero on completed/aborted turns.
- Agent counts use explicit spawn/completion events, with a 30-minute stale guard.
  Undocumented or missing lifecycle events can make this best-effort count lag.
- `ctx ~` estimates context used from the last request's total tokens divided by
  its reported context-window size. It is not cumulative billing and may differ
  from Codex's native footer around compaction.
- Usage uses the actual reported `window_minutes`: `5h`, `7d`, or another duration.
  Missing data shows `usage —`. Expired windows are marked `(stale)` until Codex
  reports new usage; the companion never calls an account endpoint.
- The second line shows safe tool categories and explicit plan progress. No invented
  completion percentage or ETA. Commands, prompts, results and reasoning text are
  never displayed. Logs are read locally and never modified or uploaded.
- The screen refreshes every 300 ms; logs are parsed incrementally. Long metric
  rows wrap at metric boundaries. Press **q** or **Ctrl+C** to restore the terminal.

`--home` / `CODEX_HOME` selects a different Codex directory; `--bin-dir` changes
the install directory. `--no-color` / `NO_COLOR` disables color; piped snapshots
are plain text automatically. Run `--help` for all options.

### Test and remove

```sh
node --test test/codex.test.mjs
python3 test/codex-pty.py              # optional POSIX terminal integration test
```

Tests use synthetic logs under ignored `.scratch/`; no real transcripts enter the
repository. Tested against local Codex 0.153.4 logs on macOS arm64 with Node 24.
Session JSONL is a best-effort local interface and may change between Codex versions.

To remove: quit the companion, delete `~/.local/bin/leveldisplay-codex`, and remove
the added `status_line` assignment from `~/.codex/config.toml` if desired. Do not
restore an old whole-file backup over newer configuration changes.
