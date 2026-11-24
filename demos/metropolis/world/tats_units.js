// tats's units (../tats, mounted at /tats by bro.json) stood in the city at
// their own scale: tats's rigs are built in metres (a hex 4 m across its
// flats, a light walker ~4 m tall), so placed as they are they read against
// the city's 3.3 m storeys, 3.4 m lanes and cars as they would in the field.
//
// createTatsLineup(scene, { path, groundAt, lod }) -> Promise<{ units, update(dt), setVisible(v), destroy() } | null>
//   path: [x0, z0, x1, z1, ...], a road's centre line; the units stand down it
//   in a column, smallest first, each facing along it. groundAt(x, z): the
//   ground's height there. null when tats is not beside broworkshop (no mount).

// The ladder (tats docs/units/scale.md): footprint radius in hexes, and the
// metres a rig's legs reach out from its centre (the column's spacing).
const LADDER = [
    { rig: 'tracked', label: 'minion (tracked)', radius: 0, reach: 2.5 },
    { rig: 'walker', label: 'light / heavy', radius: 0, reach: 3, size: 'M' },
    { rig: 'walker', label: 'light / heavy (hostile)', radius: 0, reach: 3, size: 'M', hostile: true },
    { rig: 'superheavy', label: 'superheavy', radius: 1, reach: 9, size: 'H' },
    { rig: 'colossus', label: 'colossus', radius: 2, reach: 17, size: 'H' },
    { rig: 'titan', label: 'titan', radius: 8, reach: 40, size: 'H' },
];

// tats's tokens (css/tokens.css), resolved: the rigs take colours, not CSS.
const COLORS = {
    hull: '#AEBBAA', dark: '#465146', deep: '#333D35', belt: '#28302A',
    chassis: '#F1F4E9', shell: '#D9E0D2', accent: '#9BD8BC', warn: '#E7BE7D', wreck: '#7A8878',
};
const HOSTILE = '#E88C92';

const fitOf = (size) => [
    { slot: 'armL', group: 'weapon', category: 'ballistic', size },
    { slot: 'armR', group: 'weapon', category: 'energy', size },
    { slot: 'back', group: 'weapon', category: 'ordnance', size },
    { slot: 'plating', group: 'plating', category: 'plating', size, profile: 'hardened' },
    { slot: 'head', group: 'system', category: 'sensor-suite' },
    { slot: 'reactor', group: 'core', category: 'power-core', coreType: 'fusion' },
    { slot: 'utility1', group: 'module', category: 'shield-generator' },
    { slot: 'utility2', group: 'module', category: 'heat-sink-bank' },
];

// A point and heading `s` metres along a polyline.
function along(p, s) {
    for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], l = Math.hypot(dx, dz);
        if (s <= l || i + 4 >= p.length) {
            const t = l > 0 ? Math.min(1, s / l) : 0;
            return { x: p[i] + dx * t, z: p[i + 1] + dz * t, yaw: Math.atan2(dx, dz) };
        }
        s -= l;
    }
    return { x: p[0], z: p[1], yaw: 0 };
}

export async function createTatsLineup(scene, { path, groundAt, lod = 'fine' }) {
    let mods;
    try {
        mods = await Promise.all(['tracked', 'walker', 'superheavy', 'colossus', 'titan'].map((n) => import(`/tats/js/world/mechs/${n}.js`)));
    } catch (e) {
        console.warn(`metropolis: tats's units unavailable (${e.message}): is ../tats beside broworkshop?`);
        return null;
    }
    const [tracked, walker, superheavy, colossus, titan] = mods;
    const make = {
        tracked: (o) => tracked.createTrackedRig(scene, o),
        walker: (o) => walker.createWalkerRig(scene, o),
        superheavy: (o) => superheavy.createSuperheavyRig(scene, { ...o, auraR: 0 }),
        colossus: (o) => colossus.createColossusRig(scene, { ...o, auraR: 0 }),
        titan: (o) => titan.createTitanRig(scene, o),
    };
    const groundY = (x, z) => groundAt(x, z);
    const units = [];
    let s = 6;
    for (const L of LADDER) {
        s += L.reach;
        const at = along(path, s);
        s += L.reach + 6;
        const colors = L.hostile ? { ...COLORS, accent: HOSTILE } : COLORS;
        const rig = make[L.rig]({ radius: L.radius, colors, groundY, fit: L.size ? fitOf(L.size) : [], lod });
        const frame = {
            x: at.x, z: at.z, groundY: groundAt(at.x, at.z), yaw: at.yaw, velX: 0, velZ: 0,
            state: 'stand', progress: 0, running: true, aim: null, blink: null, crushing: false, fields: false, boost: false, belt: [],
        };
        units.push({ ...L, rig, frame, height: rig.barY ?? rig.HEAD_TOP ?? 0 });
    }
    // Settled on their feet before they are first seen.
    for (let i = 0; i < 45; i++) for (const u of units) u.rig.update(1 / 30, u.frame);
    return {
        units,
        /** Idle motion (the rigs breathe and shift their weight). */
        update(dt) { for (const u of units) u.rig.update(dt, u.frame); },
        setVisible(v) { for (const u of units) u.rig.setVisible?.(v); },
        destroy() { for (const u of units) u.rig.destroy?.(); },
    };
}
