"""Shared parametric parts for the printedrobotics.cz arena robots (original designs, CC BY 4.0).

All dimensions in mm. CAD frame: +X right, +Y forward, +Z up.
"""
import math

from build123d import (Axis, Box, Cylinder, Pos, Rot, Polyline, Plane, Text, FontStyle, Circle,
                       RegularPolygon, chamfer, extrude, fillet, make_face, Part, Compound, Location,
                       Align, Sketch, offset, GeomType)


def union(*shapes):
    out = None
    for s in shapes:
        if s is None:
            continue
        out = s if out is None else out + s
    return out


def rounded_slab(pts, z0, z1, r_vert=2.0, top=1.5, bottom=0.8):
    """Prism from a closed XY polygon, vertical edges rounded, top/bottom edges chamfered."""
    if r_vert:
        r_vert = max(r_vert, top + 0.6, bottom + 0.6)
    face = make_face(Polyline(*pts, close=True))
    if r_vert:
        for r in (r_vert, r_vert * 0.6, r_vert * 0.35):
            try:
                face = fillet(face.vertices(), r)
                break
            except Exception:
                continue
    body = extrude(Pos(0, 0, z0) * face, amount=z1 - z0)
    for which, c in ((-1, top), (0, bottom)):
        while c and c > 0.15:
            try:
                body = chamfer(body.edges().group_by(Axis.Z)[which], c)
                break
            except Exception:
                c *= 0.7
    return body


def side_profile(pts, x0, x1):
    """Extrude a closed (y, z) side-view profile across x0..x1."""
    f = Plane.YZ * make_face(Polyline(*pts, close=True))
    return Pos(x0, 0, 0) * extrude(f, amount=x1 - x0)


def cap_screw(d=3.0, head_h=None, axis='z', flip=False):
    """ISO 4762-ish socket head cap screw head (only the visible head), seated at origin, pointing +axis."""
    hd = d * 1.75
    hh = head_h or d * 0.9
    head = Pos(0, 0, hh / 2) * Cylinder(hd / 2, hh)
    head = chamfer(head.edges().group_by(Axis.Z)[-1], hd * 0.08)
    sock = Pos(0, 0, hh - d * 0.35) * extrude(RegularPolygon(d * 0.45, 6), amount=d)
    s = head - sock
    if flip:
        s = Rot(180, 0, 0) * s
    if axis == 'x':
        s = Rot(0, 90, 0) * s
    elif axis == '-x':
        s = Rot(0, -90, 0) * s
    elif axis == 'y':
        s = Rot(-90, 0, 0) * s
    elif axis == '-y':
        s = Rot(90, 0, 0) * s
    return s


def button_screw(d=3.0, axis='z'):
    """ISO 7380 button head screw head."""
    hd = d * 1.9
    hh = d * 0.55
    head = Pos(0, 0, hh / 2) * Cylinder(hd / 2, hh)
    head = fillet(head.edges().group_by(Axis.Z)[-1], hh * 0.8)
    sock = Pos(0, 0, hh - d * 0.3) * extrude(RegularPolygon(d * 0.4, 6), amount=d)
    s = head - sock
    if axis == 'x':
        s = Rot(0, 90, 0) * s
    elif axis == '-x':
        s = Rot(0, -90, 0) * s
    elif axis == '-z':
        s = Rot(180, 0, 0) * s
    elif axis == 'y':
        s = Rot(-90, 0, 0) * s
    return s


def hex_nut(d=3.0, axis='z'):
    s = d * 1.8
    n = extrude(RegularPolygon(s / math.sqrt(3), 6), amount=d * 0.8)
    n = chamfer(n.edges().group_by(Axis.Z)[-1], d * 0.12)
    n = n - Pos(0, 0, -1) * Cylinder(d / 2, d * 3, align=(Align.CENTER, Align.CENTER, Align.MIN))
    if axis == 'x':
        n = Rot(0, 90, 0) * n
    elif axis == '-x':
        n = Rot(0, -90, 0) * n
    elif axis == '-z':
        n = Rot(180, 0, 0) * n
    return n


