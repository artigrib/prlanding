# SO-101 flashlight holder (forge stage 0 design). Submitted through run_cad exactly as an LLM would.
# Frame: MuJoCo body "gripper" of sim/so101/model/so101.xml, millimetres (see devices/so101/mounts.json,
# interface "gripper_cam_face"). The plate sits on the fixed jaw's +y face and takes the two screws of
# the wrist-camera mount; the sleeve holds a 10 mm LED beside the camera, aimed at the TCP (gripperframe).
# Past the -x edge of the flat face the jaw falls away (beyond_edge_profile): a foot follows that surface
# so the whole seat bears on the jaw instead of hanging over the edge.
# The forge replaces the PARAMS line below with the job's parameters.
from build123d import *
import math

PARAMS = {"led_d": 10.0, "led_clear": 0.25, "flange_d": 11.4, "flange_h": 1.5, "wall": 1.8, "sleeve_len": 14.0, "tilt_deg": 21.5, "toe_deg": 28.4, "plate_t": 3.0, "hole_pitch": 8.0, "hole_mid_x": -0.95, "hole_z": -23.4, "face_y": 24.0, "hole_d": 3.4, "slot_extra": 0.6, "sleeve_x": -28.0, "sleeve_z": -24.0, "top_z": -14.0, "foot_gap": 0.1, "foot_min": 1.5, "foot_profile": [[-35.0, 13.48], [-34.0, 15.03], [-33.0, 15.61], [-32.0, 15.74], [-31.0, 15.74], [-30.0, 15.74], [-29.0, 15.74], [-28.0, 15.74], [-27.0, 15.74], [-26.0, 15.74], [-25.0, 15.87], [-24.0, 16.56], [-23.0, 17.25], [-22.0, 17.94], [-21.0, 18.63], [-20.0, 19.32], [-19.0, 20.0], [-18.0, 20.69], [-17.0, 21.38], [-16.0, 22.07], [-15.0, 22.75], [-14.0, 23.29], [-13.0, 23.66], [-12.0, 23.89]], "face_x_min": -12.8}

P = PARAMS
bore = P["led_d"] + P["led_clear"]
od = bore + 2 * P["wall"]
t = P["plate_t"]
y0 = P["face_y"]

# --- mounting plate on the camera face (screw holes as short slots along x for the ±0.6 mm pitch tolerance)
plate_x0, plate_x1 = max(P["sleeve_x"] - od / 2 + 1.0, P["foot_profile"][0][0] + 0.5), P["hole_mid_x"] + P["hole_pitch"] / 2 + 4.0
plate_z0, plate_z1 = P["hole_z"] - 6.0, max(P["hole_z"] + 6.0, P["top_z"])
plate = Pos((plate_x0 + plate_x1) / 2, y0 + t / 2, (plate_z0 + plate_z1) / 2) * Box(plate_x1 - plate_x0, t, plate_z1 - plate_z0)

# --- saddle between plate and sleeve
cy = y0 + t + od / 2 - 1.0          # sleeve axis height above the jaw face
saddle = Pos(P["sleeve_x"], (y0 + cy) / 2, P["sleeve_z"]) * Box(od - 2.0, cy - y0, 12.0)

# --- LED sleeve: built along +z, LED looks along -z, then aimed (tilt towards -y, toe towards +x)
aim = Rot(Y=-P["toe_deg"]) * Rot(X=-P["tilt_deg"])
centre = Pos(P["sleeve_x"], cy, P["sleeve_z"])
sleeve = centre * aim * Cylinder(od / 2, P["sleeve_len"])
body = plate + saddle + sleeve
body = body - centre * aim * Cylinder(bore / 2, P["sleeve_len"] + 20.0)
# seat for the LED collar at the back (+z end of the sleeve)
body = body - centre * aim * Pos(0, 0, P["sleeve_len"] / 2 - P["flange_h"] / 2 + 0.01) * Cylinder(P["flange_d"] / 2, P["flange_h"])
# keep the rest of the body out of the light cone: trim anything in front of the sleeve face
front = centre * aim * Pos(0, 0, -P["sleeve_len"] / 2 - 15.0) * Box(40.0, 40.0, 30.0)
body = body - front
# nothing below the jaw face (the foot below is added afterwards)
body = body - Pos(P["sleeve_x"] + 10.0, y0 - 20.0, P["sleeve_z"]) * Box(120.0, 40.0, 120.0)

