#!/usr/bin/env python3
"""SIL smoke test: talk to the virtual SO-101 (tools/sil/so101-virtual.mjs) through its pty with the
Feetech Python SDK that LeRobot uses (pip install feetech-servo-sdk==1.0.0 pyserial).

  node tools/sil/so101-virtual.mjs --quiet &        # then:
  python3 tools/sil/smoke.py /tmp/so101-follower

Checks: ping + model number of IDs 1-6, firmware registers, Lock/Torque_Enable writes, Group sync
read of Present_Position, Group sync write of Goal_Position (the joint moves), Homing_Offset shifts
Present_Position, Min/Max_Position_Limit clamp the goal. Exit code 0 = all good.
"""
import sys
import time

import scservo_sdk as scs

PORT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/so101-follower"
IDS = [1, 2, 3, 4, 5, 6]
fails = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


def sm_decode(v, bit):
    return -(v & ((1 << bit) - 1)) if v & (1 << bit) else v


def main():
    for _ in range(50):                      # the runner may still be starting
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
    check(ph.setBaudRate(1_000_000), "baud 1 000 000")
    pk = scs.PacketHandler(0)

    for i in IDS:
        model, comm, err = pk.ping(ph, i)
        check(comm == scs.COMM_SUCCESS and model == 777, f"ping ID {i}: model {model}")
    _, comm, _ = pk.ping(ph, 7)
    check(comm == scs.COMM_RX_TIMEOUT, "ping ID 7 times out (no such servo)")
    major, comm, _ = pk.read1ByteTxRx(ph, 1, 0)
    check(comm == scs.COMM_SUCCESS, f"firmware major register reads ({major}, emulated)")

    for i in IDS:                            # LeRobot disable_torque(): Torque_Enable = 0, Lock = 0
        c1, _ = pk.write1ByteTxRx(ph, i, 40, 0)
        c2, _ = pk.write1ByteTxRx(ph, i, 55, 0)
        check(c1 == c2 == scs.COMM_SUCCESS, f"ID {i}: Torque_Enable=0, Lock=0")

    gsr = scs.GroupSyncRead(ph, pk, 56, 2)
    for i in IDS:
        gsr.addParam(i)
    check(gsr.txRxPacket() == scs.COMM_SUCCESS, "group sync read Present_Position")
    pos = {i: gsr.getData(i, 56, 2) for i in IDS}
    print("     present:", pos)

    # Homing_Offset (sign-magnitude, bit 11): Present = Actual - Homing_Offset
    off = pos[3] - 2047
    enc = (abs(off) | (1 << 11)) if off < 0 else off
    pk.write2ByteTxRx(ph, 3, 31, enc)
    p3, _, _ = pk.read2ByteTxRx(ph, 3, 56)
    check(abs(p3 - 2047) <= 1, f"Homing_Offset {off} -> Present_Position {p3} (~2047)")

    # limits + torque + sync write: elbow goes to the goal, clamped at Max_Position_Limit
    pk.write2ByteTxRx(ph, 3, 9, 1700)
    pk.write2ByteTxRx(ph, 3, 11, 2300)
    pk.write2ByteTxRx(ph, 3, 42, 2047)
    pk.write1ByteTxRx(ph, 3, 40, 1)
    pk.write1ByteTxRx(ph, 3, 55, 1)
    gsw = scs.GroupSyncWrite(ph, pk, 42, 2)
    gsw.addParam(3, [2200 & 0xFF, 2200 >> 8])
    check(gsw.txPacket() == scs.COMM_SUCCESS, "group sync write Goal_Position 2200")
    time.sleep(1.5)
    p3, _, _ = pk.read2ByteTxRx(ph, 3, 56)
    check(abs(p3 - 2200) <= 25, f"elbow reached {p3} (goal 2200, MuJoCo physics)")
    gsw.changeParam(3, [3000 & 0xFF, 3000 >> 8])
    gsw.txPacket()
    time.sleep(1.5)
    p3, _, _ = pk.read2ByteTxRx(ph, 3, 56)
    check(abs(p3 - 2300) <= 25, f"goal 3000 clamped by Max_Position_Limit: {p3} (~2300)")
    load, _, _ = pk.read2ByteTxRx(ph, 3, 60)
    print("     present load:", sm_decode(load, 10))
    pk.write1ByteTxRx(ph, 3, 40, 0)
    ph.closePort()
    print("SMOKE", "FAILED: " + "; ".join(fails) if fails else "OK")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
