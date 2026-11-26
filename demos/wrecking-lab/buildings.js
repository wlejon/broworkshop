// buildings.js — what the lab builds, as World.addStructure members and ties.
//
// Each builder returns { members, ties, kinds, focus: [x, y, z], dist }: `kinds`
// names each member's part ('footing', 'column', 'slab', 'wall', 'core') for
// the colours.

function maker() {
    const members = [], ties = [], kinds = [];
    return {
        members, ties, kinds,
        add(kind, center, half, extra) {
            members.push({ center, half, ...(extra || {}) });
            kinds.push(kind);
            return members.length - 1;
        },
        tie(a, b) { if (a >= 0 && b >= 0 && a !== b) ties.push([a, b]); },
    };
}

/**
 * A framed building: columns on a grid, a slab a bay, and a facade of wall
 * panels a bay wide round each storey, with every third panel left out as an
 * opening on the storeys above the ground.
 */
export function frame({ bays = [3, 3], bay = 6, storeys = 10, storey = 3.6, slab = 0.3, wall = 0.25 } = {}) {
    const m = maker();
    const [nx, nz] = bays;
    const W = nx * bay, D = nz * bay;
    const foot = m.add('footing', [0, -0.4, 0], [W / 2 + 1, 0.4, D / 2 + 1], { anchored: true });
    let below = null;      // the slabs of the storey below, by bay
    let colsBelow = null;
    for (let k = 0; k < storeys; k++) {
        const y0 = k * storey, y1 = y0 + storey - slab;      // clear height y0..y1, slab y1..y1+slab
        const side = Math.min(0.9, 0.45 + 0.03 * (storeys - k));
        // Columns at the grid's vertices.
        const cols = [];
        for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
            const x = -W / 2 + ix * bay, z = -D / 2 + iz * bay;
            const cx = Math.min(Math.max(x, -W / 2 + side / 2), W / 2 - side / 2);
            const cz = Math.min(Math.max(z, -D / 2 + side / 2), D / 2 - side / 2);
            const c = m.add('column', [cx, (y0 + y1) / 2, cz], [side / 2, (y1 - y0) / 2, side / 2], { crush: 4e7 });
            cols.push(c);
            if (colsBelow) m.tie(colsBelow[ix * (nz + 1) + iz], c);
            if (below) {
                for (const [dx, dz] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
                    const bx = ix + dx, bz = iz + dz;
                    if (bx >= 0 && bx < nx && bz >= 0 && bz < nz) m.tie(below[bx * nz + bz], c);
                }
            } else {
                m.tie(foot, c);
            }
        }
        // Slabs, a bay each, on the columns at their corners and tied to each other.
        const slabs = [];
        for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
            const s = m.add('slab', [-W / 2 + (ix + 0.5) * bay, y1 + slab / 2, -D / 2 + (iz + 0.5) * bay], [bay / 2, slab / 2, bay / 2]);
            slabs.push(s);
            for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.tie(cols[(ix + dx) * (nz + 1) + iz + dz], s);
            if (ix > 0) m.tie(slabs[(ix - 1) * nz + iz], s);
            if (iz > 0) m.tie(slabs[ix * nz + iz - 1], s);
        }
        // The facade: panels between the columns, standing on the slab below and
        // under the slab above.
        const panel = (center, half, ix, iz) => {
            const p = m.add('wall', center, half, { sigma: 2e6 });
            m.tie(slabs[ix * nz + iz], p);
            m.tie(below ? below[ix * nz + iz] : foot, p);
            return p;
        };
        const open = (i) => k > 0 && i % 3 === 1;
        for (let ix = 0; ix < nx; ix++) {
            const x = -W / 2 + (ix + 0.5) * bay;
            for (const [z, iz, at] of [[-D / 2 + wall / 2, 0, 0], [D / 2 - wall / 2, nz - 1, 1]]) {
                if (open(ix + at + k)) continue;
                panel([x, (y0 + y1) / 2, z], [bay / 2 - side / 2, (y1 - y0) / 2, wall / 2], ix, iz);
            }
        }
        for (let iz = 0; iz < nz; iz++) {
            const z = -D / 2 + (iz + 0.5) * bay;
            for (const [x, ix, at] of [[-W / 2 + wall / 2, 0, 0], [W / 2 - wall / 2, nx - 1, 1]]) {
                if (open(iz + at + k + 1)) continue;
                panel([x, (y0 + y1) / 2, z], [wall / 2, (y1 - y0) / 2, bay / 2 - side / 2], ix, iz);
            }
        }
        below = slabs;
        colsBelow = cols;
    }
    const H = storeys * storey;
    return { members: m.members, ties: m.ties, kinds: m.kinds, focus: [0, H * 0.45, 0], dist: Math.max(H * 1.5, W * 2.4) };
}

/** A free-standing wall on a footing. */
export function wall({ width = 24, height = 9.6, thick = 0.3 } = {}) {
    const m = maker();
    const foot = m.add('footing', [0, -0.4, 0], [width / 2 + 1, 0.4, 1.2], { anchored: true });
    m.tie(foot, m.add('wall', [0, height / 2, 0], [width / 2, height / 2, thick / 2]));
    return { members: m.members, ties: m.ties, kinds: m.kinds, focus: [0, height * 0.45, 0], dist: width * 1.3 };
}

export const BUILDS = {
    tower: () => frame({ bays: [3, 3], storeys: 14 }),
    block: () => frame({ bays: [5, 2], storeys: 5 }),
    wall: () => wall(),
};