def wheel(R, w, side, lugs=22, hub_style='spokes'):
    """Wheel centred at the origin, axis along X. side=+1 right wheel (outer face +X), -1 left.

    Returns dict material -> [shapes]: rubber tyre with tread blocks, printed hub, screw + nut."""
    tread_h = 1.1
    r_core = R - tread_h
    r_rim = R * 0.62
    # tyre carcass: ring with rounded shoulders
    tyre = Cylinder(r_core, w) - Cylinder(r_rim, w + 2)
    outer = [e for e in tyre.edges() if e.geom_type == GeomType.CIRCLE and abs(e.radius - r_core) < 0.01]
    tyre = fillet(outer, min(2.2, w * 0.22))
    # tread: chevron-ish lugs, two staggered rows with a centre groove
    blocks = []
    lw = (w - 2.6) / 2 - 0.4
    for i in range(lugs):
        a = 360.0 * i / lugs
        for row, zc in ((0, w / 4 + 0.3), (1, -w / 4 - 0.3)):
            aa = a + (180.0 / lugs if row else 0)
            blk = Box(tread_h * 2 + 0.6, 2 * math.pi * R / lugs * 0.52, lw)
            blk = Rot(0, 0, 14 if row else -14) * blk  # slight skew: reads as a directional tread
            blocks.append(Rot(0, 0, aa) * Pos(r_core + tread_h / 2 - 0.3, 0, zc) * blk)
    tread = union(*blocks)
    # clip the tread to the tyre envelope so the shoulders stay round
    env = Cylinder(R, w - 0.8)
    tread = tread & env
    tyre = tyre + tread
    # hub
    hub = Cylinder(r_rim + 0.2, w - 1.0) - Cylinder(r_rim - 2.4, w + 2)
    face_t = 2.0
    disc = Pos(0, 0, -w / 2 + 0.5 + face_t / 2 + w * 0.12) * Cylinder(r_rim - 2.2, face_t)
    boss = Pos(0, 0, -w / 2 + 0.5 + w * 0.12) * Cylinder(4.6, w * 0.88, align=(Align.CENTER, Align.CENTER, Align.MIN))
    hub = hub + disc + boss
    if hub_style == 'spokes':
        nh = 5
        for i in range(nh):
            a = 2 * math.pi * i / nh + math.pi / nh
            rr = (r_rim - 2.4 + 5.0) / 2 + 0.6
            hub = hub - Pos(rr * math.cos(a), rr * math.sin(a), 0) * Cylinder(min(2.6, (r_rim - 8) * 0.38), w + 4)
    hub = hub - Cylinder(1.5, w + 4)
    hub = chamfer(hub.edges().group_by(Axis.Z)[0], 0.5)
    screw = Pos(0, 0, -w / 2 + 0.5 + w * 0.12 - 0.2) * Rot(180, 0, 0) * button_screw(3)
    # orient: the cylinder axis Z -> X; outer face (where the screw is, -Z) to the wheel's outside
    rot = Rot(0, -90, 0) if side > 0 else Rot(0, 90, 0)
    return {'rubber': [rot * tyre], 'print': [rot * hub], 'bolt': [rot * screw]}


def servo_body(l=23.0, w=12.2, h=22.0, flange=4.6):
    """Generic 9 g micro servo envelope, output shaft on +Z at x = l/2 - 6 (local frame)."""
    body = Box(l, w, h)
    body = fillet(body.edges().filter_by(Axis.Z), 0.8)
    fl = Pos(0, 0, h / 2 - 5) * Box(l + 2 * flange, w, 1.6)
    fl = fl - Pos(l / 2 + flange / 2, 0, h / 2 - 5) * Cylinder(1.0, 4) - Pos(-l / 2 - flange / 2, 0, h / 2 - 5) * Cylinder(1.0, 4)
    top = Pos(l / 2 - 6, 0, h / 2 + 2) * Cylinder(5.8 / 2 + 0.8, 4)
    return body + fl + top


def servo_horn(r=7.5, t=1.8, arms=2):
    """Plastic horn: hub + tapered arms, lies in XY at z = 0..t."""
    hub = Cylinder(3.6, t + 1.6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    pts = [(0, -2.6), (r, -1.4), (r + 1.2, 0), (r, 1.4), (0, 2.6)]
    arm = extrude(make_face(Polyline(*pts, close=True)), amount=t)
    h = hub
    for i in range(arms):
        h = h + Rot(0, 0, 360.0 * i / arms) * arm
    for i in range(arms):
        for k in (0.55, 0.85):
            h = h - Rot(0, 0, 360.0 * i / arms) * Pos(r * k, 0, 0) * Cylinder(0.55, t * 4)
    return h


def engrave(text, size, depth=0.5, font='DejaVu Sans', bold=True):
    s = Text(text, font_size=size, font=font, font_style=FontStyle.BOLD if bold else FontStyle.REGULAR)
    return extrude(s, amount=depth)
