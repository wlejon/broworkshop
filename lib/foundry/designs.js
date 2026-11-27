// lib/foundry/designs.js — the starter library: a ladder of designs, each
// built from the contracts of the ones below it.
//
//   1  Reducer 9:1        two spur stages
//   2  Drive Pod          motor + Reducer 9:1 + slip clutch
//   3  Joint Actuator     Drive Pod + worm: big torque, slow, holds unpowered
//   3  Linear Actuator    Drive Pod + ball screw: a push
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
            id: 'reducer9', name: 'Reducer 9:1', level: 1, paint: PAINT.steel,
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
            id: 'drivePod', name: 'Drive Pod', level: 2, paint: PAINT.orange,
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
            id: 'jointActuator', name: 'Joint Actuator', level: 3, paint: PAINT.yellow,
            note: 'The Drive Pod into a 40:1 worm. Slow and enormously strong, and the worm holds the joint when the power is off.',
            children: [
                { id: 'pod', design: 'drivePod' },
                { id: 'wrm', part: 'worm', params: { wheelTeeth: 40, starts: 1, quotient: 20, moduleMm: 6, faceMm: 60, material: 'bronze' } },
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
            id: 'linearActuator', name: 'Linear Actuator', level: 3, paint: PAINT.teal,
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
            id: 'armSegment', name: 'Arm Segment', level: 4, paint: PAINT.yellow,
            note: 'The Joint Actuator swinging a 1.2 m boom. What it lifts at the tip is what the joint holds, less the boom it carries.',
            children: [
                { id: 'jnt', design: 'jointActuator' },
                { id: 'bm', part: 'boom', params: { lengthM: 1.2, heightMm: 120, widthMm: 80, wallMm: 4, material: 'alloySteel' } },
            ],
            links: [{ a: 'jnt.out', b: 'bm.in' }],
            ports: [
                { id: 'pwr', label: 'Power', at: 'jnt.pwr' },
                { id: 'base', label: 'Base', at: 'jnt.base' },
                { id: 'tip', label: 'Tip', at: 'bm.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 100, reachM: 1.3 } },
        },

        twoLinkArm: {
            id: 'twoLinkArm', name: 'Two-Link Arm', level: 5, paint: PAINT.yellow,
            note: 'One Arm Segment on the tip of another. The shoulder carries the whole elbow, so it is the shoulder that runs out first.',
            children: [
                { id: 'sh', design: 'armSegment' },
                { id: 'el', design: 'armSegment' },
            ],
            links: [{ a: 'sh.tip', b: 'el.base', spin: 3 }],
            ports: [
                { id: 'pwrS', label: 'Shoulder power', at: 'sh.pwr' },
                { id: 'pwrE', label: 'Elbow power', at: 'el.pwr' },
                { id: 'base', label: 'Base', at: 'sh.base' },
                { id: 'tip', label: 'Tip', at: 'el.tip' },
            ],
            goal: { out: 'tip', lift: { payloadKg: 18, reachM: 2.6 } },
        },
    };
}
