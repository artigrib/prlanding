#!/usr/bin/env python3
"""Virtual serial port for the SO-101 software-in-the-loop runner (tools/sil/so101-virtual.mjs).

Creates a pseudo-terminal pair, links the slave side to a stable path (e.g. /tmp/so101-follower)
and relays bytes between the pty master and this process's stdin/stdout:

  stdin  (from the Node runner): raw bytes, written to the pty as servo replies
  stdout (to the Node runner):   frames  [type:u8][len:u16 LE][payload]
                                 type 0 = bytes LeRobot wrote to the port
                                 type 1 = baud rate the port is set to now (u32 LE), sent on change

The baud frame lets the emulator ignore packets sent at the wrong baud rate, like a real servo,
so LeRobot's baud scan in setup_motor() behaves as on hardware.

Standard library only (pty, termios, select). Linux and macOS. Windows has no pty: see the docs
(com0com, untested).
"""
import argparse
import os
import pty
import select
import signal
import struct
import sys
import termios
import tty

SPEEDS = {getattr(termios, n): int(n[1:]) for n in dir(termios) if n.startswith("B") and n[1:].isdigit()}


def baud_of(fd):
    try:
        attrs = termios.tcgetattr(fd)
    except termios.error:
        return 0
    speed = attrs[5]  # ospeed
    if speed in SPEEDS:
        return SPEEDS[speed]
    return int(speed)  # macOS reports the number itself


def frame(kind, payload):
    return struct.pack("<BH", kind, len(payload)) + payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--link", required=True, help="symlink to create for the slave side")
    args = ap.parse_args()

    master, slave = pty.openpty()
    tty.setraw(slave)          # no echo, no CR/LF translation: a plain 8-bit line like a USB-UART
    tty.setraw(master)
    if hasattr(termios, "B1000000"):   # start at the servos' factory baud rate (LeRobot sets it anyway)
        attrs = termios.tcgetattr(slave)
        attrs[4] = attrs[5] = termios.B1000000
        termios.tcsetattr(slave, termios.TCSANOW, attrs)
    name = os.ttyname(slave)
    try:
        if os.path.islink(args.link) or os.path.exists(args.link):
            os.unlink(args.link)
        os.symlink(name, args.link)
    except OSError as e:
        sys.stderr.write(f"pty-bridge: cannot create {args.link}: {e}\n")
        return 2

    def cleanup(*_):
        try:
            if os.path.islink(args.link) and os.readlink(args.link) == name:
                os.unlink(args.link)
        except OSError:
            pass
        os._exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    out = sys.stdout.buffer
    out.write(frame(2, name.encode()))   # type 2 = slave device name (informational)
    out.flush()
    inp = sys.stdin.buffer.raw.fileno()
    last_baud = None
    # We keep `slave` open ourselves: when LeRobot closes/reopens the port (it does on every baud
    # change), the master would otherwise read EIO and the bridge would have to be restarted.
    while True:
        r, _, _ = select.select([master, inp], [], [], 0.5)
        if master in r:
            try:
                data = os.read(master, 4096)
            except OSError:
                data = b""
            if data:
                b = baud_of(slave)
                if b != last_baud:
                    last_baud = b
                    out.write(frame(1, struct.pack("<I", b)))
                out.write(frame(0, data))
                out.flush()
        if inp in r:
            data = os.read(inp, 4096)
            if not data:
                cleanup()
            os.write(master, data)


if __name__ == "__main__":
    sys.exit(main() or 0)
