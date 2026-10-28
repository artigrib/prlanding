"""KLEPETO – 150 g four-wheel lifter with a grabber claw (original design, printedrobotics.cz, CC BY 4.0).

Geometry follows sim/arena/src/robots/catalog.js BASES.klepeto (1 u = 10 cm = 100 mm):
  chassis box half [52, 16, 40] mm offset (z +1, y -8) -> x ±52, z -15..17, y -48..32
  wheels (±44, 18) and (±44, -30), R 19, ride height 27 mm (floor at z = -27)
  lifter hinge (0, 30, 10); fork tip at hinge + (y 62, z -35.5); hull ±42 wide
  jaw hinge = lifter hinge + (y 2, z 16); jaw closes at 0 rad, opens at -0.42 rad (tips up)
"""
import math
import sys

from build123d import Axis, Box, Cylinder, Pos, Rot, Polyline, make_face, extrude, fillet, chamfer, Align, mirror, Plane, GeomType, SlotCenterToCenter
from parts import side_profile, rounded_slab, cap_screw, button_screw, hex_nut, wheel, engrave, union, servo_body, servo_horn
from gltfout import Node, write_glb

FLOOR = -27.0
WR, WW = 19.0, 12.0
WHEELS = [(44, 18), (-44, 18), (44, -30), (-44, -30)]
HINGE = (0.0, 30.0, 10.0)
JAW = (0.0, 32.0, 26.0)
TIP = (62.0, -35.5)                          # fork tip relative to the hinge (y, z)
FORK_ANG = math.degrees(math.atan2(-TIP[1], TIP[0]))   # ~29.8 deg below horizontal
FORK_LEN = math.hypot(*TIP)


def mx(s):
    return mirror(s, Plane.YZ)


def frame():
    tub = rounded_slab([(-36, -48), (36, -48), (36, 26), (30, 32), (-30, 32), (-36, 26)], -15, 17, r_vert=3.5, top=3, bottom=1.2)
    # front slope under the lifter
    tub = tub - side_profile([(12, 17.1), (40, 17.1), (40, -1), (33, 2)], -40, 40)
    # side armour between the wheels
    pod = rounded_slab([(35, -8.5), (50, -7.5), (50, -3), (35, -2)], -13, 9, r_vert=1.2, top=1.4, bottom=0.6)
    # hinge lugs at the front corners
    lug = side_profile([(14, 4), (24, -6), (30, 4), (33, 10), (30, 16), (22, 16), (14, 16)], 29, 35)
    lug = lug + Pos(32, HINGE[1], HINGE[2]) * Rot(0, 90, 0) * Cylinder(6, 6)
    lug = lug - Pos(32, HINGE[1], HINGE[2]) * Rot(0, 90, 0) * Cylinder(1.7, 10)
    shell = union(tub, pod, mx(pod), lug, mx(lug))
    # lid
    lid_pts = [(-29, -43), (29, -43), (29, 8), (23, 13), (-23, 13), (-29, 8)]
    shell = shell - rounded_slab(lid_pts, 16.2, 20, r_vert=3, top=0, bottom=0)
    lid = rounded_slab(lid_pts, 16.2, 18.0, r_vert=2.6, top=0.6, bottom=0)
    lid = lid - Pos(0, -14, 18.0 - 0.5) * engrave('KLEPETO', 6.6, 1)
    for i in range(6):
        lid = lid - Pos(-12.5 + i * 5, -35, 17.5) * Box(2.6, 8, 2)
    # axle bosses
    bosses = []
    for (x, y) in WHEELS:
        s = 1 if x > 0 else -1
        bosses.append(Pos(s * 36.6, y, FLOOR + WR) * Rot(0, 90, 0) * Cylinder(5, 2))
    shell = union(shell, *bosses)
    return shell, lid