# --- conforming foot: from the plate underside down to the jaw surface past the flat face's -x edge,
# over the plate's z band, foot_gap above the measured surface (prismatic along z).
# the foot stops where it would get thinner than foot_min (no knife edge at the face edge)
prof = [(x, y + P["foot_gap"]) for x, y in P["foot_profile"] if plate_x0 - 1e-6 <= x and y + P["foot_gap"] <= y0 - P["foot_min"]]
if prof:
    # start the foot exactly at the plate's -x edge: the surface height there is interpolated from the
    # measured profile, so no strip of the seat between the plate edge and the first sample hangs in the air
    fp = P["foot_profile"]
    xa, xb = plate_x0, prof[-1][0]
    ya = prof[0][1]
    for (x0_, y0_), (x1_, y1_) in zip(fp, fp[1:]):
        if x0_ <= xa <= x1_:
            ya = y0_ + (y1_ - y0_) * (xa - x0_) / (x1_ - x0_) + P["foot_gap"]
            break
    pts = [(xa, y0 + 1.0), (xa, ya)] + [(x, y) for x, y in prof if xa + 0.05 < x <= xb] + [(xb, y0 + 1.0)]
    # z band: the plate and the saddle under the sleeve (the saddle reaches below the plate)
    fz0 = min(plate_z0, P["sleeve_z"] - 6.0)
    foot = Pos(0, 0, fz0) * extrude(Polygon(*pts, align=None), amount=plate_z1 - fz0)
    # the foot runs under the whole saddle, so it is also the rib that carries the sleeve into the jaw
    body = body + foot
# flat print face: nothing above top_z (the part prints standing on this face, bore pointing down)
body = body - Pos(0, 0, P["top_z"] + 50.0) * Box(200.0, 200.0, 100.0)

# --- screw slots (M3 clearance) through the plate
for sx in (P["hole_mid_x"] - P["hole_pitch"] / 2, P["hole_mid_x"] + P["hole_pitch"] / 2):
    slot = Pos(sx, y0 + t / 2, P["hole_z"]) * Box(2 * P["slot_extra"], t + 2.0, P["hole_d"])
    for dx in (-P["slot_extra"], P["slot_extra"]):
        slot = slot + Pos(sx + dx, y0 + t / 2, P["hole_z"]) * Rot(X=90) * Cylinder(P["hole_d"] / 2, t + 2.0)
    body = body - slot

result = body

ta, to = math.radians(P["tilt_deg"]), math.radians(P["toe_deg"])
d = (math.sin(to) * math.cos(ta), -math.sin(ta), -math.cos(to) * math.cos(ta))
front_c = (P["sleeve_x"] + d[0] * P["sleeve_len"] / 2, cy + d[1] * P["sleeve_len"] / 2, P["sleeve_z"] + d[2] * P["sleeve_len"] / 2)
meta = {
    "frame": "gripper body, mm",
    "mount_interface": "gripper_cam_face",
    "led_axis_dir": [round(v, 4) for v in d],
    "led_front_center": [round(v, 2) for v in front_c],
    "emitter_axis": {"origin": [round(v, 2) for v in front_c], "dir": [round(v, 4) for v in d], "kind": "light"},
    "sleeve_center": [P["sleeve_x"], round(cy, 2), P["sleeve_z"]],
    "bore_d": bore,
    "screw_holes": [[P["hole_mid_x"] - P["hole_pitch"] / 2, y0, P["hole_z"]], [P["hole_mid_x"] + P["hole_pitch"] / 2, y0, P["hole_z"]]],
    "print_build_dir": [0, 0, -1],
    "print_note": "flat top face (z = top_z) on the bed; the LED bore points down at an angle, no supports",
    "params": P,
}
