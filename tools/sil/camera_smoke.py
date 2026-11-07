#!/usr/bin/env python3
"""Camera-in-the-loop smoke test for the virtual SO-101 — no torch, no LeRobot, no model download.

Receives the virtual cameras exactly the way LeRobot's built-in ZMQ camera does (pyzmq SUB, JSON with
base64 images, decoded like cv2.imdecode would), reads the joints and sends goals with the Feetech SDK
that LeRobot uses, and closes the loop with a tiny scripted "policy". Checks that the images arrive in
the right size and colour order, that they change when the arm moves, and that the arm follows.

  pip install feetech-servo-sdk==1.0.0 pyserial pyzmq
  node tools/sil/so101-virtual.mjs --quiet --camera up --camera side &
  python3 tools/sil/camera_smoke.py /tmp/so101-follower 5555

Exit code 0 = all good.
"""
import base64
import json
import struct
import sys
import time
import zlib

import scservo_sdk as scs
import zmq

PORT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/so101-follower"
ZMQ_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 5555
fails = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


def decode_png_rgb8(data):
    """8-bit RGB PNG with filter 0 (what the runner writes) -> (w, h, bytes in file order)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    p, idat, w, h = 8, b"", 0, 0
    while p < len(data):
        n, typ = struct.unpack(">I4s", data[p:p + 8])
        body = data[p + 8:p + 8 + n]
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype == 2, "expected 8-bit RGB"
        elif typ == b"IDAT":
            idat += body
        p += 12 + n
    raw = zlib.decompress(idat)
    stride = 3 * w
    rows = [raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)] for y in range(h)]
    assert all(raw[y * (stride + 1)] == 0 for y in range(h)), "expected filter 0"
    return w, h, b"".join(rows)


def as_lerobot_sees_it(png):
    """cv2.imdecode returns the file's pixels as B,G,R and LeRobot does not convert them: emulate that."""
    w, h, px = decode_png_rgb8(png)
    out = bytearray(len(px))
    out[0::3], out[1::3], out[2::3] = px[2::3], px[1::3], px[0::3]
    return w, h, bytes(out)


def frame(sock, name):
    msg = json.loads(sock.recv_string())
    return msg["timestamps"][name], as_lerobot_sees_it(base64.b64decode(msg["images"][name]))


def diff(a, b):
    return sum(abs(x - y) for x, y in zip(a[::97], b[::97])) / (len(a) // 97)


def main():
    ctx = zmq.Context()
    sock = ctx.socket(zmq.SUB)
    sock.setsockopt_string(zmq.SUBSCRIBE, "")
    sock.setsockopt(zmq.RCVTIMEO, 5000)
    sock.setsockopt(zmq.CONFLATE, True)                   # as LeRobot's ZMQCamera: only the newest frame
    sock.connect(f"tcp://127.0.0.1:{ZMQ_PORT}")

    for _ in range(50):                                   # the runner may still be starting
        try:
            ph = scs.PortHandler(PORT)
            if ph.openPort():
                break
        except Exception:
            pass
        time.sleep(0.2)
    else:
        print("cannot open", PORT)
        return 2
    ph.setBaudRate(1_000_000)
    pk = scs.PacketHandler(0)

    try:
        t, (w, h, up0) = frame(sock, "up")
    except zmq.Again:
        check(False, "a camera frame arrives within 5 s")
        return 1
    check((w, h) == (640, 480), f"camera 'up' is {w}x{h}")
    check(abs(time.time() - t) < 5, "frame timestamp is wall-clock time")
    # the cube is orange-red (0.91, 0.27, 0.12): it must show up in channel 0 (= R) for the policy
    red = sum(1 for i in range(0, len(up0), 3) if up0[i] > 150 and up0[i + 1] < 120 and up0[i + 2] < 90)
    blue = sum(1 for i in range(0, len(up0), 3) if up0[i + 2] > 150 and up0[i + 1] < 120 and up0[i] < 90)
    check(red > 50 and blue == 0, f"colour order is RGB as LeRobot hands it to a policy (red px {red}, blue px {blue})")
    _, (_, _, side0) = frame(sock, "side")
    check(diff(up0, side0) > 5, "two different views")

    # a scripted "policy": three waypoints for shoulder_pan / elbow (raw ticks), observe, act, repeat
    for i in range(1, 7):
        pk.write1ByteTxRx(ph, i, 40, 1)                   # torque on
    gsr = scs.GroupSyncRead(ph, pk, 56, 2)
    for i in range(1, 7):
        gsr.addParam(i)
    gsw = scs.GroupSyncWrite(ph, pk, 42, 2)
    waypoints = [{1: 2047 + 500, 3: 2047 - 300}, {1: 2047 - 500, 3: 2047 - 300}, {1: 2047, 3: 2047}]
    last = up0
    for k, wp in enumerate(waypoints):
        gsw.clearParam()
        for i, g in wp.items():
            gsw.addParam(i, [g & 0xFF, g >> 8])
        gsw.txPacket()
        time.sleep(1.5)
        gsr.txRxPacket()
        pos = {i: gsr.getData(i, 56, 2) for i in wp}
        check(all(abs(pos[i] - g) < 40 for i, g in wp.items()), f"step {k + 1}: arm followed {wp} -> {pos}")
        _, (_, _, img) = frame(sock, "up")
        check(diff(img, last) > 0.2, f"step {k + 1}: camera image changed after the move ({diff(img, last):.2f})")
        last = img
    for i in range(1, 7):
        pk.write1ByteTxRx(ph, i, 40, 0)
    ph.closePort()
    sock.close()
    ctx.term()
    print("CAMERA SMOKE", "FAILED: " + "; ".join(fails) if fails else "OK")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