def frame_bolts():
    out = [Pos(x, y, 18.0) * button_screw(2.5) for x, y in [(-24, -38), (24, -38), (-24, 4), (24, 4)]]
    out += [Pos(s * 46, -5.3, 9) * button_screw(2.5) for s in (1, -1)]
    out += [Pos(x, y, -15) * button_screw(2.5, axis='-z') for x, y in [(-30, -42), (30, -42), (-30, 22), (30, 22), (0, -10)]]
    # hinge axle: steel rod through lugs and lifter, nuts outside
    out += [Pos(-35, HINGE[1], HINGE[2]) * hex_nut(3, axis='-x')]
    return out


def lifter():
    """Lifter in absolute CAD coords at rest (hinge at HINGE). Returns material -> shapes."""
    hy, hz = HINGE[1], HINGE[2]
    # fork assembly built horizontally from the hinge along +Y, then tipped down by FORK_ANG
    L = FORK_LEN
    arm = side_profile([(-5, -5), (6, -6.2), (L - 12, -2.6), (L - 6, -1.0), (L - 14, 2.6), (22, 7.5), (4, 6.5), (-5, 4)], 0, 6)
    arm = arm + Rot(0, 90, 0) * Cylinder(6, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    arm = arm - Rot(0, 90, 0) * Cylinder(1.7, 20)
    arms = [Pos(22, 0, 0) * arm, Pos(-28, 0, 0) * arm]
    brace = Pos(0, 16, 1.5) * Box(46, 7, 8)
    brace = fillet(brace.edges().filter_by(Axis.X), 1.5)
    printed = union(*arms, brace)
    # steel scoop: wide plate under the front of the arms, sharp leading lip, lightening slots
    sp = [(-38, 30), (38, 30), (41, L - 6), (40, L), (-40, L), (-41, L - 6)]
    scoop = extrude(make_face(Polyline(*sp, close=True)), amount=1.6)
    scoop = Pos(0, 0, -2.6) * scoop
    lip = side_profile([(L - 7, -1.0), (L, -2.6), (L - 7, -2.6)], -40, 40)
    for x in (-27, -9, 9, 27):
        scoop = scoop - Pos(x, 46, -2) * Rot(0, 0, 90) * extrude(SlotCenterToCenter(12, 5), amount=4, both=True)
    steel = scoop + lip
    # fork tines (thicker steel strips over the arms) – the "claws" that slide under opponents
    tines = []
    for x in (-25, 25):
        t = Pos(x, 0, 0) * side_profile([(26, -2.6), (L + 3, -2.6), (L + 3, -1.3), (L - 4, 0.6), (26, 0.6)], -4, 4)
        tines.append(t)
    steel = union(steel, *tines)
    bolts = [Pos(x, y, 0.6) * button_screw(2.0) for x in (-25, 25) for y in (34, 50)]
    tip = Rot(-FORK_ANG, 0, 0)
    out = {'print': [tip * printed], 'metal': [tip * steel], 'bolt': [tip * b for b in bolts]}
    # mast up to the jaw hinge (not tipped: rigid with the hinge frame)
    jy, jz = JAW[1] - hy, JAW[2] - hz
    mast = side_profile([(-5, -2), (5, -4), (jy + 5, jz - 2), (jy + 4, jz + 3), (jy - 4, jz + 4), (-6, 4)], 0, 4)
    mast = mast + Pos(0, jy, jz) * Rot(0, 90, 0) * Cylinder(5, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
    mast = mast - Pos(0, jy, jz) * Rot(0, 90, 0) * Cylinder(1.6, 20)
    out['print'] += [Pos(17, 0, 0) * mast, Pos(-21, 0, 0) * mast]
    # claw servo between the masts (shaft along +X on the jaw axis), lift servo horn outside the right lug
    sv = Rot(90, 0, 0) * Rot(0, 90, 0) * servo_body()      # shaft -> +X, length along Y
    sv = Pos(-5, jy - 5.5, jz) * sv
    out['servo'] = [sv]
    horn = Pos(35.2, 0, 0) * Rot(0, 90, 0) * servo_horn(8, 1.8, 2)
    out['servo'].append(Rot(-FORK_ANG, 0, 0) * horn)
    out['bolt'].append(Pos(35.2 + 3.4, 0, 0) * button_screw(2.0, axis='x'))
    return {m: [Pos(0, hy, hz) * s for s in ss] for m, ss in out.items()}


def jaw():
    """Claw jaw, closed pose, absolute coords (hinge at JAW)."""
    jy, jz = JAW[1], JAW[2]
    # curved side arms ending in hooked talons
    prof = [(-5, -3.5), (8, -3.2), (44, -2.5), (56, -6), (62, -14), (58, -16), (51, -9), (44, -6.5), (40, 3.5), (10, 4.2), (-5, 4)]
    arm = side_profile(prof, 0, 4)
    arm = arm + Rot(0, 90, 0) * Cylinder(5, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
    arm = arm - Rot(0, 90, 0) * Cylinder(1.6, 20)
    arms = [Pos(21.5, 0, 0) * arm, Pos(-25.5, 0, 0) * arm]
    bar = Pos(0, 40, 0) * Box(51, 7, 6)
    bar = fillet(bar.edges().filter_by(Axis.X), 1.6)
    tube = Pos(0, 0, 0) * Rot(0, 90, 0) * Cylinder(3.2, 43)
    printed = union(*arms, bar, tube)
    # steel tooth bar with five teeth, bolted under the crossbar
    teeth_bar = Pos(0, 46, -3.2) * Box(46, 6, 2)
    teeth = []
    for i in range(5):
        x = -18 + i * 9
        t = side_profile([(43.5, -3.2), (49, -3.2), (46.5, -12.5)], x - 1.6, x + 1.6)
        teeth.append(t)
    steel = union(teeth_bar, *teeth)
    bolts = [Pos(x, 40, 3) * button_screw(2.0) for x in (-12, 12)]
    bolts += [Pos(26.5, 0, 0) * hex_nut(3, axis='x'), Pos(-26.5, 0, 0) * hex_nut(3, axis='-x')]
    out = {'print': [printed], 'metal': [steel], 'bolt': bolts}
    return {m: [Pos(0, jy, jz) * s for s in ss] for m, ss in out.items()}


def build(out):
    root = Node('klepeto')
    fr = root.child('frame')
    shell, lid = frame()
    fr.add('print', shell)
    fr.add('accent', lid)
    fr.add('bolt', *frame_bolts())
    fr.add('metal', Pos(0, HINGE[1], HINGE[2]) * Rot(0, 90, 0) * Cylinder(1.5, 70))
    fr.add('servo', Pos(-15, -26, 18.0) * fillet(Box(6, 9, 1.6).edges().filter_by(Axis.Z), 0.6))
    fr.add('metal', Pos(-15, -26, 18.8) * Box(2.4, 3.2, 1.2))
    for i, (x, y) in enumerate(WHEELS):
        n = root.child(f'wheel_{i}', (x, y, FLOOR + WR))
        n.tol = (0.16, 0.5)
        for m, ss in wheel(WR, WW, 1 if x > 0 else -1, lugs=16).items():
            n.add(m, *[Pos(x, y, FLOOR + WR) * s for s in ss])
    lf = root.child('lifter', HINGE)
    for m, ss in lifter().items():
        lf.add(m, *ss)
    jw = lf.child('jaw', JAW)
    for m, ss in jaw().items():
        jw.add(m, *ss)
    ti = root.child('opt_armour_titan')
    ti.add('metal', side_profile([(32.2, -13), (33.8, -13), (33.8, 1.5), (32.2, 2.5)], -27, 27))
    ti.add('bolt', *[Pos(x, 33.8, -5) * button_screw(2.0, axis='y') for x in (-20, 20)])
    tp = root.child('opt_armour_tpu')
    for s in (1, -1):
        sk = rounded_slab([(50, -9), (52.5, -8.5), (52.5, -2), (50, -1.5)], -12, 8, r_vert=0.8, top=0.8, bottom=0.4)
        tp.add('accent', sk if s > 0 else mx(sk))
    st = write_glb(root, out)
    print('klepeto', st)


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else 'klepeto-raw.glb')
