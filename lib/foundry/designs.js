// lib/foundry/designs.js — the starter library: a ladder of designs, each
// built from the contracts of the ones below it.
//
//   1  Reducer 9:1        two spur stages
//   2  Drive Pod          motor + Reducer 9:1 + slip clutch
//   3  Joint Actuator     Drive Pod + worm: big torque, slow, holds unpowered
//   3  Linear Actuator    Drive Pod + ball screw: a push
//   4  Arm Segment        Joint Actuator swinging a boom
//   5  Two-Link Arm       an Arm Segment on the tip of another
//   5  Slewing Crane      a boom on a slewing ring, an Arm Segment on its end
//   6  Excavator          the Two-Link Arm on a turret on a slewing ring
//
// Goals are what each must deliver; the numbers are SI (N·m, rad/s, N, m/s).

const RPM = (2 * Math.PI) / 60;

export const PAINT = {
    steel: [0.30, 0.34, 0.40],
    orange: [0.86, 0.36, 0.10],
    yellow: [0.92, 0.66, 0.12],
    teal: [0.10, 0.52, 0.56],
    red: [0.70, 0.13, 0.12],
    graphite: [0.16, 0.17, 0.19],
};

export function starterLibrary() {
    return {
        reducer9: {
            id: 'reducer9', name: 'Reducer 9:1', paint: PAINT.steel,
            note: 'Turns a fast, weak motor shaft into a slow, strong one. Two 3:1 spur stages; each output offset by its centre distance.',
            children: [
                { id: 's1', part: 'spur', params: { teethIn: 14, teethOut: 42, moduleMm: 1.5, faceMm: 14 } },
                { id: 's2', part: 'spur', params: { teethIn: 15, teethOut: 45, moduleMm: 2, faceMm: 18 } },
            ],
            links: [{ a: 's1.out', b: 's2.in', spin: 2 }],
            ports: [
                { id: 'in', label: 'Input', at: 's1.in' },
                { id: 'out', label: 'Output', at: 's2.out' },
            ],
            goal: {
                out: 'out',
                given: { effort: 10, flow: 3600 * RPM },
                need: { effort: 80, flow: 390 * RPM },
                box: [0.16, 0.12, 0.12],
            },
        },

        drivePod: {
            id: 'drivePod', name: 'Drive Pod', paint: PAINT.orange,
            note: 'A motor through the Reducer, with a slip clutch on the output so a jammed load slips instead of stripping the gears.',
            children: [
                { id: 'mtr', part: 'motor', params: { powerW: 2400, noLoadRpm: 3600 } },
                { id: 'red', design: 'reducer9' },
                { id: 'clu', part: 'clutch', params: { slipNm: 150, radiusMm: 55 } },
            ],
            links: [
                { a: 'mtr.out', b: 'red.in' },
                { a: 'red.out', b: 'clu.in' },
            ],
            ports: [
                { id: 'pwr', label: 'Power', at: 'mtr.pwr' },
                { id: 'out', label: 'Output', at: 'clu.out' },
            ],
            goal: {
                out: 'out',
                need: { effort: 75, flow: 190 * RPM },
                box: [0.3, 0.16, 0.42],
            },
        },

        jointActuator: {
            id: 'jointActuator', name: 'Joint Actuator', paint: PAINT.yellow,
            note: 'The Drive Pod into a 40:1 worm. Slow and enormously strong, and the worm holds the joint when the power is off.',
            children: [
                { id: 'pod', design: 'drivePod' },
                { id: 'wrm', part: 'worm', params: { wheelTeeth: 40, starts: 1, quotient: 20, moduleMm: 6, faceMm: 60, material: 'bronze', mount: 'end' } },
            ],
            links: [{ a: 'pod.out', b: 'wrm.in' }],
            ports: [
                { id: 'pwr', label: 'Power', at: 'pod.pwr' },
                { id: 'out', label: 'Joint', at: 'wrm.out' },
                { id: 'base', label: 'Base', at: 'wrm.base' },
            ],
            goal: {
                out: 'out',
                need: { effort: 1500, flow: 4 * RPM },
            },
        },

        linearActuator: {
            id: 'linearActuator', name: 'Linear Actuator', paint: PAINT.teal,
            note: 'The Drive Pod on a ball screw: tens of kilonewtons of push over half a metre.',
            children: [
                { id: 'pod', design: 'drivePod' },
                { id: 'scr', part: 'leadScrew', params: { diameterMm: 25, leadMm: 10, strokeMm: 450 } },
            ],
            links: [{ a: 'pod.out', b: 'scr.in' }],
            ports: [
                { id: 'pwr', label: 'Power', at: 'pod.pwr' },
                { id: 'out', label: 'Rod', at: 'scr.out' },
            ],
            goal: {
                out: 'out',
                need: { effort: 25000, flow: 0.025 },
            },
        },

        armSegment: {
            id: 'armSegment', name: 'Arm Segment', paint: PAINT.yellow,
            note: 'The Joint Actuator swinging a 1.2 m boom. What it lifts at the tip is what the joint holds, less the boom it carries.',
            children: [
                { id: 'jnt', design: 'jointActuator' },
                { id: 'bm', part: 'boom', params: { lengthM: 1.2, heightMm: 120, widthMm: 80, wallMm: 4, material: 'alloySteel' } },
            ],
            links: [{ a: 'jnt.out', b: 'bm.in', spin: 2 }],
            ports: [
                { id: 'pwr', label: 'Power', at: 'jnt.pwr' },
                { id: 'base', label: 'Base', at: 'jnt.base' },
                { id: 'tip', label: 'Tip', at: 'bm.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 100, reachM: 1.3 } },
        },

        twoLinkArm: {
            id: 'twoLinkArm', name: 'Two-Link Arm', paint: PAINT.yellow,
            note: 'One Arm Segment on the tip of another. The shoulder carries the whole elbow, so it is the shoulder that runs out first.',
            children: [
                { id: 'sh', design: 'armSegment' },
                { id: 'el', design: 'armSegment' },
            ],
            links: [{ a: 'sh.tip', b: 'el.base', spin: 2 }],
            ports: [
                { id: 'pwrS', label: 'Shoulder power', at: 'sh.pwr' },
                { id: 'pwrE', label: 'Elbow power', at: 'el.pwr' },
                { id: 'base', label: 'Base', at: 'sh.base' },
                { id: 'tip', label: 'Tip', at: 'el.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 18, reachM: 2.6 } },
        },
        slewingCrane: {
            id: 'slewingCrane', name: 'Slewing Crane', paint: PAINT.orange,
            note: 'A boom swung round level on a slewing ring, four Drive Pods turning it together, an Arm Segment lifting on its end. The turntable takes no weight; the ring takes as many drives as it needs.',
            children: [
                { id: 'ring', part: 'slewRing', params: { ringTeeth: 120, pinionTeeth: 16, pinions: 4, moduleMm: 6, faceMm: 60, material: 'alloySteel', mount: 'under' } },
                { id: 'p1', design: 'drivePod' },
                { id: 'p2', design: 'drivePod' },
                { id: 'p3', design: 'drivePod' },
                { id: 'p4', design: 'drivePod' },
                { id: 'jib', part: 'boom', params: { lengthM: 1.6, heightMm: 160, widthMm: 100, wallMm: 5, material: 'alloySteel' } },
                { id: 'arm', design: 'armSegment' },
            ],
            links: [
                { a: 'p1.out', b: 'ring.in1' }, { a: 'p2.out', b: 'ring.in2' }, { a: 'p3.out', b: 'ring.in3' }, { a: 'p4.out', b: 'ring.in4' },
                { a: 'ring.out', b: 'jib.in' },
                { a: 'jib.tip', b: 'arm.base', spin: 1 },
            ],
            ports: [
                { id: 'pwr', label: 'Slew power', at: 'p1.pwr' },
                { id: 'pwr2', label: 'Slew power', at: 'p2.pwr' },
                { id: 'pwr3', label: 'Slew power', at: 'p3.pwr' },
                { id: 'pwr4', label: 'Slew power', at: 'p4.pwr' },
                { id: 'pwrA', label: 'Arm power', at: 'arm.pwr' },
                { id: 'base', label: 'Base', at: 'ring.base' },
                { id: 'tip', label: 'Tip', at: 'arm.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 100, reachM: 3.1 } },
        },

        excavator: {
            id: 'excavator', name: 'Excavator', paint: PAINT.yellow,
            note: 'The Two-Link Arm on a turret swung by a slewing ring: slew, boom and stick, each its own drive, each carried by the one before it.',
            children: [
                { id: 'ring', part: 'slewRing', params: { ringTeeth: 120, pinionTeeth: 16, pinions: 4, moduleMm: 6, faceMm: 60, material: 'alloySteel', mount: 'under' } },
                { id: 'p1', design: 'drivePod' },
                { id: 'p2', design: 'drivePod' },
                { id: 'p3', design: 'drivePod' },
                { id: 'p4', design: 'drivePod' },
                { id: 'tur', part: 'boom', params: { lengthM: 0.5, heightMm: 160, widthMm: 120, wallMm: 6, material: 'alloySteel' } },
                { id: 'arm', design: 'twoLinkArm' },
            ],
            links: [
                { a: 'p1.out', b: 'ring.in1' }, { a: 'p2.out', b: 'ring.in2' }, { a: 'p3.out', b: 'ring.in3' }, { a: 'p4.out', b: 'ring.in4' },
                { a: 'ring.out', b: 'tur.in' },
                { a: 'tur.tip', b: 'arm.base', spin: 1 },
            ],
            ports: [
                { id: 'pwr', label: 'Slew power', at: 'p1.pwr' },
                { id: 'pwr2', label: 'Slew power', at: 'p2.pwr' },
                { id: 'pwr3', label: 'Slew power', at: 'p3.pwr' },
                { id: 'pwr4', label: 'Slew power', at: 'p4.pwr' },
                { id: 'pwrS', label: 'Boom power', at: 'arm.pwrS' },
                { id: 'pwrE', label: 'Stick power', at: 'arm.pwrE' },
                { id: 'base', label: 'Base', at: 'ring.base' },
                { id: 'tip', label: 'Bucket', at: 'arm.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 15, reachM: 3.4 } },
        },

        bigDrive: {
            id: 'bigDrive', name: 'Big Drive', paint: PAINT.graphite,
            note: 'A 2 MW motor through two module-40 planetary stages: a few hundred kilonewton-metres, slowly.',
            children: [
                { id: 'mtr', part: 'motor', params: { powerW: 2000000, noLoadRpm: 600, efficiency: 0.88 } },
                { id: 'pl1', part: 'planetary', params: { sunTeeth: 15, planetTeeth: 24, planets: 4, moduleMm: 40, faceMm: 600, material: 'alloySteel' } },
                { id: 'pl2', part: 'planetary', params: { sunTeeth: 15, planetTeeth: 24, planets: 4, moduleMm: 40, faceMm: 600, material: 'alloySteel' } },
            ],
            links: [{ a: 'mtr.out', b: 'pl1.in' }, { a: 'pl1.out', b: 'pl2.in' }],
            ports: [
                { id: 'pwr', label: 'Power', at: 'mtr.pwr' },
                { id: 'out', label: 'Output', at: 'pl2.out' },
            ],
            goal: { out: 'out', need: { effort: 200000, flow: 8 * RPM } },
        },

        roadBoom: {
            id: 'roadBoom', name: 'Road Boom', paint: PAINT.yellow,
            note: 'A 50 m boom, three metres deep, lifted on a 600-tooth ring standing on its foot, with a Big Drive on each of its 24 pinions. It lifts a hundred tonnes at the far side of a city road, and it is the boom that runs out first.',
            children: [
                { id: 'ring', part: 'slewRing', params: { ringTeeth: 600, pinionTeeth: 16, pinions: 24, moduleMm: 40, faceMm: 600, material: 'alloySteel', mount: 'side' } },
                ...Array.from({ length: 24 }, (_, i) => ({ id: `d${i + 1}`, design: 'bigDrive' })),
                { id: 'bm', part: 'boom', params: { lengthM: 50, heightMm: 3000, widthMm: 1500, wallMm: 40, material: 'alloySteel' } },
            ],
            links: [
                ...Array.from({ length: 24 }, (_, i) => ({ a: `d${i + 1}.out`, b: `ring.in${i + 1}` })),
                { a: 'ring.out', b: 'bm.in' },
            ],
            ports: [
                ...Array.from({ length: 24 }, (_, i) => ({ id: i ? `pwr${i + 1}` : 'pwr', label: 'Lift power', at: `d${i + 1}.pwr` })),
                { id: 'base', label: 'Base', at: 'ring.base' },
                { id: 'tip', label: 'Tip', at: 'bm.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 100000, reachM: 60 } },
        },
    };
}
