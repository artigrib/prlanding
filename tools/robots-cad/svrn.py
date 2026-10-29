"""PROJECT SVRN – 150 g 4×4 pusher base with swappable front modules, rebuilt as a rigged arena model.

Base layout after Project SVRN by Shoverobotics / Jordan Gell (CC BY 4.0): low printed tub, four corner
wheels, two wedge pods either side of a front module bay. The front modules (flipper, wedge, grabber)
are our own parametric models for the arena (CC BY 4.0, printedrobotics.cz): we cannot ship the
original STEP, so they follow the published concept, not its exact geometry.

Geometry follows sim/arena/src/robots/catalog.js BASES.svrn (1 u = 10 cm = 100 mm):
  chassis half [54, 15, 45] mm -> x ±54, z -15..15, y -45..45; ride height 27 mm (floor at z = -27)
  wheels (±48, 28) and (±48, -28), R 20
  flipper hinge (0, 42, 12); plate tip at hinge + (y 44, z -37.5) -> 1.5 mm above the floor; plate ±50 wide
Nodes: frame, wheel_1..4 (axle centres), flipper (hinge; rotation.x < 0 lifts), and under it
opt_modul_flipper / opt_modul_klin / opt_modul_chapadlo (jaw = claw hinge inside the grabber),
plus opt_armour_titan / opt_armour_tpu like the other robots.
"""
import math
import sys

from build123d import Axis, Box, Cylinder, Pos, Rot, Polyline, make_face, extrude, fillet, chamfer, Align, mirror, Plane, SlotCenterToCenter
from parts import side_profile, rounded_slab, button_screw, hex_nut, wheel, engrave, union, servo_body, servo_horn
from gltfout import Node, write_glb

FLOOR = -27.0
WR, WW = 20.0, 12.0
WHEELS = [(48, 28), (-48, 28), (48, -28), (-48, -28)]
HINGE = (0.0, 42.0, 12.0)
TIP = (44.0, -37.5)                                     # plate tip relative to the hinge (y, z)
PLATE_ANG = math.degrees(math.atan2(-TIP[1], TIP[0]))   # ~40.4 deg below horizontal
PLATE_LEN = math.hypot(*TIP)
JAW = (0.0, 44.0, 27.0)                                 # grabber claw hinge (absolute, at rest)


def mx(s):
    return mirror(s, Plane.YZ)


def plate_z(y):
    """Underside of the flipper plate at rest, absolute z at absolute y (for the pods under it)."""
    return HINGE[2] + (y - HINGE[1]) * TIP[1] / TIP[0] - 1.0


