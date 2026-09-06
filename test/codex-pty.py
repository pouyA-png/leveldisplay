"""POSIX terminal integration test; stdlib only, scratch stays in the checkout."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

root = Path(__file__).resolve().parent.parent
(root / '.scratch').mkdir(exist_ok=True)
scratch = Path(tempfile.mkdtemp(prefix='pty-', dir=root / '.scratch'))
node = os.environ.get('LEVELDISPLAY_NODE', 'node')

def check_watch(file, expect_failure=False):
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
    env = dict(os.environ)
    env.pop('NO_COLOR', None)
    proc = subprocess.Popen([node, str(root / 'leveldisplay-codex.mjs'), '--watch', '--file', str(file)], stdin=slave, stdout=slave, stderr=slave, env=env)
    captured = b''
    deadline = time.monotonic() + 3
    quit_sent = False
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                captured += os.read(master, 65536)
            if not expect_failure and captured.count(b'Option for Codex') >= 3 and not quit_sent:
                os.write(master, b'q')
                quit_sent = True
            if proc.poll() is not None:
                while select.select([master], [], [], 0)[0]:
                    captured += os.read(master, 65536)
                break
        assert proc.poll() is not None, 'watch did not exit'
        assert proc.returncode == (1 if expect_failure else 0), captured[-1000:]
        assert b'\x1b[?1049h' in captured and b'\x1b[?1049l' in captured, 'alternate screen not restored'
        assert b'\x1b[?25l' in captured and b'\x1b[?25h' in captured, 'cursor not restored'
        restored = termios.tcgetattr(slave)
        # BSD may set the transient "retype pending input" flag on error output.
        # Compare persistent modes, including canonical input, echo and signals.
        restored[3] &= ~getattr(termios, 'PENDIN', 0)
        original[3] &= ~getattr(termios, 'PENDIN', 0)
        assert restored == original, 'terminal raw mode not restored'
        if not expect_failure:
            assert b'\x1b[38;2;' in captured, 'truecolor not rendered'
            assert b'7d' in captured and b'12%' in captured, 'actual usage window missing'
            assert captured.count(b'Option for Codex') >= 3, 'no repeated frames'
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        os.close(master)
        os.close(slave)

try:
    fixture = scratch / 'session.jsonl'
    events = [
        {'type': 'turn_context', 'payload': {'model': 'gpt-6-astra', 'effort': 'high'}},
        {'type': 'event_msg', 'payload': {'type': 'task_started'}},
        {'type': 'event_msg', 'payload': {'type': 'token_count', 'info': None, 'rate_limits': {'primary': {'used_percent': 12, 'window_minutes': 10080}}}},
    ]
    for e in events:
        e['timestamp'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    fixture.write_text(''.join(json.dumps(e) + '\n' for e in events))
    check_watch(fixture)
    check_watch(scratch, expect_failure=True)  # read of a directory fails after screen entry
    print('PASS: animated PTY frames, real usage labels, q exit, error cleanup, cursor and terminal restoration')
finally:
    shutil.rmtree(scratch)
