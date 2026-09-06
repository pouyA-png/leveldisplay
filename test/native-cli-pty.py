"""Read-only startup smoke test for a built native CLI; no prompt/model call."""
import argparse
import fcntl
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True)
parser.add_argument('--package-root')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
scratch = root / '.scratch' / 'native-codex'
scratch.mkdir(parents=True, exist_ok=True)
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 160, 0, 0))
env = dict(os.environ)
env.update(CODEX_LEVELDISPLAY='1', TERM='xterm-256color')
for key in ('NO_COLOR', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID'):
    env.pop(key, None)
if args.package_root:
    env['CODEX_MANAGED_PACKAGE_ROOT'] = args.package_root
proc = subprocess.Popen([
    str(Path(args.binary).resolve()), '--no-alt-screen', '-C', str(Path.home()),
    '-c', 'tui.status_line=["model-with-reasoning","run-state","context-used","weekly-limit"]',
], stdin=slave, stdout=slave, stderr=slave, env=env)
captured = b''
queries = 0
try:
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.15)[0]:
            captured += os.read(master, 65536)
            count = captured.count(b'\x1b[6n')
            while queries < count:
                os.write(master, b'\x1b[1;1R')
                queries += 1
        if '▱'.encode() in captured and b'snoozing' in captured:
            break
        if proc.poll() is not None:
            break
    log = scratch / 'native-cli-terminal.log'
    log.write_bytes(captured)
    assert '▱'.encode() in captured and b'snoozing' in captured, f'Native footer not visible; inspect {log}'
    print('PASS: real Codex CLI rendered bar cells and idle state in its native footer')
finally:
    if proc.poll() is None:
        os.write(master, b'\x03')
        time.sleep(0.3)
    if proc.poll() is None:
        os.write(master, b'\x03')
    try:
        proc.wait(timeout=4)
    except subprocess.TimeoutExpired:
        proc.terminate()
        proc.wait(timeout=3)
    os.close(master)
    os.close(slave)
