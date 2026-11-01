// English catalogue data. Load right after assets/data.js on /en/ pages; it overlays the Czech
// entries in place (so app.js renders English without knowing about languages) and keeps the
// Czech originals on r._cs. Only translated fields are listed; ids, licences, links, images and
// prices stay as in data.js (prices are copied, never invented). Metric units, decimal points.
window.PR_EN = {
  colors: { white: 'White', grey: 'Grey', black: 'Black', orange: 'Orange', blue: 'Blue' },
  cats: { arm: 'Arms and hands', mobile: 'Mobile', legged: 'Walking', desk: 'Desktop', combat: 'Combat robots' },
  levels: { 'Začátečník': 'Beginner', 'Střední': 'Intermediate', 'Pokročilý': 'Advanced' },
  robots: {
    so101: { type: 'Robot arm', author: 'The Robot Studio and Hugging Face', alt: 'SO-101 robot arm',
      short: 'Five-axis arm with a gripper for AI and teleoperation with LeRobot. A leader + follower pair.',
      lead: 'Five-axis arm with a gripper for robot learning and teleoperation. You guide the leader arm by hand, the follower copies the motion – and with LeRobot it learns to do the task on its own.',
      bomCost: '≈ 130 USD per arm (US prices from the project’s bill of materials, without shipping and VAT; for Czechia see the buying plan)', printTime: '≈ 16.5 h per pair',
      card: [['Axes', '5 + gripper'], ['Software', 'LeRobot']],
      specs: [['Degrees of freedom', '5 axes + gripper'], ['Actuators', 'Feetech STS3215'], ['Power', '5 V (7.4 V servos); follower with 12 V servos: 12 V'], ['Print', 'PLA+, 0.2 mm layers'], ['Print time', '≈ 16.5 h per pair']] },
    lekiwi: { type: 'Mobile manipulator', alt: 'LeKiwi mobile robot with omni wheels and an SO-101 arm',
      short: 'Holonomic three-wheel base with an SO-101 arm, Raspberry Pi 5 and two cameras.',
      lead: 'Holonomic three-wheel base with an SO-101 arm, Raspberry Pi 5 and two cameras. Built for data collection and teleoperation in LeRobot.',
      card: [['Drive', '3× omni wheel'], ['Controller', 'Raspberry Pi 5']],
      bom: [['Raspberry Pi 5', '1×'], ['Omni wheel', '3×'], ['Base drive servos', '3×'], ['SO-101 arm: servos and driver board', '1 set'], ['5 V or 12 V power supply', '1×'], ['RGB camera', '2×']],
      specs: [['Drive', '3× omni wheel'], ['Controller', 'Raspberry Pi 5'], ['Arm', 'SO-101'], ['Cameras', '2× RGB'], ['Variants', '5 V and 12 V']] },
    xle: { type: 'Two-armed home robot', hw: 'Apache-2.0 (being verified)', author: 'Gaotian Wang et al.', alt: 'XLeRobot with two arms on a cart',
      short: 'Two SO-101 arms on a mobile base. Teleoperation via VR or gamepad.',
      lead: 'Two SO-101 arms on a mobile base. Teleoperation via VR or gamepad, sim2real research.',
      bomCost: 'from 660 USD',
      card: [['Arms', '2× SO-101'], ['Control', 'VR, gamepad']],
      bom: [['SO-101 arm: servos and driver boards', '2 sets'], ['Mobile base', '1×'], ['Battery', '1×'], ['Cameras', '3×']],
      specs: [['Arms', '2× SO-101'], ['Control', 'VR, gamepad']] },
    duck: { type: 'Bipedal robot', author: 'Antoine Pirrone and community', alt: 'Open Duck Mini v2 bipedal robot',
      short: 'Small walking robot driven by an RL policy. 51 printed parts including TPU.',
      lead: 'Small walking robot driven by a learned RL policy. 51 printed parts, including flexible TPU feet.',
      bomCost: 'under 400 USD', software: 'Python, RL policy',
      card: [['Height', '≈ 42 cm'], ['Controller', 'RPi Zero 2W']],
      bom: [['Feetech servos (legs and neck)', 'per BOM'], ['Raspberry Pi Zero 2W', '1×'], ['IMU', '1×'], ['Battery', '1×'], ['Bearings', '1 set']],
      specs: [['Height', '≈ 42 cm'], ['Controller', 'RPi Zero 2W'], ['Printed parts', '51 (PLA + TPU)'], ['Walking', 'RL policy']] },
    hand: { type: 'Robot hand', alt: 'AmazingHand four-finger robot hand',
      short: 'Four-finger hand with 8 degrees of freedom and the actuators inside.',
      lead: 'Four-finger hand with 8 degrees of freedom and the actuators inside. Use it on its own for grasping research, or as an add-on to an arm.',
      bomCost: 'under 200 EUR',
      card: [['Axes', '8 DOF'], ['Weight', '≈ 400 g']],
      bom: [['Feetech micro servo', '8×'], ['Servo driver board', '1×'], ['Power supply', '1×'], ['Pins and screws', '1 set']],
      specs: [['Degrees of freedom', '8'], ['Fingers', '4 × 2 segments'], ['Weight', '≈ 400 g']] },
    otto: { type: 'Educational robot', alt: 'Otto DIY educational robot',
      short: 'Small walking robot for schools and clubs — with adult supervision.',
      lead: 'Small walking robot for schools and clubs — a first encounter with Arduino and programming, with adult supervision.',
      software: 'Arduino, blocks',
      card: [['Servos', '4× SG90'], ['Controller', 'Arduino Nano']],
      bom: [['SG90 micro servo', '4×'], ['Arduino Nano and board', '1×'], ['Ultrasonic sensor', '1×'], ['Buzzer', '1×'], ['Battery holder', '1×']],
      specs: [['Servos', '4× SG90'], ['Controller', 'Arduino Nano'], ['Intended for', '14+, at school with an adult']] },
    spot: { type: 'Quadruped robot', author: 'KDY0523 and the SpotMicroAI community', alt: 'SpotMicro quadruped robot',
      short: 'Servo-driven robot dog with a Raspberry Pi.',
      lead: 'Servo-driven robot dog with a Raspberry Pi. A popular project with a large community.',
      card: [['Axes', '12 DOF'], ['Controller', 'Raspberry Pi']],
      bom: [['High-torque servo', '12×'], ['Raspberry Pi', '1×'], ['PCA9685 PWM board', '1×'], ['Battery and converter', '1×'], ['Bearings and screws', '1 set']],
      specs: [['Degrees of freedom', '12'], ['Controller', 'Raspberry Pi']] },
    sawppy: { alt: 'Sawppy six-wheel rover',
      short: 'Six-wheel rover modelled on the Mars rovers.',
      lead: 'Six-wheel rover modelled on the Mars rovers Curiosity and Perseverance.',
      bomCost: 'under 500 USD',
      card: [['Wheels', '6, rocker-bogie'], ['Drive', 'LX-16A']],
      bom: [['LewanSoul LX-16A servo', '10×'], ['15 mm aluminium extrusions', '1 set'], ['Bearings and shafts', '1 set'], ['Controller board and battery', '1×']],
      specs: [['Wheels', '6, rocker-bogie'], ['Drive', 'LX-16A servos']] },
    thor: { type: 'Robot arm', alt: 'Thor robot arm driven by stepper motors',
      short: 'Industrial-style kinematics on stepper motors, ROS 2. 625 mm tall.',
      lead: 'Industrial-style kinematics on stepper motors, controlled with G-code, ROS 2 and MoveIt 2. 625 mm tall, 750 g payload.',
      bomCost: 'under 350 EUR', printTime: '≈ 113 h',
      card: [['Axes', '6 DOF'], ['Payload', '750 g']],
      bom: [['NEMA stepper motors and drivers', 'per BOM'], ['Controller board', '1×'], ['GT2 belts and pulleys', '1 set'], ['Bearings', '1 set']],
      specs: [['Degrees of freedom', '6'], ['Height', '625 mm'], ['Payload', '750 g'], ['Print time', '≈ 113 h']] },
    exomy: { alt: 'ExoMy six-wheel rover',
      short: 'Six-wheel rover based on the ExoMars mission.',
      lead: 'Six-wheel rover based on the ExoMars mission, driven from a web browser or a gamepad.',
      bomCost: 'up to 500 EUR', software: 'ROS, web interface',
      card: [['Wheels', '6, rocker-bogie'], ['Controller', 'Raspberry Pi']],
      bom: [['Raspberry Pi', '1×'], ['PWM board', '1×'], ['Drive servo', '6×'], ['Steering servo', '6×'], ['Battery and converter', '1×']],
      specs: [['Wheels', '6, rocker-bogie'], ['Controller', 'Raspberry Pi']] },
    so102: { mats: [['petcf', 'PET-CF + PETG', 'Per project']], credit: 'Render from the Robonine model (CC BY 4.0)', type: 'Robot arm', alt: 'SO-ARM 102 robot arm with a parallel gripper',
      short: 'Stiffer, faster successor to the SO-101. Parallel gripper, PET-CF parts and the same kinematics for LeRobot.',
      lead: 'Robonine’s successor to the SO-101 keeps the same joint layout, so it works with LeRobot datasets and policies. Compared with the SO-101 it has a parallel gripper with 85 mm opening and a wrist camera, topology-optimised PET-CF parts, stronger STS3250 servos in the shoulder and elbow, and twice the payload at 300 g. Under the same load the tip deflects half as much, it reaches further (483 mm) and the base rotates 352°. The trade-offs: a higher price (≈ 340 USD per pair instead of ≈ 130 USD per arm), 12 V servos in the follower and printing in composite filament.',
      bomCost: '≈ 340 USD per pair (≈ 374 USD with filament)', printTime: '≈ 52 h per pair', software: 'LeRobot (Python) + SO-ARM 102 plugin',
      card: [['Payload', '300 g'], ['Reach', '483 mm']],
      bom: [['Feetech STS3215 servo (leader, 5 V)', '6×'], ['Feetech STS3215 12 V servo (wrist, gripper)', '2×'], ['Feetech STS3235 12 V servo (base, wrist)', '2×'], ['Feetech STS3250 12 V servo (shoulder, elbow)', '2×'], ['Waveshare Bus Servo Adapter (follower)', '1×'], ['Waveshare Bus Servo Adapter (leader)', '1×'], ['12 V / 5 A power supply (follower)', '1×'], ['5 V / 2 A power supply (leader)', '1×'], ['1080p USB wrist camera', '1×'], ['6812 bearing for the base', '2×'], ['Ø6 × 125 mm guide rod (gripper)', '2×'], ['Woodworking clamp', '4×'], ['M2/M3 screws and nuts', '1 set'], ['PET-CF + PETG filament', '≈ 1.15 kg']],
      specs: [['Degrees of freedom', '5 axes + parallel gripper'], ['Follower actuators', '2× STS3250, 2× STS3235, 2× STS3215'], ['Power', 'follower 12 V, leader 5 V'], ['Reach', '483 mm horizontal'], ['Payload', '300 g (SO-101: 150 g)'], ['Deflection at 300 g', '3.4–3.9 mm (SO-101: 7.5 mm)'], ['Base rotation', '352° (SO-101: 220°)'], ['Gripper', 'parallel, 0–85 mm, camera'], ['Noise at 1 m', '60 dB (SO-101: 70 dB)'], ['Print', 'PET-CF (links) + PETG/PETG-CF, 0.2 mm layers'], ['Print time', '≈ 52 h per pair (3MF projects)']] },
    aira: { mats: [['placf', 'PLA-CF + TPU', 'Per project']], credit: 'Render from the Nextis model (Apache-2.0)', type: 'Robot arm', alt: 'AIRA six-axis printable robot arm with a gripper and Damiao motors',
      short: 'Strong six-axis arm with a gripper for AI. Damiao motors on a CAN bus, native LeRobot plugin.',
      lead: 'Printable arm with six axes and a gripper (7 DoF), built for robot learning. The follower runs seven Damiao motors on a CAN bus — J8009P in the base and shoulder, J4340P in the elbow and wrist, J4310 in the wrist and gripper — with MIT impedance control and up to 35 Nm peak torque. You guide the leader arm, with Dynamixel XL330 servos, by hand. The software is a LeRobot plugin, so teleoperation, recording demonstrations and training ACT, Diffusion Policy or PI0 policies work out of the box. The structure is printed in PLA-CF, the soft fingers in TPU; a RealSense D405 camera can be mounted on the wrist.',
      bomCost: '≈ 1,650 USD (follower), ≈ 1,850 USD (pair)', software: 'LeRobot (Python), lerobot-robot-aira plugin',
      card: [['Axes', '6 DOF + gripper'], ['Software', 'LeRobot']],
      bom: [['Damiao J8009P motor (9:1)', '2×'], ['Damiao DM-J4340P motor (40:1)', '2×'], ['Damiao DM-J4310 motor (10:1)', '3×'], ['Dynamixel XL330-M077 servo (leader)', '7×'], ['USB-CAN adapter (CANable / MKS CANable)', '1×'], ['Bus Servo Adapter board, USB-C → Dynamixel TTL (leader)', '1×'], ['24 V / 10 A+ power supply (follower)', '1×'], ['5 V power supply (leader)', '1×'], ['120 Ω CAN termination resistor', '2×'], ['6815 bearing (leader)', '1×'], ['M2–M5 hex screws', '≈ 207 pcs'], ['Intel RealSense D405 camera (optional)', '1×']],
      specs: [['Degrees of freedom', '6 axes + gripper'], ['Actuators', 'Damiao J8009P, J4340P, J4310 (CAN)'], ['Torque', 'up to 20 / 35 Nm (base)'], ['Control', 'USB-CAN, MIT impedance control'], ['Leader', '7× Dynamixel XL330-M077'], ['Power', '24 V (follower), 5 V (leader)'], ['Camera', 'Intel RealSense D405 (optional)'], ['Print', 'PLA-CF (hardened nozzle), TPU fingers; 0.2 mm layers'], ['Print time', '—']] },
    parol6: { mats: [['petg', 'PETG', 'Per project']], credit: 'Render from the PAROL6 model (GPL-3.0)', type: 'Industrial robot arm', alt: 'PAROL6 six-axis desktop robot arm with stepper motors',
      short: 'Six-axis desktop arm designed as a scaled-down industrial robot. Stepper motors with planetary gearboxes, 400 mm reach.',
      lead: 'Six-axis desktop arm whose mechanics, control software and handling mimic industrial robots. Six NEMA 17 stepper motors with precision planetary gearboxes and belt drives, a controller board with an STM32F446 and TMC5160 drivers, 24 V power. 400 mm reach, up to 1 kg payload and 0.08 mm repeatability. Control it from the graphical PAROL6 Commander with a simulator, from Python, or via ROS 2 and MoveIt. Parts are printed in PETG.',
      card: [['Axes', '6 DOF'], ['Reach', '400 mm']],
      bom: [['NEMA 17 stepper motor (42×42×20 / 40 / 60 mm)', '1+3+2×'], ['NEMA 17 planetary gearbox (2× 20:1, 1× 10:1)', '3×'], ['PAROL6 controller board (STM32F446)', '1×'], ['TMC5160 driver', '6×'], ['24 V / 5 A power supply', '1×'], ['NSK HR32906J / HR32907J tapered roller bearings', '5+4×'], ['AXK3552 thrust bearing', '1×'], ['HTD 3M belts and pulleys', '4+3×'], ['Limit switches and inductive sensors', '3+3×'], ['Emergency stop button (NC)', '1×'], ['MHZ2-16D pneumatic gripper and 5/2 valve', '1+1×'], ['M2–M4 screws and nuts', '1 set']],
      specs: [['Degrees of freedom', '6'], ['Actuators', '6× NEMA 17, planetary gearboxes and belts'], ['Control', 'STM32F446, TMC5160 drivers'], ['Power', '24 V'], ['Reach', '400 mm'], ['Payload', 'up to 1 kg'], ['Repeatability', '0.08 mm'], ['Weight', '≈ 5.5 kg'], ['Print', 'PETG, 0.2 mm layers'], ['Print time', '—']] },
    bhl: { credit: 'Render from the Hybrid Robotics model (CC BY-SA 4.0)', type: 'Humanoid', alt: 'Berkeley Humanoid Lite humanoid robot standing',
      short: 'Child-sized humanoid: 80 cm, 22 axes and printed cycloidal gearboxes.',
      lead: 'A research humanoid for under 5,000 USD. The actuator gearboxes and the body are printed in PLA on an ordinary printer, walking is driven by an RL policy transferred from simulation, and the arms can be teleoperated in VR.',
      bomCost: 'under 5,000 USD (≈ 4,300 USD per BOM)',
      card: [['Axes', '22 DOF'], ['Height', '0.8 m']],
      bom: [['6512 actuator (BLDC + printed cycloidal gearbox)', '10×'], ['5010 actuator (BLDC + printed cycloidal gearbox)', '12×'], ['B-G431B-ESC1 motor driver', '22×'], ['Intel N95 mini PC', '1×'], ['USB-CAN adapter', '4×'], ['BNO085 IMU', '1×'], ['6S 4000 mAh LiPo battery', '1×'], ['Gripper', '2×'], ['PLA filament, bearings and screws', '1 set']],
      specs: [['Degrees of freedom', '22 (legs 2× 6, arms 2× 5) + grippers'], ['Height', '0.8 m'], ['Weight', '16 kg'], ['Actuators', '22× BLDC with printed cycloidal gearbox'], ['Control', 'Intel N95, CAN bus'], ['Runtime', '≈ 30 min (6S 4000 mAh)'], ['Print', 'PLA, desktop printer'], ['Walking', 'RL policy, sim2real']] },
    osr: { mats: [['pla', 'PLA+', 'Covers and mast'], ['petg', 'PETG', 'More heat-resistant']], credit: 'Render from the JPL / Caltech model (Apache-2.0)', alt: 'Six-wheel aluminium rover based on the NASA JPL Open Source Rover',
      short: 'Large six-wheel rover built from the goBILDA aluminium system, based on the NASA JPL Open Source Rover.',
      lead: 'Six-wheel Mars rover based on the NASA JPL Open Source Rover: aluminium frame, rocker-bogie suspension and four steered wheels. A Raspberry Pi and ROS 2 make it a robust platform for teaching and outdoor research. Unlike the other projects, this is mostly hardware assembly — only the body cover panels and the mast head are printed.',
      bomCost: '≈ 1,600 USD',
      card: [['Wheels', '6, rocker-bogie'], ['Motors', '10']],
      bom: [['goBILDA 5203 Yellow Jacket motor with encoder', '6×'], ['goBILDA 2000 servo (wheel steering)', '4×'], ['Wasteland 144 mm wheel', '6×'], ['RoboClaw 2x7A controller', '3×'], ['Raspberry Pi 3/4/5', '1×'], ['PCA9685 PWM driver', '1×'], ['Printed circuit boards (brain + motor)', '2×'], ['goBILDA aluminium extrusions and connectors', '1 set'], ['Body cover panels (laser-cut, 3 mm)', '1 set'], ['4S LiPo battery', '1×']],
      specs: [['Wheels', '6, rocker-bogie with differential'], ['Steering', '4 steered wheels (Ackermann)'], ['Drive', '6× DC motor 223 rpm + 4× servo'], ['Speed', 'up to ≈ 1.6 m/s'], ['Controller', 'Raspberry Pi + 3× RoboClaw'], ['Power', '4S LiPo (14.8 V)'], ['Runtime', '≥ 3 h (7.2 Ah)'], ['Frame', 'aluminium (goBILDA)'], ['Build time', '≥ 100 h']] },
    stackchan: { credit: 'Render from the Stack-chan model (Apache-2.0)', type: 'Desktop companion robot', author: 'Shinya Ishikawa (meganetaaan) and community', alt: 'Stack-chan desktop robot with a display for a face on a pan-tilt head',
      short: 'Small desktop companion: a display face, two servos and a head that turns and nods.',
      lead: 'Small desktop companion whose face is drawn on an M5Stack module display. Two servos pan and tilt the head; behaviour is programmed in JavaScript or with blocks right in the browser.',
      software: 'JavaScript (Moddable), blocks in the browser',
      card: [['Axes', '2 (pan + tilt)'], ['Controller', 'M5Stack (ESP32)']],
      bom: [['M5Stack Core module (Basic/Gray/Go/Fire)', '1×'], ['SG90 micro servo (or serial RS30X / SCS0009)', '2×'], ['Stack-chan servo board', '1×'], ['3.7 V Li-Po battery with PH 2-pin connector', '1×'], ['M2 × 4 mm screws', '4×'], ['M2 × 8 mm screws', '2×'], ['M3 × 15 mm screws (optional)', '2×']],
      specs: [['Degrees of freedom', '2 (head pan + tilt)'], ['Actuators', '2× SG90, RS30X or SCS0009'], ['Controller', 'M5Stack Core / Core2 / CoreS3'], ['Printed parts', 'shell, feet, servo bracket, battery back cover'], ['Power', '3.7 V battery or external 5 V']] },
    svrn: { credit: 'Render after Project SVRN by Shoverobotics (CC BY 4.0), modules by printedrobotics.cz', type: '150 g combat robot', alt: 'Project SVRN small combat robot with 4×4 drive and a wedge',
      short: 'Modular combat robot up to 150 g: a 4×4 pusher, plus a flipper or grabber module.',
      lead: 'Modular platform for 150 g antweight competitions, designed for newcomers. The base is a four-wheel-drive pusher that takes a wedge, flipper or grabber module. It runs on a Malenki Nano HV (the version for four N10 motors) – receiver and speed controllers on one board – and is driven with a standard FlySky transmitter. No spinning weapon, so it suits first fights in the Czech combat robot league.',
      software: 'no programming (RC transmitter)',
      card: [['Weight', 'up to 150 g'], ['Drive', '4× N10']],
      bom: [['N10 gear motor', '4×'], ['Malenki Nano HV (receiver + speed controllers)', '1×'], ['2S LiPo battery', '1×'], ['Power switch', '1×'], ['Wheel', '4×'], ['KingMax C507 servo (flipper module)', '1×'], ['FlySky transmitter (AFHDS 2A), e.g. FS-i6X', '1×'], ['Screws and nuts', 'per instructions']],
      specs: [['Weight class', '150 g (UK antweight, US fairyweight)'], ['Footprint', 'within the CCRL 15 × 15 cm limit'], ['Drive', '4× N10, 4×4'], ['Weapon', 'wedge, flipper or grabber (modules)'], ['Variants', '4 motors, or 2 motors with a belt'], ['Control', 'Malenki Nano HV, FlySky AFHDS 2A'], ['Power', '2S LiPo'], ['Print', 'PLA, PC or PA12; TPU side armour and mounts'], ['Print time', '—']] },
    vert150: { credit: 'Render from the TheBlackfish model, remix of “150g vert” by Muffin578 (CC BY-SA 4.0)', name: '150 g vertical spinner', type: '150 g combat robot', hw: 'CC BY-SA 4.0 or BY-NC-SA 4.0 (being verified with the authors)',
      author: 'TheBlackfish (remix of “150g vert” by Muffin578)', alt: 'Small combat robot with a vertical spinning blade',
      short: 'Two-wheel robot up to 150 g with a vertical spinning blade. Enclosed arena only.',
      lead: 'Two-wheel combat robot up to 150 g with a vertical spinner driven by a BE1806 brushless motor. Two N20 gear motors drive it through a Malenki Nano; the weapon has its own ZTW Mantis Slim speed controller. The blade is printed, the PETG body takes about two hours. A spinning weapon is dangerous – only power it up in an enclosed arena with a working failsafe.',
      printTime: '≈ 2.1 h', software: 'no programming (RC transmitter)',
      card: [['Weight', 'up to 150 g'], ['Weapon', 'vertical spinner']],
      bom: [['N20 (or N10) gear motor', '2×'], ['Malenki Nano (receiver + speed controllers)', '1×'], ['BE1806 brushless motor (weapon)', '1×'], ['ZTW Mantis Slim 15A speed controller (weapon)', '1×'], ['2S LiPo battery', '1×'], ['Power switch', '1×'], ['Pololu wheel', '2×'], ['FlySky transmitter (AFHDS 2A), e.g. FS-i6X', '1×'], ['PETG filament', '≈ 54 g']],
      specs: [['Weight class', '150 g (UK antweight, US fairyweight)'], ['Footprint', 'within the CCRL 15 × 15 cm limit'], ['Drive', '2× N20, two wheels'], ['Weapon', 'vertical spinner, BE1806'], ['Control', 'Malenki Nano + ZTW Mantis Slim 15A'], ['Power', '2S LiPo'], ['Print', 'PETG, printed blade'], ['Print time', '≈ 2.1 h (54 g)'], ['Safety', 'enclosed arena only, failsafe required']] },
    orca: { credit: 'Render from the ORCA Dexterity model (CC BY 4.0)', type: 'Robot hand', alt: 'ORCA Hand five-finger robot hand on a tower of servos',
      short: 'Five-finger hand with 17 degrees of freedom, driven by tendons from servos in a tower below the wrist.',
      lead: 'Five-finger hand with 17 degrees of freedom: 16 finger joints and one in the wrist. The fingers are pulled by tendons running through PTFE tubes from spools on the servos, which sit in a tower below the wrist. The project supports both Dynamixel and Feetech servos. You cast the finger and palm skin in silicone using printed molds, or print it faster in TPU. The Touch variant has tactile sensors in the fingertips. It is controlled from Python with the orca_core library.',
      card: [['Axes', '17 DOF'], ['Drive', 'tendons, 17 servos']],
      bom: [['Finger servo: Dynamixel XC330 or Feetech HLS3915', '16×'], ['Wrist servo: Dynamixel XC430 or Feetech HLS3930', '1×'], ['USB adapter: U2D2 (Dynamixel), or CH340 / CP210x (Feetech)', '1×'], ['Power Hub Board and 12 V adapter (Dynamixel build)', '1+1×'], ['Motor connector board (Gerber in the repository)', '12×'], ['Tower cooling fan', '2×'], ['Tendon line', '—'], ['PTFE tube for the tendons', '—'], ['GT2 wrist timing belt (GT2-142 in the CAD)', '1×'], ['Machined spool holder (drawing in 06_CNC)', '4×'], ['Threaded rod (FrankaConnector mounting part)', '2×'], ['4×8×3 and 8×13×4 mm bearings', '—'], ['2 mm and 3×50 mm pins, screws and nuts', '1 set'], ['Silicone for the skin (or TPU filament)', '—']],
      specs: [['Degrees of freedom', '17 (wrist + 16 in the fingers)'], ['Finger joints', 'thumb 4, other fingers 3 (abduction, MCP, PIP)'], ['Actuators', '17 Dynamixel or Feetech servos, tendons in PTFE tubes'], ['Skin', 'silicone cast in printed molds, or printed in TPU'], ['Variants', 'base; Touch with tactile sensors in the fingertips'], ['Simulation', 'URDF and MJCF (orcahand_description)'], ['Guide', 'the authors’ video and ASSEMBLY_ADDENDUM.md in the repository'], ['Print', 'Bambu Studio projects with ready-made plates'], ['Print time', '—']] },
    sesame: { credit: 'Render from the Sesame Robot Project model (Apache-2.0)', type: 'Quadruped robot', alt: 'Small Sesame quadruped robot with eight micro servos',
      short: 'Small four-legged robot with eight micro servos, an ESP32 and an OLED display that serves as its face.',
      lead: 'A small printable quadruped focused on movement and expression. Two MG90S (180°) micro servos drive each leg, an ESP32 (Lolin S2 Mini or the Sesame Distro Board) controls it, and a 128×64 OLED display draws a face that changes with the motion. It is controlled over Wi-Fi from a web interface or a JSON API, or alternatively from a serial console over USB; animations are composed in the Sesame Studio app. According to the author, basic soldering and familiarity with the Arduino IDE are enough.',
      bomCost: '50–60 USD (electronics and fasteners, per the author)', software: 'Arduino (C++), web interface, Sesame Studio',
      card: [['Axes', '8 (2 per leg)'], ['Controller', 'ESP32']],
      bom: [['MG90S micro servo, 180°', '8×'], ['0.96″ SSD1306 OLED display (I2C)', '1×'], ['Lolin S2 Mini (ESP32-S2) or Sesame Distro Board V3', '1×'], ['KCD1 rocker switch', '1×'], ['Bambu Lab 14500 battery (2S, 7.4 V, 800 mAh), optional', '1×'], ['Bambu Lab 7.4 V battery charger (with the battery)', '1×'], ['5 V / 3 A step-down converter (S2 Mini on battery)', '1×'], ['M2 × 5 mm self-tapping screw', '≈ 40×'], ['M2.5 × 5 mm screw (servo horns)', '10×'], ['USB-C cable (5 V / 3 A)', '1×'], ['Wires, heat-shrink, zip ties (see the project BOM)', '1 set']],
      specs: [['Degrees of freedom', '8 (2 per leg)'], ['Actuators', '8× MG90S 180°'], ['Controller', 'ESP32 (Lolin S2 Mini or Sesame Distro Board)'], ['Display', 'OLED 128×64'], ['Power', '5 V / 3 A (USB-C PD, or battery with a converter)'], ['Control', 'Wi-Fi, web interface, JSON API, serial console'], ['Print', 'PLA, 11 parts, 8–10 % infill']] },
    koch: { credit: 'Render from the Koch v1.1 model (Apache-2.0)', author: 'Jess Moss and Hugging Face (after Alexander Koch’s arm)', alt: 'Koch v1.1 robot arm with Dynamixel servos and a gripper',
      short: 'Five-axis arm with a gripper and Dynamixel servos for teleoperation and learning in LeRobot. A leader + follower pair.',
      lead: 'A revised version of Alexander Koch’s low-cost arm; unlike the original, it can be assembled without soldering. The follower arm is driven by two Dynamixel XL430-W250-T and four XL330-M288-T servos at 12 V, the leader arm by six XL330-M077-T at 5 V. Both arms connect to the computer through a Waveshare board and USB-C and are controlled with the LeRobot library. The project includes SolidWorks and STEP models, a wiring diagram and an assembly video.',
      bomCost: '≈ 278 USD follower, ≈ 199 USD leader (US prices from the project README, without shipping and VAT)',
      card: [['Axes', '5 + gripper'], ['Actuators', 'Dynamixel']],
      bom: [['Dynamixel XL430-W250-T servo (follower)', '2×'], ['Dynamixel XL330-M288-T servo (follower)', '4×'], ['Dynamixel XL330-M077-T servo (leader)', '6×'], ['FPX330-H101 frame and idler set, 4 pcs (follower)', '1×'], ['FPX330-H101 frame and idler set, 4 pcs (leader)', '1×'], ['HN11-I101 idler set (follower)', '1×'], ['Waveshare Serial Bus Servo Driver board (follower)', '1×'], ['Waveshare Serial Bus Servo Driver board (leader)', '1×'], ['DC-DC voltage converter (follower)', '1×'], ['12 V power supply (follower)', '1×'], ['5 V power supply (leader)', '1×'], ['Table clamp (follower)', '1×'], ['Table clamp (leader)', '1×'], ['USB-C cable (follower)', '1×'], ['USB-C cable (leader)', '1×'], ['Jumper wires (see the project BOM)', '1 set']],
      specs: [['Degrees of freedom', '5 axes + gripper'], ['Follower actuators', '2× XL430-W250-T, 4× XL330-M288-T'], ['Leader actuators', '6× XL330-M077-T'], ['Power', 'follower 12 V, leader 5 V'], ['Assembly', 'no soldering, following the project’s assembly video'], ['Print', 'PLA+, ABS or PETG; 0.2 mm layers, ≈ 30 % infill']] }
  },
  // shared values that several robots use verbatim
  values: { 'Robotická ruka': 'Robot arm', 'Rover': 'Rover', 'LeRobot (Python)': 'LeRobot (Python)', 'Python / Arduino': 'Python / Arduino', 'ROS / Python': 'ROS / Python', 'GRBL, ROS 2': 'GRBL, ROS 2', 'LeRobot, ManiSkill': 'LeRobot, ManiSkill', 'Isaac Lab, MuJoCo (Python)': 'Isaac Lab, MuJoCo (Python)', 'ROS 2 (Python), Raspberry Pi': 'ROS 2 (Python), Raspberry Pi', 'PAROL6 Commander, Python API, ROS 2 / MoveIt': 'PAROL6 Commander, Python API, ROS 2 / MoveIt' },
  sims: {
    arena: { label: 'Try it in the arena', note: 'Browser game · free · ≈ 3.5 MB' },
    so101: { label: 'Try it in the simulator', note: 'Browser simulation · free · ≈ 8.4 MB' }
  },
  // showcases (data.js PR_SHOWCASE): translated fields only; sources and licences stay as in data.js
  showcase: {
    origin: { type: 'Humanoid robot', level: 'Advanced',
      alt: 'The ROBOTO ORIGIN humanoid in simulation: a black aluminium frame with 23 joints on a grid floor',
      card: [['Licence', 'CERN-OHL-W-2.0 · GPL-3.0'], ['Joints', '23']],
      notAffiliated: 'We are not affiliated with RoboParty and do not sell parts.',
      badge: 'Showcase · open hardware CERN-OHL-W-2.0 · software GPL-3.0',
      short: 'An open humanoid with 23 joints in machined aluminium: mechanics, electronics, walking training and deployment published as open source.',
      lead: 'A humanoid prototype that, according to its authors, took four months to build. RoboParty published CAD, circuit boards, bill of materials, the simulation model, Isaac Lab training and ROS 2 deployment including trained policies. According to the authors it can be built from Taobao parts and made-to-order machining. We show it as inspiration – we do not sell parts or kits for it and we are not affiliated with the authors.',
      note: 'The structure is machined aluminium; only calibration jigs are printed, so “print kits” make no sense here.',
      specLabels: ['Degrees of freedom', 'Actuators', 'Power', 'Main computer', 'Bus', 'Structure', 'Walking', 'Software', 'Parts cost (author)'],
      specValues: ['23 (legs 2× 6, waist 1, arms 2× 5)', '14× Damiao DM-4340P (48 V), 9× DM-10010L', 'Li-ion 48 V, 15 Ah', 'RDK X5 8 GB', 'CAN, 4 buses (6 + 7 + 5 + 5 motors)',
        'CNC aluminium 6061/7075, black anodised; steel links',
        'RL policy (ONNX), 50 Hz, forward command −0.4 to 0.6 m/s', 'ROS 2 Humble, Isaac Lab 2.1, MuJoCo sim2sim', 'CNY 49,713 (BOM v1.0.1, 5 Jan 2026)'],
      licenseNotes: 'Robot description (MJCF, meshes), CAD, PCBs and BOM: CERN-OHL-W-2.0; software and firmware: GPL-3.0-only (orangepi-build GPL-2.0, usb2can Apache-2.0); documentation: CC BY-SA 4.0; training: BSD-3-Clause, parkour part CC BY-NC 4.0; vendor part models are not licensed. RoboParty, RPO and Roboto Origin are trademarks.' }
  },
  licenses: [
    ['Apache-2.0', 'y', 'Yes', 'Copy of the licence, author credit, changes marked'],
    ['MIT', 'y', 'Yes', 'Copy of the licence and the author’s copyright'],
    ['CC BY 4.0', 'y', 'Yes', 'Author credit, link to the source and licence'],
    ['CC BY-SA 4.0', 'c', 'Yes, with a condition', 'We publish modified files under the same licence'],
    ['GPL-3.0', 'c', 'Yes, with a condition', 'Source files of modified parts and firmware available'],
    ['CERN-OHL-P-2.0', 'y', 'Yes', 'Credit to the authors and the licence'],
    ['CERN-OHL-W / -S 2.0', 'c', 'Yes, with a condition', 'We publish the sources of the modified design'],
    ['CC BY-NC / custom NC', 'n', 'No', 'Only with the author’s written permission']
  ]
};

