# Native footer — Option for Codex

This is a small, **unofficial source patch for Codex CLI 0.153.4**, not a supported
custom-statusline hook. It draws Leveldisplay directly in Codex's own footer using
Ratatui spans: purple/pink/orange activity cells, violet thinking ripple, green
context cells and blue/amber/red quota cells. No companion terminal is required.

The native values come from Codex itself. Both context and quota bars show **used**
percentage (so the stock `weekly 97% left` becomes `7d … 3%`). The activity bar
shows the actual Ready/Working/Thinking/Waiting state, not a made-up intensity
percentage. `Thinking` uses the ripple, `Working` uses the gradient, and `Ready`
has empty cells. Animation honors `tui.animations` and color honors
`tui.status_line_use_colors`. Narrow terminals get shorter bars.

## Build and install

Source: [OpenAI Codex rust-v0.153.4](https://github.com/openai/codex/tree/rust-v0.153.4),
commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, under its Apache-2.0 license.
The patch touches only footer rendering and frame scheduling. Model selection,
authentication, permissions, tool execution and the packaged code-mode host are
unchanged.

Requirements: Rust 1.95.0, Cargo, `just`, `cargo-nextest`, and the system C/C++ build
tools. The local install path below is for npm Codex **0.153.4 on macOS arm64**.
Tests use the `dev-small` profile. The installed executable uses the optimized
release profile, with link-time optimization disabled and symbols stripped to
keep the local build practical.

```sh
sh codex/native/build.sh
node codex/native/install.mjs --binary .scratch/native-codex/codex-rust-v0.153.4/codex-rs/target/release/codex
```

The script checks the source archive SHA-256, applies the small patch, runs the
native-footer tests and builds the CLI. Downloads/build caches stay in `.scratch/`.
The Rust toolchain and dependencies need network access during the first build.

The installer checks the package/binary versions, backs up the existing binary and
npm launcher, installs the custom binary, and enables it with
`CODEX_LEVELDISPLAY=1` in the launcher. If no footer is configured, it adds model,
context, usage windows, runtime state and plan progress. Existing custom footer
settings and TOML containing multiline strings are preserved; include `run-state`,
`context-used`, `five-hour-limit` and `weekly-limit` via `/statusline` if desired.
Unreported quota windows remain absent.

**Restart Codex CLI after installation.** A running process cannot reload a new
executable. This affects the terminal CLI, not Codex desktop's built-in chat UI.

## Disable or restore

```sh
CODEX_LEVELDISPLAY=0 codex              # stock footer for one launch
node codex/native/install.mjs --restore
```

Full restore copies back the exact original binary/launcher from the npm package's
`.leveldisplay-native-backup/`. It leaves user configuration and conversation data
intact. The installer refuses to apply this binary to another Codex version.
**An npm Codex update replaces the patch**; a newer version needs a compatible
source patch and a new tested build. Do not freeze upgrades solely for this display.

## Verification

- Rust footer snapshots, percentage conversion, animation, idle state, monochrome
  output and missing data.
- Node installer tests cover activation, fresh footer configuration, version
  mismatch, repeat installation and rollback to the exact original artifacts.
- The real built Codex CLI was launched in a PTY and rendered native bar cells.

Local validation on 2026-09-06: all 5 new Rust footer tests and all 19 Node tests
passed. The wider TUI run had 4,060 passes, 36 failures and 6 skips. All 36 failures
were reproduced with the original upstream footer code: 28 version snapshots,
3 keybinding snapshots, 4 terminal-color tests and 1 locale assertion. These were
not accepted as new baselines or hidden by changing unrelated tests.

```sh
node --test test/native-install.test.mjs
python3 test/native-cli-pty.py --binary .scratch/native-codex/codex-rust-v0.153.4/codex-rs/target/release/codex
```
