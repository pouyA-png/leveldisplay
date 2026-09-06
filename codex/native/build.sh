#!/bin/sh
# Reproducible source preparation for the pinned native-footer build.
set -eu
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$native_dir/../.." && pwd)
build_dir=${LEVELDISPLAY_BUILD_DIR:-"$repo_dir/.scratch/native-codex"}
source_dir="$build_dir/codex-rust-v0.153.4"
mkdir -p "$build_dir"
if [ ! -d "$source_dir" ]; then
  curl -fLsS https://github.com/openai/codex/archive/refs/tags/rust-v0.153.4.tar.gz -o "$build_dir/source.tar.gz"
  expected=74d988c0e154aad2b8d0cca4e950fc97fe2a29ff5ebe3b0070cce6d949c9a307
  actual=$(shasum -a 256 "$build_dir/source.tar.gz" | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] || { echo 'Source checksum mismatch' >&2; exit 1; }
  tar xzf "$build_dir/source.tar.gz" -C "$build_dir"
fi
[ -d "$source_dir/.git" ] || git -C "$source_dir" init -q
cd "$source_dir"
if git apply --check "$native_dir/codex-0.153.4.patch" 2>/dev/null; then
  git apply "$native_dir/codex-0.153.4.patch"
else
  git apply --reverse --check "$native_dir/codex-0.153.4.patch"
fi
for name in leveldisplay.rs leveldisplay_tests.rs; do
  cmp -s "$native_dir/$name" "codex-rs/tui/src/bottom_pane/$name" || cp "$native_dir/$name" "codex-rs/tui/src/bottom_pane/$name"
done
snapshot=codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__leveldisplay__tests__leveldisplay_native_footer.snap
cmp -s "$native_dir/leveldisplay_native_footer.snap" "$snapshot" || cp "$native_dir/leveldisplay_native_footer.snap" "$snapshot"
cd codex-rs
# The release tag bumps workspace versions to 0.153.4 but leaves them at 0.0.0
# in Cargo.lock. Cargo normalizes those local versions; external pins stay fixed.
cargo fetch
CODEX_LEVELDISPLAY=0 just test -p codex-tui --cargo-profile dev-small -E 'test(leveldisplay)'
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_STRIP=symbols
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
cargo build --locked --release -p codex-cli --bin codex
echo "Tested native binary: $source_dir/codex-rs/target/release/codex"