// Apply the overlay. Safe to call once; build.mjs calls it explicitly, browsers on <html lang="en"> automatically.
window.PR_EN_APPLY = function () {
  var EN = window.PR_EN, W = window;
  if (W.PR_EN_APPLIED) return; W.PR_EN_APPLIED = true;
  W.PR_COLORS.forEach(function (c) { if (EN.colors[c.id]) c.name = EN.colors[c.id]; });
  Object.keys(EN.cats).forEach(function (k) { W.PR_CATS[k] = EN.cats[k]; });
  W.PR_ROBOTS.forEach(function (r) {
    var e = EN.robots[r.id] || {}, cs = {};
    Object.keys(r).forEach(function (k) { cs[k] = r[k]; });
    r._cs = cs;
    if (EN.levels[r.level]) r.level = EN.levels[r.level];
    ['type', 'software'].forEach(function (k) { if (!e[k] && EN.values[r[k]]) r[k] = EN.values[r[k]]; });
    Object.keys(e).forEach(function (k) { r[k] = e[k]; });
  });
  (W.PR_SHOWCASE || []).forEach(function (r) {
    var e = EN.showcase[r.id]; if (!e) return;
    var cs = {}; Object.keys(r).forEach(function (k) { cs[k] = r[k]; }); r._cs = cs;
    ['type', 'level', 'badge', 'short', 'lead', 'note', 'alt', 'card', 'notAffiliated'].forEach(function (k) { if (e[k]) r[k] = e[k]; });
    r.specs = r.specs.map(function (s, i) { return [e.specLabels[i] || s[0], e.specValues[i] || s[1], s[2]]; });
    r.license = Object.assign({}, r.license, { notes: e.licenseNotes });
  });
  Object.keys(EN.sims).forEach(function (k) { if (W.PR_SIMS[k]) { W.PR_SIMS[k].label = EN.sims[k].label; W.PR_SIMS[k].note = EN.sims[k].note; } });
  W.PR_LICENSES = EN.licenses;
  // same rules as data.js, tested against the Czech originals so both languages agree
  W.PR_SAFETY = function (r) {
    var o = r._cs || r, all = JSON.stringify([o.bom || [], o.specs || [], o.lead || '']);
    var w = ['For ages 14 and up; younger children only under adult supervision. Moving parts can pinch fingers.'];
    if (/LiPo|Li-Pol|Li-ion|akumulátor|baterie/i.test(all)) w.push('Charge lithium batteries only with a suitable charger, supervised and away from flammable objects; never use a damaged cell.');
    if (/\b(24|22,2|14,8) ?V\b|\d+ ?Nm/.test(all)) w.push('Strong motors: a moving arm can cause injury. Keep your hands out of reach during bring-up and keep the power switch within reach.');
    if (/pneumat/i.test(all)) w.push('The pneumatic gripper runs on compressed air – use only an approved air supply and hoses.');
    if (/230 ?V|síťov/i.test(all)) w.push('A mains-powered (230 V) supply may only be wired by a qualified person.');
    if (r.cat === 'combat') {
      w.push('Only power up a combat robot in an enclosed arena or with the weapon disconnected. Switch on the transmitter first, then the robot; switch off in reverse order, and check the failsafe before the first fight (the robot must stop when the transmitter is turned off).');
      if (/spinner|rotuj/i.test(all)) w.push('A spinning weapon can cause serious injury and throw debris: always lock it outside the arena and never spin it up in your hand or on a table.');
      if (/flipper/i.test(all)) w.push('The flipper moves violently: keep your fingers out of its path when handling the robot.');
    }
    w.push('Power the hardware only from the supply specified in the project instructions.');
    return w;
  };
  W.PR_SPECS = function (r) {
    return r.specs.concat([['Difficulty', r.level], ['Software', r.software], ['Parts cost (author’s estimate)', r.bomCost]])
      .filter(function (s) { return s[1] && String(s[1]).trim() !== '—'; });
  };
};
if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en') window.PR_EN_APPLY();
