// OpenFlexure Microscope v7 (tag v7.0.0-beta5), motorised high-resolution configuration
// (RMS objective optics module, Raspberry Pi Camera v2, 28BYJ-48 motors, Raspberry Pi 4 + Sangaboard in the stand).
// Exports ONE part (or sub-assembly) per run, already in its assembled position, for the catalogue GLB.
//
// SPDX-License-Identifier: CERN-OHL-S-2.0
// Modified from the OpenFlexure Microscope OpenSCAD sources,
// https://gitlab.com/openflexure/openflexure-microscope (tag v7.0.0-beta5).
// For copyright and authorship information of the original, see the Git history at:
// https://gitlab.com/openflexure/openflexure-microscope
// Modifications (2026-11-01, printedrobotics.cz): this wrapper only; it calls the authors' modules unchanged and places
// each part with the authors' placement functions (rendering/librender/assembly_parameters.scad) and the frames the
// authors use to build the motor lugs (openscad/libs/main_body_structure.scad, z_axis.scad, compact_nut_seat.scad).
// The authors' own assembly files rendering/mount_*.scad were not available to us, so motor and electronics positions
// are derived from those frames (see comments). Fasteners, elastic bands, cables, lenses inside the module and the
// LED board are not modelled (their meshes are binary files that are not in the sources we used).
//
// Usage: OPENSCADPATH=<dir with a symlink "ofm" -> source checkout> openscad -D 'PART="main_body"' -o part.stl ofm_assembly.scad

use <ofm/openscad/libs/utilities.scad>
use <ofm/openscad/libs/libdict.scad>
use <ofm/openscad/libs/microscope_parameters.scad>
use <ofm/openscad/libs/main_body_structure.scad>
use <ofm/openscad/libs/main_body_transforms.scad>
use <ofm/openscad/libs/libfeet.scad>
use <ofm/openscad/libs/gears.scad>
use <ofm/openscad/libs/lib_optics.scad>
use <ofm/openscad/libs/optics_configurations.scad>
use <ofm/openscad/libs/rms_calculations.scad>
use <ofm/openscad/libs/illumination.scad>
use <ofm/openscad/libs/lib_microscope_stand.scad>
use <ofm/openscad/libs/cameras/camera.scad>
use <ofm/openscad/libs/cameras/picamera_2.scad>
use <ofm/openscad/sample_clips.scad>
use <ofm/rendering/librender/assembly_parameters.scad>
use <ofm/rendering/librender/render_utils.scad>
use <ofm/rendering/librender/electronics.scad>
use <ofm/rendering/librender/optics.scad>

PART = "main_body";

PARAMS = render_params();                   // authors' render parameters (default_params without print ties)
STAND = default_stand_params(sanga_version="stack_11mm");   // electronics_drawer.scad default
// rms_optics_module.scad defaults
OPTICS = rms_f50d13_config(camera_type="picamera_2", beamsplitter=false, parfocal_distance=45,
                           camera_rotation=0, beamsplitter_rotation=0);

// Everything is in the main-body frame (body floor z = 0); the stand sits below it (microscope_on_stand_pos).
module on_stand(){ translate(-key_lookup("translation", microscope_on_stand_pos(STAND))) children(); }

// Motor lug frame: x/y lugs are built in leg_frame(angle) translate_y(actuating_nut_r) rotate(180) (xy_legs_and_actuators,
// screw_seat); the z lugs in translate_y(z_nut_y) rotate(180) motor_lugs(angle=180, tilt=-tilt) = translate(z_actuator_pos)
// rotate_x(tilt). In that frame motor_lugs puts the screw lugs at motor_screw_pos(h): shaft at [0,-20], lug tops at z.
module motor_frame(axis){
    if (axis == "z") translate(z_actuator_pos(PARAMS)) rotate_x(z_actuator_tilt(PARAMS)) translate([0, -20, z_motor_z_pos(PARAMS)]) children();
    else leg_frame(PARAMS, axis == "x" ? -45 : 45) translate_y(actuating_nut_r(PARAMS)) rotate(180)
         translate([0, -20, y_motor_z_pos(PARAMS)]) children();
}

