"""KOSA – 150 g horizontal undercutter (original design, printedrobotics.cz, CC BY 4.0).

Geometry follows sim/arena/src/robots/catalog.js BASES.kosa (1 u = 10 cm = 100 mm):
  chassis box half [50, 12, 40] mm offset y = -6  -> x ±50, z -12..12, y -46..34
  wheels (±43, -18), R 22.5, ride height 27 mm (floor at z = -27)
  weapon axle (0, 42, -16), blade radius 50, spins about +Z (counter-clockwise from above)
"""
import math
import sys

from build123d import Axis, Box, Cylinder, Pos, Rot, Polyline, make_face, extrude, fillet, chamfer, Align, Circle, SlotCenterToCenter, GeomType
from parts import side_profile, rounded_slab, cap_screw, button_screw, hex_nut, wheel, engrave, union
from gltfout import Node, write_glb

FLOOR = -27.0
WR, WW = 22.5, 12.0
WHEELS = [(43, -18), (-43, -18)]
AX = (0.0, 42.0, -16.0)
BR = 50.0


def body():
    # main tub: wide flat hull, nose tapers towards the weapon boom
    pts = [(-34, -46), (34, -46), (34, 14), (26, 30), (-26, 30), (-34, 14)]
    tub = rounded_slab(pts, -12, 12, r_vert=3, top=3.2, bottom=1.2)
    # sloped nose: top falls from z 12 at y 12 to z 2 at y 32
    tub = tub - side_profile([(12, 12.01), (40, 12.01), (40, -3), (33, 1.5)], -40, 40)
    # side pods in front of / behind the wheels (wheels sit in open wells)
    fpod = rounded_slab([(34, 7), (50, 9), (50, 24), (44, 31), (34, 31)], -12, 7, r_vert=2.5, top=2.5, bottom=1)
    rpod = rounded_slab([(34, -49), (50, -49), (50, -42.6), (34, -42.6)], -12, 7, r_vert=1.6, top=1.6, bottom=0.6)
    pods = [fpod, mirror_x(fpod), rpod, mirror_x(rpod)]
    shell = union(tub, *pods)
    # lid recess + lid
    lid_pts = [(-27, -40), (27, -40), (27, 6), (21, 12), (-21, 12), (-27, 6)]
    recess = rounded_slab(lid_pts, 11.2, 14, r_vert=3, top=0, bottom=0)
    shell = shell - recess
    lid = rounded_slab(lid_pts, 11.2, 12.9, r_vert=2.6, top=0.6, bottom=0)
    lid = lid - Pos(0, -10, 12.9 - 0.5) * engrave('KOSA', 9, 1)
    # vent slots at the back of the lid (over the ESC)
    for i in range(5):
        lid = lid - Pos(-12 + i * 6, -33, 12.4) * Box(3, 9, 2)
    # wheel axle bosses on the tub sides
    bosses = [Pos(s * 34.5, -18, -4.5) * Rot(0, 90, 0) * Cylinder(6, 3) for s in (1, -1)]
    shell = union(shell, *bosses)
    # weapon boom: motor plate from the nose to the axle
    boom_pts = [(-16, 6), (16, 6), (16, AX[1]), (-16, AX[1])]
    boom = rounded_slab(boom_pts, 1, 7, r_vert=0, top=1.5, bottom=0.6)
    boom = boom + Pos(0, AX[1], 1) * Cylinder(17, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    boom = chamfer(boom.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[-1], 1.4)
    boom = boom - Pos(0, AX[1], 0) * Cylinder(5.2, 20)
    shell = shell + boom
    return shell, lid


def mirror_x(s):
    from build123d import mirror, Plane
    return mirror(s, Plane.YZ)


def screws_top():
    pos = [(-23, -36), (23, -36), (-23, 2), (23, 2)]
    out = [Pos(x, y, 12.9) * button_screw(2.5) for x, y in pos]
    # pods
    for s in (1, -1):
        out.append(Pos(s * 42, 18, 7) * button_screw(2.5))
    # boom: four motor screws around the axle + two into the tub
    for a in (45, 135, 225, 315):
        r = 10.5
        out.append(Pos(AX[0] + r * math.cos(math.radians(a)), AX[1] + r * math.sin(math.radians(a)), 7) * cap_screw(2.5))
    for s in (1, -1):
        out.append(Pos(s * 10, 13, 7) * cap_screw(2.5))
    return out


def screws_bottom():
    pos = [(-28, -40), (28, -40), (-28, 8), (28, 8), (0, -15)]
    return [Pos(x, y, -12) * button_screw(2.5, axis='-z') for x, y in pos]


def motor():
    """Brushless outrunner hanging under the boom: stator mount + rotating bell (bell is part of the blade node)."""
    mount = Pos(AX[0], AX[1], 1) * Cylinder(12.5, 2.4, align=(Align.CENTER, Align.CENTER, Align.MAX))
    mount = chamfer(mount.edges().group_by(Axis.Z)[0], 0.6)
    # three phase wires running back into the tub
    wires = [Pos(x, 0, 0) * Pos(0, 25, 7.9) * Rot(90, 0, 0) * Cylinder(0.75, 18) for x in (-3.5, 0, 3.5)]
    return mount, wires


def bell():
    """Outrunner bell, local frame centred on the axle (z = 0 is the blade's mid-plane)."""
    h0, h1 = 2.0, 15.6
    b = Pos(0, 0, h0) * Cylinder(13.5, h1 - h0, align=(Align.CENTER, Align.CENTER, Align.MIN))
    b = fillet(b.edges().group_by(Axis.Z)[-1], 1.2)
    # cooling windows around the bell top
    for i in range(6):
        b = b - Rot(0, 0, i * 60 + 30) * Pos(10.5, 0, h1) * Box(5, 5.5, 3)
    # groove rings
    for z in (5.0, 8.0):
        ring = Pos(0, 0, z) * (Cylinder(14, 0.8) - Cylinder(13.0, 2))
        b = b - ring
    return b


def blade_bar(t=4.0, light=False):
    """Steel bar blade along X; leading edges (CCW): +Y side at +X tip, -Y side at -X tip."""
    L = BR
    wc, we = (18.0, 13.0) if not light else (15.0, 11.0)
    pts = [(-L + 3, -we / 2), (-14, -wc / 2), (14, -wc / 2), (L - 1, -we / 2), (L, we / 2 - 2), (L - 3, we / 2),
           (14, wc / 2), (-14, wc / 2), (-L + 1, we / 2), (-L, -we / 2 + 2)]
    bar = extrude(make_face(Polyline(*pts, close=True)), amount=t)
    bar = Pos(0, 0, -t / 2) * bar
    # sharpened leading edges (bevel only on the trailing-to-leading diagonal faces)
    if light:
        for sx in (1, -1):
            bar = bar - Pos(sx * 27, 0, 0) * Rot(0, 0, 0) * extrude(SlotCenterToCenter(12, 5), amount=t + 2, both=True)
    # impactor teeth: hardened blocks bolted on the leading corners
    teeth = []
    for sx in (1, -1):
        tb = Box(9, 6.5, t + 3.2)
        tb = chamfer(tb.edges().filter_by(Axis.Z), 1.0)
        teeth.append(Pos(sx * (L - 6.5), sx * (we / 2 - 1.5), 0) * tb)
    # hub boss + clamp washer and nut under the blade
    hub = Pos(0, 0, -t / 2) * Cylinder(8, 2.4, align=(Align.CENTER, Align.CENTER, Align.MAX))
    hub = chamfer(hub.edges().group_by(Axis.Z)[0], 0.6)
    bolts = [Pos(7 * math.cos(a), 7 * math.sin(a), -t / 2 - 2.4) * button_screw(2.5, axis='-z') for a in (0.0, math.pi)]
    nut = Pos(0, 0, -t / 2 - 2.4) * hex_nut(5, axis='-z')
    return bar, teeth, hub, bolts, nut


def blade_disc(t=4.0):
    d = Cylinder(BR - 2.5, t)
    d = chamfer(d.edges(), 0.8)
    for i in range(4):
        d = d - Rot(0, 0, 45 + i * 90) * Pos(27, 0, 0) * Cylinder(7.5, t + 2)
    teeth = []
    for sx in (1, -1):
        tb = Box(10, 8, t + 3.2)
        tb = chamfer(tb.edges().filter_by(Axis.Z), 1.0)
        teeth.append(Pos(sx * (BR - 5), sx * 2, 0) * tb)
    hub = Pos(0, 0, -t / 2) * Cylinder(8, 2.4, align=(Align.CENTER, Align.CENTER, Align.MAX))
    hub = chamfer(hub.edges().group_by(Axis.Z)[0], 0.6)
    bolts = [Pos(7 * math.cos(a), 7 * math.sin(a), -t / 2 - 2.4) * button_screw(2.5, axis='-z') for a in (0.0, math.pi)]
    nut = Pos(0, 0, -t / 2 - 2.4) * hex_nut(5, axis='-z')
    return d, teeth, hub, bolts, nut


def build(out):
    root = Node('kosa')
    frame = root.child('frame')
    shell, lid = body()
    frame.add('print', shell)
    frame.add('accent', lid)
    frame.add('bolt', *screws_top(), *screws_bottom())
    mount, wires = motor()
    frame.add('accent', mount)
    frame.add('copper', *wires)
    # power switch + LED on the lid
    frame.add('servo', Pos(15, -22, 12.9) * fillet(Box(6, 9, 1.6).edges().filter_by(Axis.Z), 0.6))
    frame.add('metal', Pos(15, -22, 13.7) * Box(2.4, 3.2, 1.2))
    # front skid buttons (under the pods)
    for s in (1, -1):
        sk = Pos(s * 44, 16, -12) * Cylinder(3.5, 3, align=(Align.CENTER, Align.CENTER, Align.MAX))
        sk = fillet(sk.edges().group_by(Axis.Z)[0], 1.4)
        frame.add('servo', sk)
    # wheels
    for i, (x, y) in enumerate(WHEELS):
        n = root.child(f'wheel_{i}', (x, y, FLOOR + WR))
        n.tol = (0.16, 0.5)
        for m, ss in wheel(WR, WW, 1 if x > 0 else -1, lugs=18).items():
            n.add(m, *[Pos(x, y, FLOOR + WR) * s for s in ss])
    # blade (spins about the axle; variants by modification)
    bl = root.child('blade', AX)
    bl.add('accent', Pos(*AX) * bell())
    bl.add('metal', Pos(AX[0], AX[1], AX[2] + 15.6) * Cylinder(2.5, 3, align=(Align.CENTER, Align.CENTER, Align.MIN)))
    for name, parts in (('opt_blade_tyc', blade_bar()), ('opt_blade_lehka', blade_bar(3.0, light=True)), ('opt_blade_disk', blade_disc())):
        v = bl.child(name, AX)
        bar, teeth, hub, bolts, nut = parts
        v.add('metal', Pos(*AX) * bar)
        v.add('bolt', *[Pos(*AX) * t for t in teeth])
        v.add('accent', Pos(*AX) * hub)
        v.add('bolt', *[Pos(*AX) * b for b in bolts], Pos(*AX) * nut)
    # armour options
    ti = root.child('opt_armour_titan')
    ti.add('metal', side_profile([(12.5, 12.6), (14.5, 12.6), (34.2, 2.6), (34.2, -1), (32.6, -1), (32.6, 1.4)], -25, 25))
    ti.add('bolt', *[Pos(x, 22, 8.9) * Rot(-27, 0, 0) * button_screw(2.5) for x in (-18, 18)])
    tp = root.child('opt_armour_tpu')
    for s in (1, -1):
        sk = rounded_slab([(50, 9), (52.5, 10), (52.5, 24), (50, 27)], -11, 5, r_vert=1, top=1, bottom=0.6)
        for k in range(4):
            sk = sk - Pos(52.5, 12 + k * 4, -3) * Box(1.6, 1.4, 20)
        tp.add('accent', sk if s > 0 else mirror_x(sk))
    st = write_glb(root, out)
    print('kosa', st)


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else 'kosa-raw.glb')
