// lib/foundry/presets_machines.js — Tier 2 Combat Bots, Workshop Tools & Tier 3 Titan Modules.
//
// Every single machine is spatially packaged with ZERO solid or swept-volume intersections:
//   - Horizontal spinners cantilever cleanly ahead of nose armor with full 360° disc clearance
//   - Transverse drive pods (±90° yaw) mate straight into side wheels/tracks outside the chassis
//   - Hydraulics, chains, belts, planetary drives, worm reducers, and radiators fit cleanly in bays

import { createBlueprint, addNode } from "./blueprint.js";

const PI = Math.PI;

export function registerMachinesAndTitans(lib, reg, wire) {
    // =========================================================================
    // TIER 2: COMBAT BOTS & WORKSHOP MACHINES (Lawn-Mower Scale, 0.7–1.4 m)
    // =========================================================================

    // 16. Fused Shredder Mk1 (Fail-Safe Cantilevered Horizontal Spinner Bot)
    {
        const bp = createBlueprint({
            id: 'bot_shredder_safe',
            name: 'Fused Shredder Mk1',
            scale: 'machine',
            kind: 'bot',
            description: 'Fail-safe cantilevered horizontal spinner bot. Transverse Heavy Drive Pods drive outer wheels; centerline Fail-Safe Spinner uses slip clutch + $3 brass shear pin with full front blade clearance.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 600Wh Pack', x: 40, y: 180, pos3d: [0, 0.085, -0.35],
            params: { voltage: 48, capacityWh: 600, maxC: 16 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_heavy', label: 'Left Drive Pod', x: 280, y: 60,
            pos3d: [-0.215, 0.13, -0.205], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_heavy', label: 'Right Drive Pod', x: 280, y: 310,
            pos3d: [0.215, 0.13, -0.155], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 540, y: 60, pos3d: [-0.42, 0.13, -0.18],
            params: { radiusM: 0.13, widthM: 0.08, grip: 1.2, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 540, y: 310, pos3d: [0.42, 0.13, -0.18],
            params: { radiusM: 0.13, widthM: 0.08, grip: 1.2, side: 'right' } });
        addNode(bp, { id: 'weapon', type: 'assembly', ref: 'spinner_drive_fused', label: 'Fail-Safe Spinner', x: 280, y: 180,
            pos3d: [0, 0.13, 0.37] });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4140 Chassis Frame', x: 540, y: 180, pos3d: [0, 0.125, -0.05],
            params: { lengthM: 0.80, widthM: 0.68, heightM: 0.20, wallMm: 5.5, material: 'alloySteel' } });
        addNode(bp, { id: 'wedge', type: 'armor', label: 'Hardox Nose Shield', x: 770, y: 180, pos3d: [0, 0.058, 0.40],
            params: { widthM: 0.68, heightM: 0.085, thicknessMm: 8, material: 'hardox', face: 'front' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'weapon', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['chassis', 'struct_out', 'wedge', 'struct_in'],
        ]);
        reg(bp);
    }

    // 17. Glass Cannon Mk1 (Unprotected Spinner Bot)
    {
        const bp = createBlueprint({
            id: 'bot_shredder_raw',
            name: 'Glass Cannon Mk1',
            scale: 'machine',
            kind: 'bot',
            description: 'Unprotected spinner bot with Light Drive Pods and Direct-Drive Spinner. Cheaper upfront, but hard impacts strip the gearbox teeth and wear out bronze bushings.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 550Wh Pack', x: 40, y: 180, pos3d: [0, 0.085, -0.34],
            params: { voltage: 48, capacityWh: 550, maxC: 15 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_light', label: 'Left Light Pod', x: 280, y: 60,
            pos3d: [-0.205, 0.13, -0.205], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_light', label: 'Right Light Pod', x: 280, y: 310,
            pos3d: [0.205, 0.13, -0.155], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 540, y: 60, pos3d: [-0.40, 0.13, -0.18],
            params: { radiusM: 0.13, widthM: 0.08, grip: 1.15, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 540, y: 310, pos3d: [0.40, 0.13, -0.18],
            params: { radiusM: 0.13, widthM: 0.08, grip: 1.15, side: 'right' } });
        addNode(bp, { id: 'weapon', type: 'assembly', ref: 'spinner_drive_raw', label: 'Direct Spinner', x: 280, y: 180,
            pos3d: [0, 0.13, 0.37] });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Mild Steel Frame', x: 540, y: 180, pos3d: [0, 0.125, -0.05],
            params: { lengthM: 0.78, widthM: 0.64, heightM: 0.19, wallMm: 4.0, material: 'mildSteel' } });
        addNode(bp, { id: 'plate', type: 'armor', label: 'Thin Nose Plate', x: 770, y: 180, pos3d: [0, 0.058, 0.39],
            params: { widthM: 0.64, heightM: 0.085, thicknessMm: 4, material: 'mildSteel', face: 'front' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'weapon', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['chassis', 'struct_out', 'plate', 'struct_in'],
        ]);
        reg(bp);
    }

    // 18. Iron Wedge Bulwark (Heavy AR500 Pusher Tank)
    {
        const bp = createBlueprint({
            id: 'bot_iron_wedge',
            name: 'Iron Wedge Bulwark',
            scale: 'machine',
            kind: 'bot',
            description: 'Armored pusher/rammer built around Heavy Drive Pods, active cooling radiator, and 14 mm Hardox AR500 front wedge plating.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 700Wh Pack', x: 40, y: 180, pos3d: [0, 0.095, -0.28],
            params: { voltage: 48, capacityWh: 700, maxC: 14 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_heavy', label: 'Left Heavy Pod', x: 280, y: 70,
            pos3d: [-0.215, 0.14, -0.045], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_heavy', label: 'Right Heavy Pod', x: 280, y: 290,
            pos3d: [0.215, 0.14, 0.005], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Heavy Wheel', x: 540, y: 70, pos3d: [-0.43, 0.14, -0.02],
            params: { radiusM: 0.14, widthM: 0.10, grip: 1.35, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Heavy Wheel', x: 540, y: 290, pos3d: [0.43, 0.14, -0.02],
            params: { radiusM: 0.14, widthM: 0.10, grip: 1.35, side: 'right' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Drive Cooler', x: 540, y: 390, pos3d: [0, 0.13, 0.26],
            params: { coolingKW: 3.0, widthMm: 220, heightMm: 110 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Reinforced Chassis', x: 540, y: 180, pos3d: [0, 0.13, 0],
            params: { lengthM: 0.88, widthM: 0.72, heightM: 0.22, wallMm: 7.0, material: 'alloySteel' } });
        addNode(bp, { id: 'wedge', type: 'armor', label: '14mm AR500 Plow', x: 770, y: 130, pos3d: [0, 0.115, 0.54],
            params: { widthM: 0.74, heightM: 0.21, thicknessMm: 14, material: 'hardox', face: 'front' } });
        addNode(bp, { id: 'skirt', type: 'armor', label: 'Rear Bumper Plate', x: 770, y: 240, pos3d: [0, 0.12, -0.47],
            params: { widthM: 0.72, heightM: 0.20, thicknessMm: 8, material: 'hardox', face: 'rear' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['chassis', 'struct_out', 'wedge', 'struct_in'],
            ['chassis', 'struct_out', 'skirt', 'struct_in'],
            ['chassis', 'struct_out', 'rad', 'struct_in'],
        ]);
        reg(bp);
    }

    // 19. Anvil Striker (Overhead Spring-Hammer Bot)
    {
        const bp = createBlueprint({
            id: 'bot_anvil_hammer',
            name: 'Anvil Striker',
            scale: 'machine',
            kind: 'bot',
            description: 'Dual Heavy Drive Pods carrying a compiled Spring Hammer Drive that winds a 220 N·m/rad torsion spring and delivers overhead kinetic strikes.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 600Wh Pack', x: 40, y: 180, pos3d: [0, 0.085, -0.34],
            params: { voltage: 48, capacityWh: 600, maxC: 14 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_heavy', label: 'Left Heavy Pod', x: 280, y: 60,
            pos3d: [-0.22, 0.13, -0.205], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_heavy', label: 'Right Heavy Pod', x: 280, y: 310,
            pos3d: [0.22, 0.13, -0.115], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 540, y: 60, pos3d: [-0.42, 0.13, -0.16],
            params: { radiusM: 0.13, widthM: 0.08, grip: 1.25, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 540, y: 310, pos3d: [0.42, 0.13, -0.16],
            params: { radiusM: 0.13, widthM: 0.08, grip: 1.25, side: 'right' } });
        addNode(bp, { id: 'hammer', type: 'assembly', ref: 'hammer_drive', label: 'Spring Hammer', x: 280, y: 180,
            pos3d: [0, 0.16, 0.08] });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4140 Chassis Frame', x: 540, y: 180, pos3d: [0, 0.125, -0.02],
            params: { lengthM: 0.84, widthM: 0.68, heightM: 0.20, wallMm: 5.5, material: 'alloySteel' } });
        addNode(bp, { id: 'wedge', type: 'armor', label: 'Hardox Front Armor', x: 770, y: 180, pos3d: [0, 0.105, 0.49],
            params: { widthM: 0.68, heightM: 0.19, thicknessMm: 8, material: 'hardox', face: 'front' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'hammer', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['chassis', 'struct_out', 'wedge', 'struct_in'],
        ]);
        reg(bp);
    }

    // 20. Mauler Mk2 — Compact Vertical Drum Spinner (Planetary Drives + HTD Belt + Sprag Freewheel!)
    {
        const bp = createBlueprint({
            id: 'bot_mauler_drum',
            name: 'Mauler Mk2 (Drum)',
            scale: 'machine',
            kind: 'bot',
            description: 'Compact vertical-drum brawler using coaxial 5:1 Planetary Drive Pods, shock-absorbing HTD timing belt, one-way sprag freewheel clutch, and a 13.5 kg S7 tooth drum.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 650Wh Pack', x: 40, y: 180, pos3d: [0, 0.09, -0.30],
            params: { voltage: 48, capacityWh: 650, maxC: 18 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Planetary Pod', x: 280, y: 60,
            pos3d: [-0.20, 0.13, -0.14], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Planetary Pod', x: 280, y: 310,
            pos3d: [0.20, 0.13, -0.14], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 540, y: 60, pos3d: [-0.39, 0.13, -0.14],
            params: { radiusM: 0.13, widthM: 0.085, grip: 1.3, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 540, y: 310, pos3d: [0.39, 0.13, -0.14],
            params: { radiusM: 0.13, widthM: 0.085, grip: 1.3, side: 'right' } });
        addNode(bp, { id: 'weapon', type: 'assembly', ref: 'drum_drive_belted', label: 'Belted S7 Drum', x: 280, y: 180,
            pos3d: [0, 0.13, 0.25] });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Titanium Billet Frame', x: 540, y: 180, pos3d: [0, 0.125, -0.02],
            params: { lengthM: 0.74, widthM: 0.64, heightM: 0.20, wallMm: 6.0, material: 'titanium' } });
        addNode(bp, { id: 'rear_arm', type: 'armor', label: 'Rear Hardox Bumper', x: 770, y: 180, pos3d: [0, 0.12, -0.41],
            params: { widthM: 0.64, heightM: 0.18, thicknessMm: 8, material: 'hardox', face: 'rear' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'weapon', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['chassis', 'struct_out', 'rear_arm', 'struct_in'],
        ]);
        reg(bp);
    }

    // 21. Iron Fang — Tracked Hydraulic Crusher (Crawler Tracks + 240-Bar Hydraulics + Piercing Beak!)
    {
        const bp = createBlueprint({
            id: 'bot_fang_crusher',
            name: 'Iron Fang (Tracked Crusher)',
            scale: 'machine',
            kind: 'bot',
            description: 'Armored crawler-tracked hydraulic crusher: dual Crawler Track Drives (slip-clutch protected), active oil cooler, and a 240-bar hydraulic piercing jaw.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 750Wh Pack', x: 40, y: 180, pos3d: [0, 0.095, -0.34],
            params: { voltage: 48, capacityWh: 750, maxC: 15 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_crawler', label: 'Left Track Drive', x: 280, y: 55,
            pos3d: [-0.215, 0.12, -0.26], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_crawler', label: 'Right Track Drive', x: 280, y: 315,
            pos3d: [0.215, 0.12, -0.26], yaw3d: PI / 2 });
        addNode(bp, { id: 'track_l', type: 'track_unit', label: 'Left Crawler Track', x: 545, y: 55, pos3d: [-0.43, 0.12, -0.02],
            params: { lengthM: 0.72, heightM: 0.21, widthM: 0.11, grip: 1.65, side: 'left' } });
        addNode(bp, { id: 'track_r', type: 'track_unit', label: 'Right Crawler Track', x: 545, y: 315, pos3d: [0.43, 0.12, -0.02],
            params: { lengthM: 0.72, heightM: 0.21, widthM: 0.11, grip: 1.65, side: 'right' } });
        addNode(bp, { id: 'crusher', type: 'assembly', ref: 'crusher_jaw_pack', label: 'Hydraulic Crusher', x: 280, y: 185,
            pos3d: [0, 0.135, 0.20] });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Hyd Oil Cooler', x: 545, y: 405, pos3d: [0, 0.14, -0.45],
            params: { coolingKW: 4.5, widthMm: 260, heightMm: 120 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Heavy 4140 Hull', x: 545, y: 185, pos3d: [0, 0.13, -0.02],
            params: { lengthM: 0.86, widthM: 0.70, heightM: 0.22, wallMm: 6.5, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'crusher', 'elec_in'],
            ['drive_l', 'rot_out', 'track_l', 'rot_in'],
            ['drive_r', 'rot_out', 'track_r', 'rot_in'],
            ['chassis', 'struct_out', 'rad', 'struct_in'],
        ]);
        reg(bp);
    }

    // 22. Catapult Mk1 — Supercap Hydraulic Flipper Bot
    {
        const bp = createBlueprint({
            id: 'bot_catapult_flipper',
            name: 'Catapult Mk1 (Flipper)',
            scale: 'machine',
            kind: 'bot',
            description: 'Fast planetary-drive combat flipper combining a 28 kW supercapacitor burst bank, 240-bar hydraulic launcher ram, and low-profile Hardox spatula.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 600Wh Pack', x: 40, y: 180, pos3d: [0, 0.09, -0.35],
            params: { voltage: 48, capacityWh: 600, maxC: 16 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Planetary Pod', x: 280, y: 60,
            pos3d: [-0.225, 0.13, -0.21], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Planetary Pod', x: 280, y: 310,
            pos3d: [0.225, 0.13, -0.21], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 540, y: 60, pos3d: [-0.425, 0.13, -0.21],
            params: { radiusM: 0.13, widthM: 0.085, grip: 1.35, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 540, y: 310, pos3d: [0.425, 0.13, -0.21],
            params: { radiusM: 0.13, widthM: 0.085, grip: 1.35, side: 'right' } });
        addNode(bp, { id: 'flipper', type: 'assembly', ref: 'flipper_launcher_pack', label: 'Hyd Flipper Pack', x: 280, y: 185,
            pos3d: [0, 0.13, 0.33] });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4140 Wedge Chassis', x: 540, y: 185, pos3d: [0, 0.125, -0.02],
            params: { lengthM: 0.84, widthM: 0.72, heightM: 0.20, wallMm: 5.5, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'flipper', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
        ]);
        reg(bp);
    }

    // 23. Ripper Gas-Chain Brawler (250cc 2-Cyl Engine + Roller Chain + Slip Clutch + Vertical Drum!)
    {
        const bp = createBlueprint({
            id: 'bot_ripper_gas',
            name: 'Ripper 250cc (Gas Chain)',
            scale: 'machine',
            kind: 'bot',
            description: 'Hybrid gas-electric brawler: 250cc twin-cylinder IC engine drives a massive roller-chain vertical drum through a slip clutch, while electric planetary pods handle agile steering.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 350Wh Drive Pack', x: 40, y: 90, pos3d: [-0.20, 0.085, -0.34],
            params: { voltage: 48, capacityWh: 350, maxC: 14 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Planetary Pod', x: 270, y: 40,
            pos3d: [-0.22, 0.13, -0.16], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Planetary Pod', x: 270, y: 145,
            pos3d: [0.22, 0.13, -0.16], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 520, y: 40, pos3d: [-0.43, 0.13, -0.16],
            params: { radiusM: 0.13, widthM: 0.09, grip: 1.25, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 520, y: 145, pos3d: [0.43, 0.13, -0.16],
            params: { radiusM: 0.13, widthM: 0.09, grip: 1.25, side: 'right' } });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '250cc Twin Engine', x: 40, y: 260, pos3d: [0.04, 0.23, -0.35],
            params: { displacementCc: 250, cylinders: 2, redlineRpm: 6800, fuelKg: 2.2 } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: 'Centrifugal Clutch', x: 250, y: 260, pos3d: [0, 0.14, 0.02],
            params: { slipTorqueNm: 45, radiusMm: 46 } });
        addNode(bp, { id: 'chain', type: 'chain_drive', label: '#40 Roller Chain', x: 460, y: 260, pos3d: [0, 0.14, 0.24],
            params: { ratio: 1.8, pitchMm: 12.7, spanMm: 220, material: 'alloySteel' } });
        addNode(bp, { id: 'drum', type: 'weapon_head', label: 'Heavy S7 Drum', x: 675, y: 260, pos3d: [0, 0.14, 0.48],
            params: { kind: 'spinner_drum', massKg: 14.5, radiusM: 0.115, material: 'toolSteel' } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Tubular Steel Frame', x: 520, y: 365, pos3d: [0, 0.13, -0.02],
            params: { lengthM: 0.88, widthM: 0.72, heightM: 0.21, wallMm: 5.5, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['eng', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'chain', 'rot_in'],
            ['chain', 'rot_out', 'drum', 'rot_in'],
        ]);
        reg(bp);
    }

    // 24. 25-Tonne Workshop Hydraulic Forging Press (Tool-to-build-bigger-machines!)
    {
        const bp = createBlueprint({
            id: 'machine_shop_press',
            name: '25t Workshop Forging Press',
            scale: 'machine',
            kind: 'tool',
            description: 'Foundry workshop fabrication tool: 240-bar hydraulic power unit + oil cooler + 110 mm bore forging ram & self-locking worm indexing table to stamp heavy armor plates.',
        });
        addNode(bp, { id: 'hpu', type: 'assembly', ref: 'hyd_power_pack', label: '240-Bar Hyd Unit', x: 40, y: 95, pos3d: [-0.36, 0.24, 0] });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '110mm Forging Ram', x: 280, y: 95, pos3d: [0, 0.62, 0],
            params: { boreMm: 110, strokeMm: 280, maxBar: 260, material: 'toolSteel' } });
        addNode(bp, { id: 'die', type: 'weapon_head', label: 'Forging Press Die', x: 520, y: 95, pos3d: [0, 0.26, 0],
            params: { kind: 'press_platen', massKg: 38, radiusM: 0.22, material: 'toolSteel' } });
        addNode(bp, { id: 'feed_m', type: 'motor', label: 'Feed Motor 1.2kW', x: 40, y: 245, pos3d: [0.36, 0.16, -0.22],
            params: { powerW: 1200, noLoadRpm: 1600, efficiency: 0.86 } });
        addNode(bp, { id: 'worm', type: 'assembly', ref: 'gb_worm_20to1', label: '20:1 Worm Indexer', x: 280, y: 245, pos3d: [0.36, 0.16, 0.02] });
        addNode(bp, { id: 'screw', type: 'lead_screw', label: 'Die Clamp Screw', x: 520, y: 245, pos3d: [0.36, 0.16, 0.28],
            params: { diameterMm: 32, leadMm: 6, strokeMm: 240, material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Hydraulic Oil Cooler', x: 740, y: 245, pos3d: [-0.36, 0.28, -0.34],
            params: { coolingKW: 6.0, widthMm: 280, heightMm: 220 } });
        addNode(bp, { id: 'frame', type: 'frame', label: 'H-Frame Press Bed', x: 740, y: 95, pos3d: [0, 0.45, 0],
            params: { lengthM: 0.96, widthM: 1.05, heightM: 0.92, wallMm: 12.0, material: 'castIron' } });
        wire(bp, lib, [
            ['hpu', 'hyd_out', 'ram', 'hyd_in'],
            ['ram', 'lin_out', 'die', 'lin_in'],
            ['feed_m', 'rot_out', 'worm', 'rot_in'],
            ['worm', 'rot_out', 'screw', 'rot_in'],
            ['frame', 'struct_out', 'rad', 'struct_in'],
        ]);
        reg(bp);
    }

    // 25. Mantis Dual-Blade (Bevel Transfer + HTD Belt + Sprag Freewheel + Oil Cooler)
    {
        const bp = createBlueprint({
            id: 'bot_twin_saw_mantis',
            name: 'Mantis Bevel-Interceptor',
            scale: 'machine',
            kind: 'bot',
            description: 'High-agility interceptor routing a 4.8 kW motor through a 90° Spiral-Bevel Transfer Case, HTD shock belt, and one-way sprag clutch into a cantilevered S7 bar.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 650Wh Pack', x: 40, y: 180, pos3d: [0, 0.09, -0.34],
            params: { voltage: 48, capacityWh: 650, maxC: 18 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Planetary Pod', x: 270, y: 55,
            pos3d: [-0.22, 0.13, -0.18], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Planetary Pod', x: 270, y: 315,
            pos3d: [0.22, 0.13, -0.18], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Wheel', x: 520, y: 55, pos3d: [-0.42, 0.13, -0.18],
            params: { radiusM: 0.13, widthM: 0.085, grip: 1.35, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Wheel', x: 520, y: 315, pos3d: [0.42, 0.13, -0.18],
            params: { radiusM: 0.13, widthM: 0.085, grip: 1.35, side: 'right' } });
        addNode(bp, { id: 'wmtr', type: 'motor', label: 'Weapon Motor 4.8kW', x: 270, y: 185, pos3d: [0, 0.13, -0.02],
            params: { powerW: 4800, noLoadRpm: 4400, efficiency: 0.89 } });
        addNode(bp, { id: 'bev', type: 'bevel_gear', label: '90° Bevel Transfer', x: 470, y: 185, pos3d: [0, 0.13, 0.12],
            params: { ratio: 1.75, crownOdMm: 86, material: 'alloySteel' } });
        addNode(bp, { id: 'belt', type: 'belt_drive', label: 'HTD Shock Belt', x: 670, y: 185, pos3d: [0, 0.13, 0.28],
            params: { ratio: 1.6, widthMm: 26, spanMm: 140, slipTorqueNm: 54 } });
        addNode(bp, { id: 'sprag', type: 'overrun_clutch', label: 'Sprag Freewheel', x: 870, y: 185, pos3d: [0, 0.13, 0.42],
            params: { diameterMm: 54, material: 'toolSteel' } });
        addNode(bp, { id: 'bar', type: 'weapon_head', label: 'S7 Interceptor Bar', x: 1065, y: 185, pos3d: [0, 0.16, 0.78],
            params: { kind: 'spinner_bar', massKg: 10.5, radiusM: 0.31, material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Rear Bay Cooler', x: 520, y: 405, pos3d: [0, 0.13, -0.46],
            params: { coolingKW: 3.5, widthMm: 220, heightMm: 110 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Titanium Frame', x: 750, y: 405, pos3d: [0, 0.125, -0.04],
            params: { lengthM: 0.82, widthM: 0.70, heightM: 0.20, wallMm: 5.5, material: 'titanium' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'wmtr', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['wmtr', 'rot_out', 'bev', 'rot_in'],
            ['bev', 'rot_out', 'belt', 'rot_in'],
            ['belt', 'rot_out', 'sprag', 'rot_in'],
            ['sprag', 'rot_out', 'bar', 'rot_in'],
            ['chassis', 'struct_out', 'rad', 'struct_in'],
        ]);
        reg(bp);
    }

    // 26. Piledriver — Tracked Crank-Slider Battering Spear!
    {
        const bp = createBlueprint({
            id: 'bot_piledriver_crank',
            name: 'Piledriver (Crank-Hammer)',
            scale: 'machine',
            kind: 'bot',
            description: 'Armored crawler-tracked jackhammer bot: 3.6 kW motor + 5:1 planetary + slip clutch driving an eccentric Crank-Slider mechanism and reciprocating S7 battering spear!',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 700Wh Pack', x: 40, y: 180, pos3d: [0, 0.095, -0.35],
            params: { voltage: 48, capacityWh: 700, maxC: 16 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_crawler', label: 'Left Track Drive', x: 270, y: 55,
            pos3d: [-0.215, 0.12, -0.26], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_crawler', label: 'Right Track Drive', x: 270, y: 315,
            pos3d: [0.215, 0.12, -0.26], yaw3d: PI / 2 });
        addNode(bp, { id: 'track_l', type: 'track_unit', label: 'Left Crawler Track', x: 525, y: 55, pos3d: [-0.43, 0.12, -0.02],
            params: { lengthM: 0.72, heightM: 0.21, widthM: 0.11, grip: 1.65, side: 'left' } });
        addNode(bp, { id: 'track_r', type: 'track_unit', label: 'Right Crawler Track', x: 525, y: 315, pos3d: [0.43, 0.12, -0.02],
            params: { lengthM: 0.72, heightM: 0.21, widthM: 0.11, grip: 1.65, side: 'right' } });
        addNode(bp, { id: 'wmtr', type: 'motor', label: 'Hammer Motor 3.6kW', x: 270, y: 185, pos3d: [0, 0.135, -0.02],
            params: { powerW: 3600, noLoadRpm: 3200, efficiency: 0.88 } });
        addNode(bp, { id: 'plan', type: 'planetary_gear', label: '5:1 Crank Reduction', x: 465, y: 185, pos3d: [0, 0.135, 0.10],
            params: { ratio: 5, ringOdMm: 82, faceWidthMm: 24, planets: 3, material: 'toolSteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '90 N·m Impact Clutch', x: 660, y: 185, pos3d: [0, 0.135, 0.19],
            params: { slipTorqueNm: 90, radiusMm: 46 } });
        addNode(bp, { id: 'crank', type: 'crank_slider', label: '84mm Crank-Slider', x: 855, y: 185, pos3d: [0, 0.135, 0.34],
            params: { throwMm: 42, rodLenMm: 155, material: 'toolSteel' } });
        addNode(bp, { id: 'spear', type: 'weapon_head', label: 'S7 Battering Spear', x: 1055, y: 185, pos3d: [0, 0.135, 0.62],
            params: { kind: 'piledriver_spear', massKg: 9.0, radiusM: 0.28, material: 'toolSteel' } });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4140 Assault Hull', x: 525, y: 405, pos3d: [0, 0.13, -0.02],
            params: { lengthM: 0.86, widthM: 0.70, heightM: 0.22, wallMm: 6.5, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'wmtr', 'elec_in'],
            ['drive_l', 'rot_out', 'track_l', 'rot_in'],
            ['drive_r', 'rot_out', 'track_r', 'rot_in'],
            ['wmtr', 'rot_out', 'plan', 'rot_in'],
            ['plan', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'crank', 'rot_in'],
            ['crank', 'lin_out', 'spear', 'lin_in'],
        ]);
        reg(bp);
    }

    // 27. Goliath Twin-V4 Heavyweight (Dual Gas Engines -> Summing Differential -> Slip Clutch -> Heavy Drum!)
    {
        const bp = createBlueprint({
            id: 'bot_goliath_twin_v4',
            name: 'Goliath Twin-V4 (Diff Drum)',
            scale: 'machine',
            kind: 'bot',
            description: 'Dual 320cc gas engines summed through a cutaway Bevel Differential, Slip Clutch & Brass Shear Pin into a brutal 16 kg S7 Vertical Drum.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 450Wh Drive Pack', x: 40, y: 80, pos3d: [0, 0.08, -0.38],
            params: { voltage: 48, capacityWh: 450, maxC: 15 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Planetary Pod', x: 260, y: 35,
            pos3d: [-0.23, 0.13, -0.22], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Planetary Pod', x: 260, y: 130,
            pos3d: [0.23, 0.13, -0.22], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Heavy Wheel', x: 500, y: 35, pos3d: [-0.45, 0.14, -0.22],
            params: { radiusM: 0.14, widthM: 0.09, grip: 1.35, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Heavy Wheel', x: 500, y: 130, pos3d: [0.45, 0.14, -0.22],
            params: { radiusM: 0.14, widthM: 0.09, grip: 1.35, side: 'right' } });
        addNode(bp, { id: 'eng_l', type: 'ic_engine', label: 'Left 320cc V4', x: 40, y: 235, pos3d: [-0.18, 0.24, -0.02],
            params: { displacementCc: 320, cylinders: 4, redlineRpm: 5800, fuelKg: 2.0 } });
        addNode(bp, { id: 'eng_r', type: 'ic_engine', label: 'Right 320cc V4', x: 40, y: 345, pos3d: [0.18, 0.24, -0.02],
            params: { displacementCc: 320, cylinders: 4, redlineRpm: 5800, fuelKg: 2.0 } });
        addNode(bp, { id: 'diff', type: 'differential', label: 'Summing Differential', x: 270, y: 285, pos3d: [0, 0.14, 0.18],
            params: { ratio: 1.75, carrierOdMm: 118, material: 'toolSteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '85 N·m Drum Clutch', x: 480, y: 285, pos3d: [0, 0.14, 0.30],
            params: { slipTorqueNm: 85, radiusMm: 48 } });
        addNode(bp, { id: 'pin', type: 'shear_pin', label: 'Drum Shear Pin', x: 680, y: 285, pos3d: [0, 0.14, 0.38],
            params: { diameterMm: 11.5, material: 'brass' } });
        addNode(bp, { id: 'drum', type: 'weapon_head', label: '16kg S7 Heavy Drum', x: 880, y: 285, pos3d: [0, 0.14, 0.54],
            params: { kind: 'spinner_drum', massKg: 16.0, radiusM: 0.12, material: 'toolSteel' } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Heavy 4140 Hull', x: 500, y: 405, pos3d: [0, 0.13, -0.04],
            params: { lengthM: 0.92, widthM: 0.76, heightM: 0.22, wallMm: 6.5, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['eng_l', 'rot_out', 'diff', 'rot_in'],
            ['eng_r', 'rot_out', 'diff', 'rot_in_b'],
            ['diff', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'pin', 'rot_in'],
            ['pin', 'rot_out', 'drum', 'rot_in'],
        ]);
        reg(bp);
    }

    // 28. Foundry 3-Axis CNC Milling Machine (Workshop Fabrication Tool!)
    {
        const bp = createBlueprint({
            id: 'machine_cnc_mill',
            name: 'Foundry 3-Axis CNC Mill',
            scale: 'machine',
            kind: 'tool',
            description: 'Precision workshop milling machine for machining custom billet chassis & gear blanks: 7200 RPM belted carbide spindle + self-locking worm & Acme lead-screw cross-slide table.',
        });
        addNode(bp, { id: 'psu', type: 'battery', label: '48V Shop Bus', x: 40, y: 170, pos3d: [-0.36, 0.14, -0.30],
            params: { voltage: 48, capacityWh: 1200, maxC: 10 } });
        addNode(bp, { id: 'sp_m', type: 'motor', label: 'Spindle Motor 3.2kW', x: 250, y: 90, pos3d: [-0.26, 0.68, -0.06], yaw3d: PI / 2,
            params: { powerW: 3200, noLoadRpm: 4200, efficiency: 0.90 } });
        addNode(bp, { id: 'belt', type: 'belt_drive', label: 'Speed-Up HTD Belt', x: 465, y: 90, pos3d: [-0.02, 0.68, -0.06], yaw3d: PI / 2,
            params: { ratio: 0.6, widthMm: 22, spanMm: 220, slipTorqueNm: 38 } });
        addNode(bp, { id: 'spindle', type: 'weapon_head', label: 'TiN Carbide Mill Head', x: 685, y: 90, pos3d: [0.09, 0.48, -0.06],
            params: { kind: 'mill_spindle', massKg: 8.5, radiusM: 0.08, material: 'toolSteel' } });
        addNode(bp, { id: 'ax_m', type: 'motor', label: 'X-Feed Servo 0.9kW', x: 250, y: 245, pos3d: [0.34, 0.15, -0.26],
            params: { powerW: 900, noLoadRpm: 1600, efficiency: 0.88 } });
        addNode(bp, { id: 'worm', type: 'assembly', ref: 'gb_worm_20to1', label: '20:1 Worm Feed', x: 465, y: 245, pos3d: [0.34, 0.15, -0.04] });
        addNode(bp, { id: 'screw', type: 'lead_screw', label: 'X-Axis Lead Screw', x: 685, y: 245, pos3d: [0.34, 0.15, 0.24],
            params: { diameterMm: 26, leadMm: 5, strokeMm: 280, material: 'toolSteel' } });
        addNode(bp, { id: 'frame', type: 'frame', label: 'Cast-Iron Mill Gantry', x: 465, y: 375, pos3d: [0, 0.44, 0],
            params: { lengthM: 0.94, widthM: 1.02, heightM: 0.90, wallMm: 14.0, material: 'castIron' } });
        wire(bp, lib, [
            ['psu', 'elec_out', 'sp_m', 'elec_in'],
            ['psu', 'elec_out', 'ax_m', 'elec_in'],
            ['sp_m', 'rot_out', 'belt', 'rot_in'],
            ['belt', 'rot_out', 'spindle', 'rot_in'],
            ['ax_m', 'rot_out', 'worm', 'rot_in'],
            ['worm', 'rot_out', 'screw', 'rot_in'],
        ]);
        reg(bp);
    }

    // =========================================================================
    // TIER 3: MULTI-STOREY TITAN MODULES & SIEGE ENGINES (4–10 m, 4–22 tonnes)
    // =========================================================================

    // 29. Titan 6m Hip Actuator Pack (calibrated 2000 RPM diesel + Ø220 mm main roller support!)
    {
        const bp = createBlueprint({
            id: 'titan_hip_drive',
            name: 'Titan 6m Hip Actuator Pack',
            scale: 'titan',
            kind: 'powerpack',
            description: 'Proof-of-scale multi-storey mech hip drive: 14L V8 diesel (2000 RPM) driving a 20:1 two-stage bull-gear transmission with 18 kN·m torque limiter and sacrificial coupling.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '14L V8 Diesel', x: 40, y: 140, pos3d: [0, 0, -1.55],
            params: { displacementCc: 14000, cylinders: 8, redlineRpm: 2000, fuelKg: 280 } });
        addNode(bp, { id: 's1', type: 'gear_pair', label: 'Primary 4:1 Stage', x: 240, y: 140, pos3d: [0, 0, -0.55],
            params: { teethIn: 16, teethOut: 64, moduleMm: 14, faceWidthMm: 110, material: 'alloySteel' } });
        addNode(bp, { id: 'brg', type: 'bearing', label: 'Main Roller Support', x: 440, y: 140, pos3d: [0.56, 0, 0.05],
            params: { boreMm: 220, kind: 'roller', material: 'toolSteel' } });
        addNode(bp, { id: 's2', type: 'gear_pair', label: 'Final 5:1 Bull Gear', x: 640, y: 140, pos3d: [0.56, 0, 0.65],
            params: { teethIn: 16, teethOut: 80, moduleMm: 22, faceWidthMm: 170, material: 'toolSteel' } });
        addNode(bp, { id: 'clutch', type: 'slip_clutch', label: '18 kN·m Slip Clutch', x: 850, y: 140, pos3d: [1.62, 0, 1.30],
            params: { slipTorqueNm: 18000, radiusMm: 440 } });
        addNode(bp, { id: 'pin', type: 'shear_pin', label: 'Hip Shear Coupling', x: 1050, y: 140, pos3d: [1.62, 0, 1.85],
            params: { diameterMm: 78, material: 'brass' } });
        wire(bp, lib, [
            ['eng', 'rot_out', 's1', 'rot_in'],
            ['s1', 'rot_out', 'brg', 'rot_in'],
            ['brg', 'rot_out', 's2', 'rot_in'],
            ['s2', 'rot_out', 'clutch', 'rot_in'],
            ['clutch', 'rot_out', 'pin', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'rot_out', label: 'Hip Output Shaft', domain: 'rot', dir: 'out', nodeId: 'pin', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 30. Titan 8m Hydraulic Knee & Stride Actuator (calibrated 1700 RPM V12 diesel!)
    {
        const bp = createBlueprint({
            id: 'titan_hydraulic_leg',
            name: 'Titan 8m Hydraulic Leg Drive',
            scale: 'titan',
            kind: 'powerpack',
            description: 'Multi-storey mech knee/stride actuator: 18L V12 diesel (1700 RPM) driving a 260 cc/rev axial hydraulic pump through a 320-bar relief manifold and 120 kW radiator into a 1.45 MN leg ram.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '18L V12 Diesel', x: 40, y: 140, pos3d: [0, 0, -2.0],
            params: { displacementCc: 18000, cylinders: 12, redlineRpm: 1700, fuelKg: 420 } });
        addNode(bp, { id: 'pump', type: 'hydraulic_pump', label: '260cc Axial Pump', x: 255, y: 140, pos3d: [0, 0, -0.55],
            params: { dispCcRev: 260, maxBar: 360, efficiency: 0.91 } });
        addNode(bp, { id: 'valve', type: 'hydraulic_valve', label: '320-Bar Relief Block', x: 470, y: 140, pos3d: [0, 0, 0.30],
            params: { reliefBar: 320, flowLpm: 520 } });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '240mm Leg Ram (1.4MN)', x: 690, y: 140, pos3d: [0, 0, 1.85],
            params: { boreMm: 240, strokeMm: 1400, maxBar: 360, material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: '120kW Oil Radiator', x: 470, y: 275, pos3d: [1.35, 0.15, -0.35],
            params: { coolingKW: 120, widthMm: 1400, heightMm: 1100 } });
        wire(bp, lib, [
            ['eng', 'rot_out', 'pump', 'rot_in'],
            ['pump', 'hyd_out', 'valve', 'hyd_in'],
            ['valve', 'hyd_out', 'ram', 'hyd_in'],
        ]);
        bp.exposedPorts = [
            { id: 'lin_out', label: 'Knee Thrust Rod', domain: 'lin', dir: 'out', nodeId: 'ram', portId: 'lin_out' },
        ];
        reg(bp);
    }

    // 31. Metropolis Siege Crawler Bogie (12L V8 -> 6:1 Planetary -> Slip Clutch -> Heavy Chain -> 4.6m Track!)
    {
        const bp = createBlueprint({
            id: 'titan_crawler_bogie',
            name: 'Metropolis Siege Track Bogie',
            scale: 'titan',
            kind: 'drivetrain',
            description: 'Single side-pod crawler bogie for a 40-tonne Metropolis siege platform: 12L V8 diesel -> 6:1 0.92 m planetary hub -> slip clutch -> #160 roller chain -> 4.6 m armored track unit.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '12L V8 Turbodiesel', x: 40, y: 140, pos3d: [-0.85, 0.25, -1.65],
            params: { displacementCc: 12000, cylinders: 8, redlineRpm: 2000, fuelKg: 260 } });
        addNode(bp, { id: 'plan', type: 'planetary_gear', label: '6:1 Final Planetary', x: 255, y: 140, pos3d: [-0.85, 0.25, -0.10],
            params: { ratio: 6, ringOdMm: 920, faceWidthMm: 220, planets: 5, material: 'toolSteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '16 kN·m Track Clutch', x: 470, y: 140, pos3d: [-0.85, 0.25, 0.72],
            params: { slipTorqueNm: 16000, radiusMm: 420 } });
        addNode(bp, { id: 'chain', type: 'chain_drive', label: 'Heavy Transfer Chain', x: 685, y: 140, pos3d: [-0.85, 0.25, 1.55],
            params: { ratio: 2.0, pitchMm: 44.45, spanMm: 1200, material: 'toolSteel' } });
        addNode(bp, { id: 'track', type: 'track_unit', label: '4.6m Siege Track Pod', x: 910, y: 140, pos3d: [0.65, 0.25, 0.55],
            params: { lengthM: 4.6, heightM: 1.35, widthM: 0.95, grip: 1.8, side: 'right' } });
        wire(bp, lib, [
            ['eng', 'rot_out', 'plan', 'rot_in'],
            ['plan', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'chain', 'rot_in'],
            ['chain', 'rot_out', 'track', 'rot_in'],
        ]);
        reg(bp);
    }

    // 32. Titan 10m Twin-Diesel Siege Power Core (Dual 14L V8s -> Summing Diff -> Planetary + Hydraulic Ram!)
    {
        const bp = createBlueprint({
            id: 'titan_siege_core',
            name: 'Titan 10m Twin-Diesel Core',
            scale: 'titan',
            kind: 'powerpack',
            description: 'Dual 14L V8 turbodiesels summed through a 1.1 m Bevel Differential driving both a 260cc Hydraulic Leg Ram (320-bar relief protected) and an auxiliary 5:1 Planetary PTO.',
        });
        addNode(bp, { id: 'eng_l', type: 'ic_engine', label: 'Port 14L V8 Diesel', x: 40, y: 80, pos3d: [-1.10, 0, -2.10],
            params: { displacementCc: 14000, cylinders: 8, redlineRpm: 1600, fuelKg: 300 } });
        addNode(bp, { id: 'eng_r', type: 'ic_engine', label: 'Stbd 14L V8 Diesel', x: 40, y: 220, pos3d: [1.10, 0, -2.10],
            params: { displacementCc: 14000, cylinders: 8, redlineRpm: 1600, fuelKg: 300 } });
        addNode(bp, { id: 'diff', type: 'differential', label: '1.1m Summing Diff', x: 260, y: 150, pos3d: [0, 0, -0.55],
            params: { ratio: 1.5, carrierOdMm: 1100, material: 'toolSteel' } });
        addNode(bp, { id: 'pump', type: 'hydraulic_pump', label: '260cc Main Pump', x: 480, y: 95, pos3d: [-0.65, 0, 0.85],
            params: { dispCcRev: 260, maxBar: 360, efficiency: 0.91 } });
        addNode(bp, { id: 'valve', type: 'hydraulic_valve', label: '320-Bar Relief Block', x: 695, y: 95, pos3d: [-0.65, 0, 1.65],
            params: { reliefBar: 320, flowLpm: 540 } });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '240mm Siege Ram', x: 910, y: 95, pos3d: [-0.65, 0, 3.10],
            params: { boreMm: 240, strokeMm: 1400, maxBar: 360, material: 'toolSteel' } });
        addNode(bp, { id: 'plan', type: 'planetary_gear', label: '5:1 Auxiliary PTO', x: 480, y: 225, pos3d: [0.85, 0, 0.95],
            params: { ratio: 5, ringOdMm: 860, faceWidthMm: 200, planets: 4, material: 'toolSteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '16 kN·m PTO Clutch', x: 695, y: 225, pos3d: [0.85, 0, 1.85],
            params: { slipTorqueNm: 16000, radiusMm: 410 } });
        addNode(bp, { id: 'rad', type: 'radiator', label: '160kW Twin Radiator', x: 910, y: 225, pos3d: [0, 1.42, -0.55],
            params: { coolingKW: 160, widthMm: 1700, heightMm: 1100 } });
        wire(bp, lib, [
            ['eng_l', 'rot_out', 'diff', 'rot_in'],
            ['eng_r', 'rot_out', 'diff', 'rot_in_b'],
            ['diff', 'rot_out', 'pump', 'rot_in'],
            ['pump', 'hyd_out', 'valve', 'hyd_in'],
            ['valve', 'hyd_out', 'ram', 'hyd_in'],
            ['diff', 'rot_out_b', 'plan', 'rot_in'],
            ['plan', 'rot_out', 'cl', 'rot_in'],
        ]);
        reg(bp);
    }
}