module lead_placement(axis){
    place_part(axis == "x" ? x_lead_assembly_placement() : axis == "y" ? y_lead_assembly_placement() : z_lead_assembly_placement()) translate_z(1) children();
}

// picamera v2 board in the optics module's camera mount (picamera_2_camera_mount: board outline rotate(45) translate_y(2.4),
// board top = camera mount top - mount height); electronics.scad's picamera2() has its sensor at the origin, board top z = 0.
function camera_board_top_z() = rms_camera_mount_top_z(PARAMS, OPTICS) - camera_mount_height(OPTICS);

module part(name){
    if (name == "main_body") main_body(PARAMS, "v7.0.0-beta5", "");
    else if (name == "foot_x") place_part(x_foot_placement()) outer_foot(PARAMS, lie_flat=false, letter="X");
    else if (name == "foot_y") place_part(y_foot_placement()) outer_foot(PARAMS, lie_flat=false, letter="Y");
    else if (name == "foot_z") place_part(z_foot_placement()) middle_foot(PARAMS, lie_flat=false, letter="Z");
    else if (name == "large_gear_x") lead_placement("x") large_gear();
    else if (name == "large_gear_y") lead_placement("y") large_gear();
    else if (name == "large_gear_z") lead_placement("z") large_gear();
    else if (name == "small_gear_x") motor_frame("x") place_part(small_gear_pos()) small_gear();
    else if (name == "small_gear_y") motor_frame("y") place_part(small_gear_pos()) small_gear();
    else if (name == "small_gear_z") motor_frame("z") place_part(small_gear_pos()) small_gear();
    else if (name == "motor_x") motor_frame("x") motor28BYJ48_wo_wire();
    else if (name == "motor_y") motor_frame("y") motor28BYJ48_wo_wire();
    else if (name == "motor_z") motor_frame("z") motor28BYJ48_wo_wire();
    else if (name == "optics_module") place_part(optics_module_pos()) optics_module_rms(default_params(), OPTICS);
    else if (name == "objective") place_part(optics_module_pos()) translate_z(objective_shoulder_z(default_params(), OPTICS)) rendered_objective();
    else if (name == "camera") place_part(optics_module_pos()) translate_z(camera_board_top_z()) rotate(135) picamera2();
    else if (name == "camera_cover") place_part(optics_module_pos()) translate_z(camera_board_top_z() - 1 - 3.5) rotate(45) picamera_2_cover();
    else if (name == "sample_clip_1") leg_frame(PARAMS, 45) place_part(sample_clip_position(PARAMS)) default_sample_clip();
    else if (name == "sample_clip_2") leg_frame(PARAMS, -45) place_part(sample_clip_position(PARAMS)) default_sample_clip();
    else if (name == "illumination_dovetail") illumination_dovetail(default_params(), h=60);
    else if (name == "condenser") place_part(condenser_pos()) condenser();
    else if (name == "condenser_lid") place_part(condenser_pos()) translate_z(-condenser_lid_h()) condenser_lid();
    else if (name == "condenser_thumbscrew") place_part(condenser_pos()) place_part(condenser_clamp_axis_pos(14.4)) rotate_x(90) illumination_thumbscrew();
    else if (name == "stand") on_stand() microscope_stand(default_params(), STAND, supports=false);
    else if (name == "electronics_drawer") on_stand() electronics_drawer_frame_xy(default_params()) electronics_drawer(STAND);
    // Pi 4 on the drawer's standoffs (board inset, standoff height); Sangaboard stacked on the Pi header at
    // sanga_stand_height (lib_microscope_stand.scad). electronics.scad has a primitive for Sangaboard v0.4 only.
    else if (name == "raspberry_pi") on_stand() electronics_drawer_frame_xy(default_params()) translate(electronics_drawer_board_inset() + [0, 0, electronics_drawer_standoff_h()]) rpi_4b();
    else if (name == "sangaboard") on_stand() electronics_drawer_frame_xy(default_params()) translate(electronics_drawer_board_inset() + [0, 0, sanga_stand_height("stack_11mm")]) sangaboard_v0_4();
    else assert(false, str("unknown PART ", name));
}

part(PART);