def frame():
    # tub between the wheels, rounded rear corners, front bay for the module
    tub = rounded_slab([(-36, -45), (36, -45), (36, 34), (30, 40), (-30, 40), (-36, 34)], -15, 12, r_vert=6, top=2.5, bottom=1.2)
    # wheel arches: side walls outboard of the wheels at the rear, low skid between the wheels
    rail = rounded_slab([(55, -12), (57, -12), (57, 12), (55, 12)], -13, 6, r_vert=0.8, top=0.8, bottom=0.4)
    bridge = rounded_slab([(36, -12), (55, -12), (55, 12), (36, 12)], -13, -5, r_vert=0.8, top=0.8, bottom=0.4)
    rear = rounded_slab([(36, -54), (57, -54), (57, -46), (36, -46)], -14, 2, r_vert=2.5, top=1.2, bottom=0.6)
    # wedge pods ahead of the front wheels: top surface just under the flipper plate line
    pod_top = [(y, plate_z(y)) for y in (34, 60, 78)]
    pod = side_profile([(34, -14), (80, FLOOR + 1.6), (80, FLOOR + 3.0)] + [(y, z) for y, z in reversed(pod_top)], 38, 56)
    # hinge lugs either side of the bay
    lug = side_profile([(30, -6), (40, 4), (46, 12), (42, 17), (34, 16), (30, 10)], 28, 34)
    lug = lug + Pos(28, HINGE[1], HINGE[2]) * Rot(0, 90, 0) * Cylinder(5.5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    lug = lug - Pos(31, HINGE[1], HINGE[2]) * Rot(0, 90, 0) * Cylinder(1.7, 12)
    shell = union(tub, rail, mx(rail), bridge, mx(bridge), rear, mx(rear), pod, mx(pod), lug, mx(lug))
    # lid recess + lid with the name and vents
    lid_pts = [(-30, -40), (30, -40), (30, 26), (24, 32), (-24, 32), (-30, 26)]
    shell = shell - rounded_slab(lid_pts, 10.4, 14, r_vert=4, top=0, bottom=0)
    lid = rounded_slab(lid_pts, 10.4, 12.2, r_vert=3.6, top=0.6, bottom=0)
    lid = lid - Pos(0, -10, 12.2 - 0.5) * engrave('SVRN', 9, 1)
    for i in range(5):
        lid = lid - Pos(-12 + i * 6, -32, 11.7) * Box(3, 9, 2)
    # axle bosses
    bosses = []
    for (x, y) in WHEELS:
        s = 1 if x > 0 else -1
        bosses.append(Pos(s * 37, y, FLOOR + WR) * Rot(0, 90, 0) * Cylinder(5, 2))
    shell = union(shell, *bosses)
    return shell, lid


def frame_bolts():
    out = [Pos(x, y, 12.2) * button_screw(2.5) for x, y in [(-25, -35), (25, -35), (-25, 22), (25, 22)]]
    out += [Pos(s * 46, 66, plate_z(66) - 0.3) * button_screw(2.0) for s in (1, -1)]
    out += [Pos(x, y, -15) * button_screw(2.5, axis='-z') for x, y in [(-30, -40), (30, -40), (-30, 30), (30, 30), (0, -5)]]
    out += [Pos(-34.5, HINGE[1], HINGE[2]) * hex_nut(3, axis='-x'), Pos(34.5, HINGE[1], HINGE[2]) * hex_nut(3, axis='x')]
    return out


def plate_frame(shapes):
    """Place shapes built along +Y from the hinge into the rest pose (tipped down by PLATE_ANG)."""
    return [Rot(-PLATE_ANG, 0, 0) * s for s in shapes]


def mod_flipper():
    L = PLATE_LEN
    # steel plate with a sharpened lip and lightening slots, printed hinge knuckles and ribs under it
    plate = Pos(0, L / 2 + 2, -0.8) * Box(100, L - 4, 1.6)
    plate = chamfer(plate.edges().filter_by(Axis.Y), 0.5)
    lip = side_profile([(L - 2, -1.6), (L + 1.5, -1.6), (L - 2, 0.0)], -50, 50)
    for x in (-30, -10, 10, 30):
        plate = plate - Pos(x, L * 0.45, -1) * Rot(0, 0, 90) * extrude(SlotCenterToCenter(14, 5), amount=4, both=True)
    steel = plate + lip
    knuckles = []
    for x0, x1 in ((-26, -10), (10, 26)):
        k = Pos(x0, 0, 0) * Rot(0, 90, 0) * Cylinder(4.8, x1 - x0, align=(Align.CENTER, Align.CENTER, Align.MIN))
        k = k + side_profile([(0, -4.8), (12, -1.6), (12, 0), (0, 4.8)], x0, x1)
        knuckles.append(k - Rot(0, 90, 0) * Cylinder(1.6, 120))
    ribs = [side_profile([(10, -1.6), (L * 0.75, -1.6), (L * 0.6, -5.0), (12, -6.5)], x - 2, x + 2) for x in (-38, 38)]
    printed = union(*knuckles, *ribs)
    bolts = [Pos(x, y, 0) * button_screw(2.0) for x in (-38, 38) for y in (14, L * 0.6)]
    # servo horn on the hinge axis (right side) driving the plate through a short link
    horn = Pos(-31.5, 0, 0) * Rot(0, -90, 0) * Rot(0, 0, 200) * servo_horn(9, 1.8, 1)
    link = side_profile([(-1, -7.5), (9, -3.5), (10, -1.6), (8, -1.0), (-2, -5.6)], -30.5, -28.5)
    out = {'metal': plate_frame([steel]), 'print': plate_frame([printed]), 'bolt': plate_frame(bolts),
           'servo': plate_frame([horn, link])}
    return out


# wedge module: lower and longer than the flipper plate, bolted rigid to the bay (hull in catalog.js)
KLIN_ROOT = (-2.0, -10.0)          # wedge top edge relative to the hinge (y, z)
KLIN_TIP = (54.0, -37.5)           # leading edge relative to the hinge (y, z): 1.5 mm above the floor


def mod_klin():
    """Wedge module: fixed wide steel wedge on two printed brackets (no servo), in hinge-local coords."""
    (y0, z0), (y1, z1) = KLIN_ROOT, KLIN_TIP
    L = math.hypot(y1 - y0, z1 - z0)
    ang = math.degrees(math.atan2(-(z1 - z0), y1 - y0))
    wedge = Pos(0, L / 2, -0.9) * Box(104, L, 1.8)
    wedge = chamfer(wedge.edges().filter_by(Axis.Y), 0.5)
    lip = side_profile([(L - 3, -1.8), (L + 1, -1.8), (L - 3, 0.0)], -52, 52)
    steel = wedge + lip
    for x in (-34, 34):
        steel = steel - Pos(x, L * 0.62, -1) * Rot(0, 0, 90) * extrude(SlotCenterToCenter(10, 4), amount=4, both=True)
    place = Pos(0, y0, z0) * Rot(-ang, 0, 0)
    # printed mounting block across the bay, two gussets under the wedge, bolted to the hinge axle
    block = fillet((Pos(0, -3, -4) * Box(58, 10, 14)).edges().filter_by(Axis.X), 2)
    block = block - Rot(0, 90, 0) * Cylinder(1.6, 120)
    gussets = [side_profile([(y0 + 2, z0 - 1), (y0 + L * 0.5, z0 + (z1 - z0) * 0.5 - 2.5), (y0 + 4, z0 - 9)], x - 3, x + 3) for x in (-22, 22)]
    printed = union(block, *gussets)
    bolts = [place * Pos(x, y, 0) * button_screw(2.0) for x in (-22, 22) for y in (6, L * 0.4)]
    bolts += [place * Pos(x, L * 0.8, 0) * button_screw(2.0) for x in (-40, 0, 40)]
    return {'metal': [place * steel], 'print': [printed], 'bolt': bolts}


def mod_chapadlo():
    """Grabber module: lifting forks on the hinge + a claw on a mast. Returns (forks, jaw) dicts."""
    L = PLATE_LEN
    arm = side_profile([(-5, -5), (6, -6), (L - 10, -2.4), (L - 4, -1.0), (L - 12, 2.4), (18, 6.5), (2, 6), (-5, 4)], 0, 6)
    arm = arm + Rot(0, 90, 0) * Cylinder(5.5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    arm = arm - Rot(0, 90, 0) * Cylinder(1.7, 20)
    arms = [Pos(18, 0, 0) * arm, Pos(-24, 0, 0) * arm]
    brace = fillet((Pos(0, 14, 1.5) * Box(42, 7, 7)).edges().filter_by(Axis.X), 1.4)
    printed = union(*arms, brace)
    sp = [(-36, 22), (36, 22), (40, L - 5), (39, L), (-39, L), (-40, L - 5)]
    scoop = Pos(0, 0, -2.4) * extrude(make_face(Polyline(*sp, close=True)), amount=1.5)
    lip = side_profile([(L - 6, -0.9), (L + 1, -2.4), (L - 6, -2.4)], -39, 39)
    tines = [Pos(x, 0, 0) * side_profile([(22, -2.4), (L + 4, -2.4), (L + 4, -1.2), (L - 4, 0.6), (22, 0.6)], -3.5, 3.5) for x in (-24, 24)]
    steel = union(scoop, lip, *tines)
    bolts = [Pos(x, y, 0.6) * button_screw(2.0) for x in (-24, 24) for y in (28, 42)]
    forks = {'print': plate_frame([printed]), 'metal': plate_frame([steel]), 'bolt': plate_frame(bolts)}
    # mast up to the claw hinge (rigid with the forks' hinge frame, not tipped)
    jy, jz = JAW[1] - HINGE[1], JAW[2] - HINGE[2]
    mast = side_profile([(-5, -2), (5, -4), (jy + 5, jz - 2), (jy + 4, jz + 3), (jy - 4, jz + 4), (-6, 4)], 0, 4)
    mast = mast + Pos(0, jy, jz) * Rot(0, 90, 0) * Cylinder(4.5, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
    mast = mast - Pos(0, jy, jz) * Rot(0, 90, 0) * Cylinder(1.6, 20)
    forks['print'] += [Pos(13, 0, 0) * mast, Pos(-17, 0, 0) * mast]
    forks['servo'] = [Pos(-2, jy - 6, jz) * Rot(90, 0, 0) * Rot(0, 90, 0) * servo_body(l=20, w=10, h=18)]
    # claw (closed pose, local to the jaw hinge)
    prof = [(-4, -3), (8, -3), (38, -2.2), (48, -5.5), (53, -12.5), (49.5, -14), (43.5, -8), (37.5, -5.8), (34, 3), (8, 3.8), (-4, 3.6)]
    carm = side_profile(prof, 0, 3.6)
    carm = carm + Rot(0, 90, 0) * Cylinder(4.5, 3.6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    carm = carm - Rot(0, 90, 0) * Cylinder(1.6, 20)
    bar = fillet((Pos(0, 34, 0) * Box(42, 6, 5.5)).edges().filter_by(Axis.X), 1.4)
    tube = Rot(0, 90, 0) * Cylinder(3.0, 36)
    jaw_print = union(Pos(17.5, 0, 0) * carm, Pos(-21, 0, 0) * carm, bar, tube)
    teeth = [side_profile([(37, -2.8), (42, -2.8), (40, -10.5)], x - 1.4, x + 1.4) for x in (-14, -7, 0, 7, 14)]
    jaw_steel = union(Pos(0, 39.5, -2.8) * Box(36, 5, 1.8), *teeth)
    jaw = {'print': [jaw_print], 'metal': [jaw_steel], 'bolt': [Pos(x, 34, 2.7) * button_screw(2.0) for x in (-10, 10)]}
    return forks, jaw


def build(out):
    root = Node('svrn')
    fr = root.child('frame')
    shell, lid = frame()
    fr.add('print', shell)
    fr.add('accent', lid)
    fr.add('bolt', *frame_bolts())
    fr.add('metal', Pos(0, HINGE[1], HINGE[2]) * Rot(0, 90, 0) * Cylinder(1.5, 70))
    # Malenki-style receiver and power switch on the lid
    fr.add('servo', Pos(18, -22, 12.2) * fillet(Box(7, 10, 1.6).edges().filter_by(Axis.Z), 0.6))
    fr.add('metal', Pos(18, -22, 13.0) * Box(2.6, 3.4, 1.2))
    for i, (x, y) in enumerate(WHEELS):
        n = root.child(f'wheel_{i + 1}', (x, y, FLOOR + WR))
        n.tol = (0.16, 0.5)
        for m, ss in wheel(WR, WW, 1 if x > 0 else -1, lugs=16).items():
            n.add(m, *[Pos(x, y, FLOOR + WR) * s for s in ss])
    hinge = Pos(*HINGE)
    fl = root.child('flipper', HINGE)
    fl.tol = (0.1, 0.45)
    mf = fl.child('opt_modul_flipper')
    for m, ss in mod_flipper().items():
        mf.add(m, *[hinge * s for s in ss])
    mk = fl.child('opt_modul_klin')
    for m, ss in mod_klin().items():
        mk.add(m, *[hinge * s for s in ss])
    mc = fl.child('opt_modul_chapadlo')
    forks, jaw = mod_chapadlo()
    for m, ss in forks.items():
        mc.add(m, *[hinge * s for s in ss])
    jw = mc.child('jaw', JAW)
    for m, ss in jaw.items():
        jw.add(m, *[Pos(*JAW) * s for s in ss])
    ti = root.child('opt_armour_titan')
    ti.add('metal', side_profile([(-55.5, -13), (-54.0, -13), (-54.0, 4), (-55.5, 4)], -34, 34))
    ti.add('bolt', *[Pos(x, -55.5, -4) * button_screw(2.0, axis='y') for x in (-22, 22)])
    tp = root.child('opt_armour_tpu')
    for s in (1, -1):
        sk = rounded_slab([(57, -11), (59.5, -10.5), (59.5, 10.5), (57, 11)], -12, 5, r_vert=0.8, top=0.8, bottom=0.4)
        tp.add('accent', sk if s > 0 else mx(sk))
    st = write_glb(root, out)
    print('svrn', st)


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else 'svrn-raw.glb')
