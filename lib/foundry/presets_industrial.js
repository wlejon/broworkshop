// lib/foundry/presets_industrial.js — Non-BattleBot Heavy Industrial, Construction,
// Machine-Tool & Bipedal Mech Engineering Machines.
//
// Showcases authentic real-world mechanical silhouettes (tall excavators, bipedal walking
// mechs, 4WD diesel haul tractors, vertical core-boring drill rigs, precision foundry
// engine lathes, and twin-V4 compound diesel power plants) with zero spatial interference.

import { createBlueprint, addNode } from "./blueprint.js";

const PI = Math.PI;

export function registerIndustrialAndMechMachines(lib, reg, wire) {
    // 1. Tracked Hydraulic Excavator (1.35 m articulated digging machine!)
    {
        const bp = createBlueprint({
            id: 'mach_excavator_crawler',
            name: 'Tracked Hydraulic Excavator',
            scale: 'machine',
            kind: 'bot',
            description: 'Heavy tracked construction excavator. Twin crawler track drives support an elevated 320cc diesel hydraulic deck, 240-bar relief-protected pump, 70 mm boom cylinder, and articulated toothed digging bucket.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '60V 900Wh Track Bus', x: 40, y: 80, pos3d: [0, 0.12, -0.32],
            params: { voltage: 60, capacityWh: 900, maxC: 16 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_crawler', label: 'Left Crawler Drive', x: 260, y: 40,
            pos3d: [-0.215, 0.11, -0.26], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_crawler', label: 'Right Crawler Drive', x: 260, y: 160,
            pos3d: [0.215, 0.11, -0.26], yaw3d: PI / 2 });
        addNode(bp, { id: 'track_l', type: 'track_unit', label: 'Left Excavator Track', x: 520, y: 40, pos3d: [-0.45, 0.11, 0],
            params: { lengthM: 0.78, widthM: 0.13, heightM: 0.22, grip: 1.55, side: 'left' } });
        addNode(bp, { id: 'track_r', type: 'track_unit', label: 'Right Excavator Track', x: 520, y: 160, pos3d: [0.45, 0.11, 0],
            params: { lengthM: 0.78, widthM: 0.13, heightM: 0.22, grip: 1.55, side: 'right' } });

        // Elevated Diesel-Hydraulic Upper Turret Deck
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '320cc Twin Diesel', x: 40, y: 310, pos3d: [0, 0.42, -0.26],
            params: { displacementCc: 320, cylinders: 2, redlineRpm: 2600, fuelKg: 2.8 } });
        addNode(bp, { id: 'pump', type: 'hydraulic_pump', label: '28cc Boom Pump', x: 240, y: 310, pos3d: [0, 0.42, -0.01],
            params: { dispCcRev: 28, maxBar: 280, efficiency: 0.90 } });
        addNode(bp, { id: 'valve', type: 'hydraulic_valve', label: '240-Bar Relief Block', x: 440, y: 310, pos3d: [0, 0.42, 0.14],
            params: { reliefBar: 240, maxFlowLpm: 110 } });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '70mm Boom Lift Ram', x: 640, y: 310, pos3d: [0, 0.44, 0.36],
            params: { boreMm: 70, strokeMm: 190, maxBar: 260, material: 'toolSteel' } });
        addNode(bp, { id: 'boom', type: 'weapon_head', label: 'Excavator Boom & Bucket', x: 860, y: 310, pos3d: [0, 0.64, 0.88],
            params: { kind: 'excavator_boom', massKg: 18, radiusM: 0.56, material: 'alloySteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Hydraulic Oil Cooler', x: 240, y: 420, pos3d: [0, 0.44, -0.49],
            params: { coolingKW: 6.0, widthMm: 240, heightMm: 120 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Crawler Undercarriage', x: 520, y: 420, pos3d: [0, 0.16, 0],
            params: { lengthM: 0.90, widthM: 0.72, heightM: 0.24, wallMm: 7.0, material: 'alloySteel' } });
        addNode(bp, { id: 'cwt', type: 'armor', label: '18mm Rear Counterweight', x: 740, y: 420, pos3d: [0, 0.22, -0.58],
            params: { widthM: 0.72, heightM: 0.24, thicknessMm: 18, material: 'hardox', face: 'rear' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['drive_l', 'rot_out', 'track_l', 'rot_in'],
            ['drive_r', 'rot_out', 'track_r', 'rot_in'],
            ['eng', 'rot_out', 'pump', 'rot_in'],
            ['pump', 'hyd_out', 'valve', 'hyd_in'],
            ['valve', 'hyd_out', 'ram', 'hyd_in'],
            ['ram', 'lin_out', 'boom', 'lin_in'],
            ['chassis', 'struct_out', 'cwt', 'struct_in'],
        ]);
        reg(bp);
    }

    // 2. Strider Mk1 Bipedal Mech (1.5 m upright walking mech with coaxial ankle & pelvis drives!)
    {
        const bp = createBlueprint({
            id: 'mach_mech_walker',
            name: 'Strider Mk1 Bipedal Mech',
            scale: 'machine',
            kind: 'bot',
            description: 'Upright bipedal mechanical walker prototype. Twin coaxial ankle crawler drives power the armored feet, a pelvis-level 5:1 planetary hip train drives the articulated hydraulic legs, and the upright 4-post torso carries a 60V + supercap powerpack & shoulder grapple manipulator.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '60V 1000Wh Core Pack', x: 40, y: 140, pos3d: [-0.14, 0.96, -0.16],
            params: { voltage: 60, capacityWh: 1000, maxC: 16 } });
        addNode(bp, { id: 'cap', type: 'capacitor_bank', label: '28kW Burst Capacitor', x: 40, y: 280, pos3d: [0.16, 0.96, -0.16],
            params: { voltage: 48, energyKJ: 24, maxPeakKW: 28 } });
        // Coaxial ankle-level drive pods feeding directly into left & right foot sprockets (0° straight!)
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_crawler', label: 'Left Ankle Drive', x: 260, y: 40,
            pos3d: [-0.41, 0.08, -0.42] });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_crawler', label: 'Right Ankle Drive', x: 260, y: 200,
            pos3d: [0.41, 0.08, -0.42] });
        addNode(bp, { id: 'foot_l', type: 'track_unit', label: 'Left Foot Stabilizer', x: 520, y: 40, pos3d: [-0.41, 0.08, 0.02],
            params: { lengthM: 0.38, widthM: 0.11, heightM: 0.15, grip: 1.50, side: 'left' } });
        addNode(bp, { id: 'foot_r', type: 'track_unit', label: 'Right Foot Stabilizer', x: 520, y: 200, pos3d: [0.41, 0.08, 0.02],
            params: { lengthM: 0.38, widthM: 0.11, heightM: 0.15, grip: 1.50, side: 'right' } });
        // Pelvis-level coaxial hip actuator train (y = 0.63 matches mech_legs hip trunnion — 0° straight!)
        addNode(bp, { id: 'wmtr', type: 'motor', label: 'Hip Crank Motor 2.0kW', x: 260, y: 340, pos3d: [0, 0.63, -0.52],
            params: { powerW: 2000, noLoadRpm: 2200, efficiency: 0.86 } });
        addNode(bp, { id: 'wplan', type: 'planetary_gear', label: '5:1 Pelvis Reducer', x: 460, y: 340, pos3d: [0, 0.63, -0.35],
            params: { ratio: 5, ringOdMm: 86, faceWidthMm: 24, planets: 3, material: 'alloySteel' } });
        addNode(bp, { id: 'wcl', type: 'slip_clutch', label: '160 N·m Hip Clutch', x: 660, y: 340, pos3d: [0, 0.63, -0.23],
            params: { slipTorqueNm: 160, diameterMm: 90 } });
        addNode(bp, { id: 'legs', type: 'weapon_head', label: 'Bipedal Hydraulic Legs', x: 860, y: 340, pos3d: [0, 0.38, 0.02],
            params: { kind: 'mech_legs', massKg: 26, radiusM: 0.44, material: 'alloySteel' } });
        addNode(bp, { id: 'hpu', type: 'assembly', ref: 'hyd_power_pack', label: 'Shoulder Hyd Pack', x: 260, y: 460, pos3d: [0, 1.24, 0.02] });
        addNode(bp, { id: 'arm_ram', type: 'hydraulic_ram', label: '56mm Arm Cylinder', x: 480, y: 460, pos3d: [0, 1.24, 0.28],
            params: { boreMm: 56, strokeMm: 160, maxBar: 250, material: 'alloySteel' } });
        addNode(bp, { id: 'claw', type: 'weapon_head', label: 'Shoulder Manipulator', x: 700, y: 460, pos3d: [0, 1.24, 0.56],
            params: { kind: 'grapple_claw', massKg: 9.5, radiusM: 0.26, material: 'alloySteel' } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Vertical Mech Spine', x: 700, y: 120, pos3d: [0, 1.04, 0],
            params: { lengthM: 0.58, widthM: 0.62, heightM: 0.72, wallMm: 8.0, material: 'alloySteel' } });
        addNode(bp, { id: 'chest', type: 'armor', label: '12mm Torso Plate', x: 920, y: 120, pos3d: [0, 0.88, 0.34],
            params: { widthM: 0.56, heightM: 0.16, thicknessMm: 12, material: 'hardox', face: 'front' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'wmtr', 'elec_in'],
            ['batt', 'elec_out', 'cap', 'elec_in'],
            ['cap', 'elec_out', 'hpu', 'elec_in'],
            ['drive_l', 'rot_out', 'foot_l', 'rot_in'],
            ['drive_r', 'rot_out', 'foot_r', 'rot_in'],
            ['wmtr', 'rot_out', 'wplan', 'rot_in'],
            ['wplan', 'rot_out', 'wcl', 'rot_in'],
            ['wcl', 'rot_out', 'legs', 'rot_in'],
            ['hpu', 'hyd_out', 'arm_ram', 'hyd_in'],
            ['arm_ram', 'lin_out', 'claw', 'lin_in'],
            ['chassis', 'struct_out', 'chest', 'struct_in'],
        ]);
        reg(bp);
    }

    // 3. Diesel Industrial Haul Tractor & Rear Tow Winch (Heavy Utility Prime Mover!)
    {
        const bp = createBlueprint({
            id: 'mach_haul_tractor',
            name: 'Diesel Haul Tractor & Winch',
            scale: 'machine',
            kind: 'bot',
            description: 'Heavy industrial prime mover & recovery tug. Exposed front 450cc inline-4 diesel behind a vertical radiator grille, 7.5 kg flywheel, 180 N·m master clutch, 3.5:1 differential driving oversized high-clearance tractor tires, plus a rear 40:1 self-locking worm tow winch.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '450cc Inline-4 Diesel', x: 40, y: 140, pos3d: [0, 0.24, 0.26],
            params: { displacementCc: 450, cylinders: 4, redlineRpm: 2800, fuelKg: 3.5 } });
        addNode(bp, { id: 'fw', type: 'flywheel', label: '7.5kg Diesel Flywheel', x: 240, y: 140, pos3d: [0, 0.24, 0.05],
            params: { diameterMm: 200, massKg: 7.5, material: 'alloySteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '180 N·m Master Clutch', x: 440, y: 140, pos3d: [0, 0.24, -0.06],
            params: { slipTorqueNm: 180, diameterMm: 105 } });
        addNode(bp, { id: 'diff', type: 'differential', label: '3.5:1 Tractor Axle Diff', x: 640, y: 140, pos3d: [0, 0.24, -0.20],
            params: { ratio: 3.5, carrierOdMm: 122, material: 'alloySteel' } });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Tractor Tire', x: 860, y: 60, pos3d: [-0.46, 0.20, -0.20],
            params: { radiusM: 0.20, widthM: 0.13, grip: 1.55, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Tractor Tire', x: 860, y: 200, pos3d: [0.46, 0.20, -0.20],
            params: { radiusM: 0.20, widthM: 0.13, grip: 1.55, side: 'right' } });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 550Wh Winch Bus', x: 40, y: 310, pos3d: [-0.20, 0.17, -0.44],
            params: { voltage: 48, capacityWh: 550, maxC: 14 } });
        addNode(bp, { id: 'winch', type: 'assembly', ref: 'worm_hoist_pack', label: '40:1 Rear Tow Winch', x: 280, y: 310,
            pos3d: [0.02, 0.52, -0.34], yaw3d: PI });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Front Grille Radiator', x: 440, y: 310, pos3d: [0, 0.25, 0.52],
            params: { coolingKW: 7.0, widthMm: 280, heightMm: 160 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Heavy Tractor Frame', x: 640, y: 310, pos3d: [0, 0.21, 0],
            params: { lengthM: 1.16, widthM: 0.72, heightM: 0.24, wallMm: 7.0, material: 'alloySteel' } });
        addNode(bp, { id: 'bumper', type: 'armor', label: '14mm Front Push Bar', x: 860, y: 310, pos3d: [0, 0.18, 0.62],
            params: { widthM: 0.74, heightM: 0.20, thicknessMm: 14, material: 'hardox', face: 'front' } });
        wire(bp, lib, [
            ['eng', 'rot_out', 'fw', 'rot_in'],
            ['fw', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'diff', 'rot_in'],
            ['diff', 'rot_out', 'wheel_l', 'rot_in'],
            ['diff', 'rot_out_b', 'wheel_r', 'rot_in'],
            ['batt', 'elec_out', 'winch', 'elec_in'],
            ['chassis', 'struct_out', 'bumper', 'struct_in'],
        ]);
        reg(bp);
    }

    // 4. Tracked Core-Boring Drill Rig (1.55 m tall 4-post vertical earth/rock drill tower!)
    {
        const bp = createBlueprint({
            id: 'mach_rotary_drill',
            name: 'Tracked Core-Boring Drill Rig',
            scale: 'machine',
            kind: 'bot',
            description: 'Mobile tracked foundation drilling derrick. A 1.5 m open 4-post steel tower carries an electric 5:1 planetary + bevel rotary table, slip clutch, vertical helical rock auger, and lead-screw feed column.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '60V 950Wh Rig Pack', x: 40, y: 180, pos3d: [0, 0.12, -0.34],
            params: { voltage: 60, capacityWh: 950, maxC: 16 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_crawler', label: 'Left Crawler Pod', x: 260, y: 40,
            pos3d: [-0.22, 0.10, -0.27], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_crawler', label: 'Right Crawler Pod', x: 260, y: 150,
            pos3d: [0.22, 0.10, -0.27], yaw3d: PI / 2 });
        addNode(bp, { id: 'track_l', type: 'track_unit', label: 'Left Derrick Track', x: 520, y: 40, pos3d: [-0.47, 0.10, -0.02],
            params: { lengthM: 0.76, widthM: 0.12, heightM: 0.20, grip: 1.55, side: 'left' } });
        addNode(bp, { id: 'track_r', type: 'track_unit', label: 'Right Derrick Track', x: 520, y: 150, pos3d: [0.47, 0.10, -0.02],
            params: { lengthM: 0.76, widthM: 0.12, heightM: 0.20, grip: 1.55, side: 'right' } });
        addNode(bp, { id: 'dmtr', type: 'motor', label: 'Rotary Head 3.2kW', x: 260, y: 270, pos3d: [0, 1.32, -0.18],
            params: { powerW: 3200, noLoadRpm: 2400, efficiency: 0.87 } });
        addNode(bp, { id: 'dplan', type: 'planetary_gear', label: '5:1 Kelly Planetary', x: 460, y: 270, pos3d: [0, 1.32, 0.0],
            params: { ratio: 5, ringOdMm: 92, faceWidthMm: 26, planets: 3, material: 'alloySteel' } });
        addNode(bp, { id: 'dcl', type: 'slip_clutch', label: '140 N·m Torque Limiter', x: 660, y: 270, pos3d: [0, 1.32, 0.13],
            params: { slipTorqueNm: 140, diameterMm: 95 } });
        addNode(bp, { id: 'dbevel', type: 'bevel_gear', label: '90° Rotary Table', x: 860, y: 270, pos3d: [0, 1.32, 0.28],
            params: { ratio: 1.5, crownOdMm: 96, material: 'alloySteel' } });
        addNode(bp, { id: 'auger', type: 'weapon_head', label: 'Helical Rock Auger', x: 1060, y: 270, pos3d: [0, 0.78, 0.28],
            params: { kind: 'auger_drill', massKg: 18, radiusM: 0.16, material: 'toolSteel' } });
        addNode(bp, { id: 'fmtr', type: 'motor', label: 'Feed Motor 1.2kW', x: 260, y: 390, pos3d: [-0.28, 1.30, -0.10],
            params: { powerW: 1200, noLoadRpm: 1800, efficiency: 0.86 } });
        addNode(bp, { id: 'fbevel', type: 'bevel_gear', label: '90° Feed Bevel', x: 410, y: 390, pos3d: [-0.28, 1.30, 0.12],
            params: { ratio: 1.5, crownOdMm: 78, material: 'alloySteel' } });
        addNode(bp, { id: 'fscrew', type: 'lead_screw', label: 'Vertical Feed Screw', x: 560, y: 390, pos3d: [-0.28, 0.86, 0.12],
            params: { diameterMm: 32, pitchMm: 6, strokeMm: 380, material: 'alloySteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Rig Drive Cooler', x: 740, y: 390, pos3d: [0, 0.30, -0.36],
            params: { coolingKW: 4.5, widthMm: 220, heightMm: 110 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4-Post Drill Derrick', x: 940, y: 390, pos3d: [0, 0.75, 0],
            params: { lengthM: 0.92, widthM: 0.78, heightM: 1.50, wallMm: 9.0, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'dmtr', 'elec_in'],
            ['batt', 'elec_out', 'fmtr', 'elec_in'],
            ['drive_l', 'rot_out', 'track_l', 'rot_in'],
            ['drive_r', 'rot_out', 'track_r', 'rot_in'],
            ['dmtr', 'rot_out', 'dplan', 'rot_in'],
            ['dplan', 'rot_out', 'dcl', 'rot_in'],
            ['dcl', 'rot_out', 'dbevel', 'rot_in'],
            ['dbevel', 'rot_out', 'auger', 'rot_in'],
            ['fmtr', 'rot_out', 'fbevel', 'rot_in'],
            ['fbevel', 'rot_out', 'fscrew', 'rot_in'],
        ]);
        reg(bp);
    }

    // 5. Precision Foundry Engine Lathe (Machine Tool — build the tools to build bigger machines!)
    {
        const bp = createBlueprint({
            id: 'mach_engine_lathe',
            name: 'Foundry Engine Lathe',
            scale: 'machine',
            kind: 'workshop',
            description: 'Precision metal-turning foundry lathe for machining giant shafts, gears & bushings. Features a belt-isolated 4:1 heavy headstock gearbox, 3-jaw chuck turning a bronze billet, independent lead-screw carriage feed, and coolant chiller.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 800Wh Shop Bus', x: 40, y: 180, pos3d: [0, 0.14, -0.56],
            params: { voltage: 48, capacityWh: 800, maxC: 12 } });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Spindle Motor 2.4kW', x: 240, y: 100, pos3d: [0, 0.38, -0.46],
            params: { powerW: 2400, noLoadRpm: 2400, efficiency: 0.87 } });
        addNode(bp, { id: 'belt', type: 'belt_drive', label: '2:1 Headstock Belt', x: 440, y: 100, pos3d: [0, 0.38, -0.25],
            params: { ratio: 2.0, widthMm: 26, spanMm: 160, slipTorqueNm: 65 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_4to1_heavy', label: '4:1 Heavy Headstock', x: 640, y: 100,
            pos3d: [0, 0.38, -0.02] });
        addNode(bp, { id: 'chuck', type: 'weapon_head', label: '3-Jaw Chuck & Billet', x: 860, y: 100, pos3d: [0.06, 0.38, 0.30],
            params: { kind: 'lathe_chuck', massKg: 14, radiusM: 0.11, material: 'alloySteel' } });
        addNode(bp, { id: 'fmtr', type: 'motor', label: 'Carriage Feed 0.8kW', x: 240, y: 270, pos3d: [0.18, 0.22, -0.24],
            params: { powerW: 800, noLoadRpm: 1800, efficiency: 0.85 } });
        addNode(bp, { id: 'fscrew', type: 'lead_screw', label: 'Precision Lead Screw', x: 460, y: 270, pos3d: [0.18, 0.22, 0.20],
            params: { diameterMm: 28, pitchMm: 5, strokeMm: 460, material: 'alloySteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Coolant Chiller', x: 680, y: 270, pos3d: [0, 0.22, 0.58],
            params: { coolingKW: 3.5, widthMm: 220, heightMm: 110 } });
        addNode(bp, { id: 'bed', type: 'frame', label: 'Cast-Steel Lathe Bed', x: 880, y: 270, pos3d: [0, 0.13, 0],
            params: { lengthM: 1.44, widthM: 0.56, heightM: 0.22, wallMm: 10, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'mtr', 'elec_in'],
            ['batt', 'elec_out', 'fmtr', 'elec_in'],
            ['mtr', 'rot_out', 'belt', 'rot_in'],
            ['belt', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'chuck', 'rot_in'],
            ['fmtr', 'rot_out', 'fscrew', 'rot_in'],
        ]);
        reg(bp);
    }

    // 6. Twin-V4 Compound Diesel Power Plant (Multi-Engine Industrial Generator / HPU!)
    {
        const bp = createBlueprint({
            id: 'mach_compound_powerhouse',
            name: 'Twin-V4 Compound Power Plant',
            scale: 'machine',
            kind: 'workshop',
            description: 'Stationary multi-engine industrial hydraulic power plant. Two opposing 350cc V4 diesels sum torque through a central bevel differential into a 14 kg inertia flywheel, 220 N·m master clutch, 270-bar relief-protected pump, and twin elevated cooling towers.',
        });
        addNode(bp, { id: 'eng_a', type: 'ic_engine', label: 'Port 350cc V4 Diesel', x: 40, y: 80, pos3d: [-0.26, 0.26, -0.34],
            params: { displacementCc: 350, cylinders: 4, redlineRpm: 2600, fuelKg: 4.0 } });
        addNode(bp, { id: 'eng_b', type: 'ic_engine', label: 'Stbd 350cc V4 Diesel', x: 40, y: 260, pos3d: [0.26, 0.26, -0.34],
            params: { displacementCc: 350, cylinders: 4, redlineRpm: 2600, fuelKg: 4.0 } });
        addNode(bp, { id: 'diff', type: 'differential', label: 'Twin-Engine Combiner', x: 260, y: 170, pos3d: [0, 0.26, -0.06],
            params: { ratio: 1.5, carrierOdMm: 132, material: 'toolSteel' } });
        addNode(bp, { id: 'fw', type: 'flywheel', label: '14kg Compound Flywheel', x: 460, y: 170, pos3d: [0, 0.26, 0.12],
            params: { diameterMm: 280, massKg: 14, material: 'alloySteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '220 N·m Master Clutch', x: 660, y: 170, pos3d: [0, 0.26, 0.26],
            params: { slipTorqueNm: 220, diameterMm: 115 } });
        addNode(bp, { id: 'pump', type: 'hydraulic_pump', label: '48cc Main Hyd Pump', x: 860, y: 170, pos3d: [0, 0.26, 0.41],
            params: { dispCcRev: 48, maxBar: 300, efficiency: 0.91 } });
        addNode(bp, { id: 'valve', type: 'hydraulic_valve', label: '270-Bar Relief Block', x: 1060, y: 170, pos3d: [0, 0.26, 0.56],
            params: { reliefBar: 270, maxFlowLpm: 180 } });
        addNode(bp, { id: 'rad_l', type: 'radiator', label: 'Port Cooling Tower', x: 460, y: 350, pos3d: [-0.26, 0.54, -0.26],
            params: { coolingKW: 8.0, widthMm: 260, heightMm: 140 } });
        addNode(bp, { id: 'rad_r', type: 'radiator', label: 'Stbd Cooling Tower', x: 680, y: 350, pos3d: [0.26, 0.54, -0.26],
            params: { coolingKW: 8.0, widthMm: 260, heightMm: 140 } });
        addNode(bp, { id: 'skid', type: 'frame', label: 'Heavy Powerplant Skid', x: 900, y: 350, pos3d: [0, 0.16, 0.04],
            params: { lengthM: 1.32, widthM: 0.94, heightM: 0.26, wallMm: 9.0, material: 'alloySteel' } });
        wire(bp, lib, [
            ['eng_a', 'rot_out', 'diff', 'rot_in'],
            ['eng_b', 'rot_out', 'diff', 'rot_in_b'],
            ['diff', 'rot_out', 'fw', 'rot_in'],
            ['fw', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'pump', 'rot_in'],
            ['pump', 'hyd_out', 'valve', 'hyd_in'],
        ]);
        reg(bp);
    }
}
