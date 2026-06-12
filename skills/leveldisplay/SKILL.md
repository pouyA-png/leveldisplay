---
name: leveldisplay
description: Install or configure the leveldisplay statusline for Claude Code (animated thinking-intensity bar + 5h usage bar). Use when the user asks to install, enable, update, or troubleshoot leveldisplay, or wants a statusline showing usage and thinking level.
---

# leveldisplay — install skill

leveldisplay is a single-file, zero-dependency Node statusline (`leveldisplay.mjs`). Installing it means wiring it into the user's `~/.claude/settings.json` under the `statusLine` key. Statuslines cannot be shipped as plugin components, so this skill performs the settings edit.

## Steps

1. **Locate the script.** Check, in order:
   - `~/leveldisplay/leveldisplay.mjs` (cloned repo)
   - a `leveldisplay.mjs` next to this skill's repo checkout
   - If not found, clone it: `git clone https://github.com/pouyA-png/leveldisplay.git ~/leveldisplay`

2. **Find a working node.** Run `node --version`. Needs ≥ 18. If `node` is not on PATH (common with nvm), resolve the absolute binary path (e.g. `~/.nvm/versions/node/<version>/bin/node`) and use that in the command below.

3. **Smoke-test the script before touching settings:**
   ```bash
   echo '{"model":{"display_name":"test"}}' | HUD_FORCE_FOCUS=50 node ~/leveldisplay/leveldisplay.mjs
   ```
   It must print one line containing `test` and a bar of `▰▱` cells. If it errors, stop and report — do not edit settings.

4. **Edit `~/.claude/settings.json` carefully.**
   - Read the existing file first. It may contain hooks, permissions, env, and other keys — **preserve everything**, only set/replace the `statusLine` key:
     ```json
     "statusLine": {
       "type": "command",
       "command": "node /absolute/path/to/leveldisplay.mjs"
     }
     ```
   - If the file doesn't exist, create it with just that key.
   - Validate the result is parseable JSON before writing (e.g. round-trip through `node -e 'JSON.parse(...)'` or `python3 -m json.tool`).

5. **Verify.** Re-read the settings file, confirm valid JSON and the `statusLine` entry. Tell the user the statusline appears after their next statusline refresh (or restarting Claude Code).

## Preview mode

`HUD_FORCE_FOCUS=0..100` pins the intensity score — useful for showing the ultracode ripple (≥ 80) on demand. Never leave a forced value in the user's permanent `settings.json` command unless they explicitly ask for a pinned preview.

## Uninstall

Remove the `statusLine` key from `~/.claude/settings.json` (leave all other keys untouched).
