// River-centered non-grid city road graph, 5 elevated river bridges,
// 18 organic contour-following hillside suburbs, elevated commuter rail loop,
// and sector-indexed BuildingBlueprint + terrain-seated tree seeding.

import {
    WORLD_HALF, SECTOR_SIZE, WATER_Y, RIVER_BED_Y, smoothstep,
    riverCenterX, riverHalfWidth, riverSignedDist, terrainHeight, terrainGradient, districtAt,
} from "/app/world/terrain_field.js";
import { generateBuildingBlueprint } from "/lib/city-building-blueprint.js";

export const BRIDGE_ZS = [-3000, -1350, 0, 1250, 2850];

function rngFor(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function pointToSegDistSq(px, pz, x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const l2 = dx * dx + dz * dz || 1e-6;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / l2));
    const qx = x0 + dx * t, qz = z0 + dz * t;
    const rx = px - qx, rz = pz - qz;
    return rx * rx + rz * rz;
}

function isDrySegment(x0, z0, x1, z1, minBank = 26) {
    for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        if (riverSignedDist(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) < minBank) return false;
    }
    return true;
}

function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] + -3 * p2[1] + p3[1]) * t3),
    ];
}

export function createCityGraph() {
    const roads = [];
    const bridges = [];
    let nextId = 1;

    const addSeg = (x0, z0, x1, z1, opts = {}) => {
        if (Math.hypot(x1 - x0, z1 - z0) < 4) return null;
        if (Math.abs(x0) > WORLD_HALF - 180 || Math.abs(x1) > WORLD_HALF - 180) return null;
        if (Math.abs(z0) > WORLD_HALF - 180 || Math.abs(z1) > WORLD_HALF - 180) return null;
        const seg = {
            id: nextId++,
            x0, z0, x1, z1,
            halfW: opts.halfW ?? 6.5,
            sidewalkW: opts.sidewalkW ?? 2.4,
            kind: opts.kind ?? 'street',
            isBridge: Boolean(opts.isBridge),
            bridgeStyle: opts.bridgeStyle ?? 'arch',
            spanStartT: opts.spanStartT ?? 0.25,
            spanEndT: opts.spanEndT ?? 0.75,
            deckY: opts.deckY ?? 13.0,
            hasSidewalk: opts.hasSidewalk !== false,
            oneway: Boolean(opts.oneway),
        };
        roads.push(seg);
        if (seg.isBridge) bridges.push(seg);
        return seg;
    };

    // 1. 5 Elevated River Bridges across main channel (with ramped embankments)
    const styles = ['cable_stay', 'arch', 'truss', 'arch', 'cable_stay'];
    const bridgeNodes = [];
    for (let bi = 0; bi < BRIDGE_ZS.length; bi++) {
        const bz = BRIDGE_ZS[bi];
        const cx = riverCenterX(bz), hw = riverHalfWidth(bz);
        const wBlvdX = cx - hw - 36, eBlvdX = cx + hw + 36;
        const ax0 = wBlvdX - 82, ax1 = eBlvdX + 82;
        const len = ax1 - ax0;
        addSeg(ax0, bz, ax1, bz, {
            halfW: 10.5, sidewalkW: 2.2, kind: 'bridge', isBridge: true,
            bridgeStyle: styles[bi % styles.length],
            spanStartT: (wBlvdX - ax0) / len,
            spanEndT: (eBlvdX - ax0) / len,
            deckY: 13.5,
        });
        bridgeNodes.push({ z: bz, wBlvdX, eBlvdX, ax0, ax1 });
    }

    // 2. West & East Riverfront Boulevards hugging both riverbanks (never crossing water)
    const zsSet = new Set(BRIDGE_ZS);
    for (let z = -4320; z <= 4320; z += 120) zsSet.add(z);
    const blvdZs = Array.from(zsSet).sort((a, b) => a - b);
    for (let i = 0; i + 1 < blvdZs.length; i++) {
        const z0 = blvdZs[i], z1 = blvdZs[i + 1];
        const wx0 = riverCenterX(z0) - riverHalfWidth(z0) - 36;
        const wx1 = riverCenterX(z1) - riverHalfWidth(z1) - 36;
        const ex0 = riverCenterX(z0) + riverHalfWidth(z0) + 36;
        const ex1 = riverCenterX(z1) + riverHalfWidth(z1) + 36;
        addSeg(wx0, z0, wx1, z1, { halfW: 9.0, sidewalkW: 3.2, kind: 'boulevard' });
        addSeg(ex0, z0, ex1, z1, { halfW: 9.0, sidewalkW: 3.2, kind: 'boulevard' });
    }

    // 3. Curved Ring Parkways around the valley basin (split cleanly outside river channel)
    for (const ring of [
        { rad: 1480, amp: 140, phase: 0.4, n: 48, halfW: 8.5, kind: 'arterial' },
        { rad: 2780, amp: 220, phase: 1.7, n: 64, halfW: 8.0, kind: 'arterial' },
    ]) {
        const pts = [];
        for (let i = 0; i < ring.n; i++) {
            const a = (i / ring.n) * Math.PI * 2;
            const r = ring.rad + ring.amp * Math.sin(3 * a + ring.phase) + 90 * Math.cos(5 * a);
            pts.push([Math.cos(a) * r - 120, Math.sin(a) * r]);
        }
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            if (isDrySegment(a[0], a[1], b[0], b[1], 30)) {
                addSeg(a[0], a[1], b[0], b[1], { halfW: ring.halfW, sidewalkW: 2.6, kind: ring.kind });
            }
        }
    }

    // 4. 4 Independently Rotated Urban District Street Networks (kept cleanly behind riverfront boulevards)
    const districts = [
        { name: 'downtown', bank: 'west', cx: riverCenterX(0) - 520,     cz: 40,    yaw: 14 * Math.PI / 180,  rad: 740, step: 142, halfW: 8.0 },
        { name: 'oldtown',  bank: 'east', cx: riverCenterX(180) + 560,   cz: 180,   yaw: -22 * Math.PI / 180, rad: 650, step: 126, halfW: 6.6 },
        { name: 'midtown',  bank: 'west', cx: riverCenterX(-1450) - 520, cz: -1450, yaw: 32 * Math.PI / 180,  rad: 600, step: 142, halfW: 7.6 },
        { name: 'harbor',   bank: 'west', cx: riverCenterX(1550) - 480,  cz: 1550,  yaw: -9 * Math.PI / 180,  rad: 600, step: 144, halfW: 7.6 },
    ];
    const onBank = (bank, x, z) => {
        const rx = riverCenterX(z), hw = riverHalfWidth(z);
        return bank === 'west' ? x < rx - hw - 52 : x > rx + hw + 52;
    };
    for (const d of districts) {
        const ca = Math.cos(d.yaw), sa = Math.sin(d.yaw);
        const toW = (u, v) => [d.cx + ca * u - sa * v, d.cz + sa * u + ca * v];
        const cols = Math.floor(d.rad / d.step);
        for (let i = -cols; i <= cols; i++) {
            const u = i * d.step;
            for (let j = -cols; j < cols; j++) {
                const v0 = j * d.step, v1 = (j + 1) * d.step;
                if (Math.hypot(u, 0.5 * (v0 + v1)) > d.rad) continue;
                const p0 = toW(u, v0), p1 = toW(u, v1);
                if (onBank(d.bank, p0[0], p0[1]) && onBank(d.bank, p1[0], p1[1]) && isDrySegment(p0[0], p0[1], p1[0], p1[1], 32)) {
                    addSeg(p0[0], p0[1], p1[0], p1[1], { halfW: i === 0 ? d.halfW + 1.5 : d.halfW, sidewalkW: 2.6, kind: 'urban' });
                }
            }
        }
        for (let j = -cols; j <= cols; j++) {
            const v = j * d.step;
            for (let i = -cols; i < cols; i++) {
                const u0 = i * d.step, u1 = (i + 1) * d.step;
                if (Math.hypot(0.5 * (u0 + u1), v) > d.rad) continue;
                const p0 = toW(u0, v), p1 = toW(u1, v);
                if (onBank(d.bank, p0[0], p0[1]) && onBank(d.bank, p1[0], p1[1]) && isDrySegment(p0[0], p0[1], p1[0], p1[1], 32)) {
                    addSeg(p0[0], p0[1], p1[0], p1[1], { halfW: j === 0 ? d.halfW + 1.5 : d.halfW, sidewalkW: 2.6, kind: 'urban' });
                }
            }
        }
    }

    // 5. 18 Organic Contour-Following Hillside Suburbs
    const subRng = rngFor(0x50b02b);
    const subCenters = [];
    for (let attempt = 0; attempt < 260 && subCenters.length < 18; attempt++) {
        const ang = (attempt / 260) * Math.PI * 2 + subRng() * 0.25;
        const rad = 1650 + subRng() * 2700;
        const sx = Math.cos(ang) * rad, sz = Math.sin(ang) * rad;
        if (riverSignedDist(sx, sz) < 160) continue;
        const [gx, gz] = terrainGradient(sx, sz, 6.0);
        if (Math.hypot(gx, gz) > 0.22 || terrainHeight(sx, sz) > 74) continue;
        if (subCenters.some((c) => Math.hypot(c[0] - sx, c[1] - sz) < 620)) continue;
        subCenters.push([sx, sz]);

        // Trace primary collector along smooth contour tangent + curving S-bend
        const contourAngle = Math.atan2(gx, -gz) + (subRng() - 0.5) * 0.6;
        const collectorPts = [];
        let px = sx - Math.cos(contourAngle) * 260, pz = sz - Math.sin(contourAngle) * 260;
        let heading = contourAngle;
        for (let step = 0; step <= 8; step++) {
            collectorPts.push([px, pz]);
            const [lgx, lgz] = terrainGradient(px, pz, 6.0);
            const targetH = Math.atan2(lgx, -lgz);
            const curve = 0.22 * Math.sin(step * 0.8 + attempt);
            heading = heading + Math.sin(targetH - heading) * 0.35 + curve;
            px += Math.cos(heading) * 68;
            pz += Math.sin(heading) * 68;
        }
        for (let k = 0; k + 1 < collectorPts.length; k++) {
            const a = collectorPts[k], b = collectorPts[k + 1];
            if (isDrySegment(a[0], a[1], b[0], b[1], 32)) {
                addSeg(a[0], a[1], b[0], b[1], { halfW: 5.0, sidewalkW: 1.8, kind: 'suburb' });
            }
        }
        // Branching curved residential cul-de-sacs off the collector
        for (const bi of [2, 4, 6]) {
            const o = collectorPts[bi];
            const prev = collectorPts[bi - 1];
            const baseA = Math.atan2(o[1] - prev[1], o[0] - prev[0]) + (bi === 4 ? -Math.PI * 0.5 : Math.PI * 0.5);
            const bp = [o];
            let lx = o[0], lz = o[1], la = baseA;
            for (let s = 1; s <= 4; s++) {
                la += (s * 0.14) * (bi & 2 ? 1 : -1);
                lx += Math.cos(la) * 48;
                lz += Math.sin(la) * 48;
                bp.push([lx, lz]);
            }
            for (let k = 0; k + 1 < bp.length; k++) {
                const a = bp[k], b = bp[k + 1];
                if (isDrySegment(a[0], a[1], b[0], b[1], 32)) {
                    addSeg(a[0], a[1], b[0], b[1], { halfW: 4.4, sidewalkW: 1.6, kind: 'suburb' });
                }
            }
        }
    }

    // 6. Elevated Commuter Rail Loop (closed Catmull-Rom) & 5 Named Transit Stations
    const stations = [
        { name: 'Central Waterfront', x: riverCenterX(-80) - 210, z: -80 },
        { name: 'Eastside Arts',      x: riverCenterX(220) + 260, z: 220 },
        { name: 'South Harbor',       x: riverCenterX(1480) - 290, z: 1480 },
        { name: 'West Hills',         x: -2050, z: 120 },
        { name: 'Midtown Tech',       x: riverCenterX(-1420) - 340, z: -1420 },
    ].map((s) => {
        const gy = terrainHeight(s.x, s.z);
        return { ...s, groundY: gy, platformY: gy + 8.5 };
    });

    const loopCtrl = [
        [stations[0].x, stations[0].z],
        [riverCenterX(140) + 20, 140],
        [stations[1].x, stations[1].z],
        [riverCenterX(1100) + 340, 1100],
        [riverCenterX(1520) + 10, 1520],
        [stations[2].x, stations[2].z],
        [-1350, 1280],
        [stations[3].x, stations[3].z],
        [-1720, -1050],
        [stations[4].x, stations[4].z],
        [riverCenterX(-1150) - 240, -1150],
        [riverCenterX(-520) - 220, -520],
    ];
    const transitPts = [];
    const M = loopCtrl.length;
    const SUB = 12;
    for (let i = 0; i < M; i++) {
        const p0 = loopCtrl[(i - 1 + M) % M];
        const p1 = loopCtrl[i];
        const p2 = loopCtrl[(i + 1) % M];
        const p3 = loopCtrl[(i + 2) % M];
        for (let s = 0; s < SUB; s++) {
            const [tx, tz] = catmullRom(p0, p1, p2, p3, s / SUB);
            const rd = riverSignedDist(tx, tz);
            const gy = terrainHeight(tx, tz);
            const deckY = Math.max(gy + 8.0, rd < 45 ? 15.0 : -100);
            transitPts.push({ x: tx, z: tz, y: deckY, minY: Math.max(gy + 7.2, rd < 45 ? 14.5 : -100) });
        }
    }
    for (let pass = 0; pass < 4; pass++) {
        const prevY = transitPts.map((p) => p.y);
        for (let i = 0; i < transitPts.length; i++) {
            const ym = prevY[(i - 1 + transitPts.length) % transitPts.length];
            const yp = prevY[(i + 1) % transitPts.length];
            transitPts[i].y = Math.max(transitPts[i].minY, 0.25 * ym + 0.5 * prevY[i] + 0.25 * yp);
        }
    }
    const transitLoop = [];
    for (let i = 0; i < transitPts.length; i++) {
        const a = transitPts[i], b = transitPts[(i + 1) % transitPts.length];
        transitLoop.push({ x0: a.x, y0: a.y, z0: a.z, x1: b.x, y1: b.y, z1: b.z });
    }

    // Helper: continuous vertical elevation of any road/bridge segment at t in [0..1]
    function sampleRoadDeckY(seg, t) {
        if (!seg.isBridge) {
            const x = seg.x0 + (seg.x1 - seg.x0) * t;
            const z = seg.z0 + (seg.z1 - seg.z0) * t;
            return terrainHeight(x, z) + 0.16;
        }
        const y0 = terrainHeight(seg.x0, seg.z0) + 0.16;
        const y1 = terrainHeight(seg.x1, seg.z1) + 0.16;
        if (t < seg.spanStartT) {
            const w = smoothstep(0, seg.spanStartT, t);
            return y0 + (seg.deckY - y0) * w;
        }
        if (t > seg.spanEndT) {
            const w = smoothstep(1, seg.spanEndT, t);
            return y1 + (seg.deckY - y1) * w;
        }
        const sf = (t - seg.spanStartT) / Math.max(0.01, seg.spanEndT - seg.spanStartT);
        return seg.deckY + Math.sin(sf * Math.PI) * 1.15;
    }

    // Sector buckets ("sx,sz") for fast local queries
    const roadSectors = new Map();
    const transitSectors = new Map();
    const bucketSeg = (map, x0, z0, x1, z1, pad, item) => {
        const sx0 = Math.floor((Math.min(x0, x1) - pad) / SECTOR_SIZE);
        const sx1 = Math.floor((Math.max(x0, x1) + pad) / SECTOR_SIZE);
        const sz0 = Math.floor((Math.min(z0, z1) - pad) / SECTOR_SIZE);
        const sz1 = Math.floor((Math.max(z0, z1) + pad) / SECTOR_SIZE);
        for (let sz = sz0; sz <= sz1; sz++) for (let sx = sx0; sx <= sx1; sx++) {
            const k = `${sx},${sz}`;
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(item);
        }
    };
    for (const seg of roads) bucketSeg(roadSectors, seg.x0, seg.z0, seg.x1, seg.z1, seg.halfW + 32, seg);
    for (const tr of transitLoop) bucketSeg(transitSectors, tr.x0, tr.z0, tr.x1, tr.z1, 16, tr);

    const sectorCache = new Map();
    function getNearbyRoads(sx, sz) {
        const seen = new Set();
        const out = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const list = roadSectors.get(`${sx + dx},${sz + dz}`);
            if (!list) continue;
            for (const s of list) {
                if (seen.has(s.id)) continue;
                seen.add(s.id);
                out.push(s);
            }
        }
        return out;
    }

    function getSectorData(sx, sz) {
        const key = `${sx},${sz}`;
        if (sectorCache.has(key)) return sectorCache.get(key);
        const xMin = sx * SECTOR_SIZE, xMax = xMin + SECTOR_SIZE;
        const zMin = sz * SECTOR_SIZE, zMax = zMin + SECTOR_SIZE;
        const localRoads = roadSectors.get(key) ?? [];
        const nearbyRoads = getNearbyRoads(sx, sz);
        const buildings = [];
        const placedCircles = [];
        const srng = rngFor(((sx * 73856093) ^ (sz * 19349663) ^ 0x4242) >>> 0);

        const clearOfRoads = (cx, cz, bw, bd, facingSegId) => {
            const halfDiag = Math.hypot(bw, bd) * 0.5;
            if (riverSignedDist(cx, cz) < halfDiag + 18) return false;
            for (const r of nearbyRoads) {
                const clearNeed = r.id === facingSegId
                    ? r.halfW + r.sidewalkW + bd * 0.5 + 1.5
                    : r.halfW + r.sidewalkW + halfDiag + 2.6;
                if (pointToSegDistSq(cx, cz, r.x0, r.z0, r.x1, r.z1) < clearNeed * clearNeed) {
                    return false;
                }
            }
            for (const p of placedCircles) {
                if (Math.hypot(cx - p[0], cz - p[1]) < p[2] + halfDiag + 4.5) return false;
            }
            return true;
        };

        // Place transit stations landing inside this sector
        for (let si = 0; si < stations.length; si++) {
            const st = stations[si];
            if (st.x >= xMin && st.x < xMax && st.z >= zMin && st.z < zMax) {
                const gy = terrainHeight(st.x, st.z);
                const bp = generateBuildingBlueprint({
                    id: 9000 + si, seed: 9000 + si, archetype: 'station',
                    x: st.x, z: st.z, groundY: gy, slopeDrop: 1.0, yaw: 0,
                });
                buildings.push(bp);
                placedCircles.push([st.x, st.z, Math.hypot(bp.width, bp.depth) * 0.5]);
            }
        }

        // Seed street-facing buildings strictly aligned to road tangents
        for (const seg of localRoads) {
            if (seg.isBridge || seg.kind === 'arterial') continue;
            const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
            const tx = (seg.x1 - seg.x0) / len, tz = (seg.z1 - seg.z0) / len;
            const nx = -tz, nz = tx;
            const lotStep = seg.kind === 'suburb' ? 30 : 38;
            const endPad = seg.kind === 'urban' ? 28 : 20;
            for (let dist = endPad; dist <= len - endPad; dist += lotStep) {
                const bx0 = seg.x0 + tx * dist, bz0 = seg.z0 + tz * dist;
                for (const side of [-1, 1]) {
                    const distCenter = districtAt(bx0, bz0);
                    if (distCenter === 'river' || distCenter === 'park') continue;
                    const rPick = srng();
                    const arch = distCenter === 'downtown' ? (rPick < 0.36 ? 'skyscraper' : rPick < 0.78 ? 'midrise' : 'shopfront')
                        : distCenter === 'midtown' ? (rPick < 0.28 ? 'skyscraper' : rPick < 0.72 ? 'midrise' : 'shopfront')
                        : distCenter === 'oldtown' ? (rPick < 0.45 ? 'midrise' : 'shopfront')
                        : distCenter === 'harbor' ? (rPick < 0.42 ? 'midrise' : 'shopfront')
                        : 'house';
                    const bWidth = arch === 'skyscraper' ? 20 + srng() * 9 : arch === 'midrise' ? 15 + srng() * 7 : arch === 'shopfront' ? 11 + srng() * 4 : 10 + srng() * 4;
                    const bDepth = arch === 'house' ? 9 + srng() * 3 : bWidth * (0.74 + srng() * 0.14);
                    const setback = seg.halfW + seg.sidewalkW + bDepth * 0.5 + (arch === 'house' ? 4.8 : 2.8);
                    const cx = bx0 + nx * side * setback;
                    const cz = bz0 + nz * side * setback;
                    if (seg.kind === 'boulevard' && riverSignedDist(cx, cz) < riverSignedDist(bx0, bz0)) continue;
                    if (cx < xMin || cx >= xMax || cz < zMin || cz >= zMax) continue;
                    if (!clearOfRoads(cx, cz, bWidth, bDepth, seg.id)) continue;
                    // Slope drop across building corners so hillside foundations never float
                    const c0 = terrainHeight(cx - bWidth * 0.45, cz - bDepth * 0.45);
                    const c1 = terrainHeight(cx + bWidth * 0.45, cz + bDepth * 0.45);
                    const c2 = terrainHeight(cx - bWidth * 0.45, cz + bDepth * 0.45);
                    const c3 = terrainHeight(cx + bWidth * 0.45, cz - bDepth * 0.45);
                    const hi = Math.max(c0, c1, c2, c3), lo = Math.min(c0, c1, c2, c3);
                    if (hi - lo > (arch === 'house' ? 7.5 : 5.5)) continue;
                    const groundY = 0.5 * (hi + lo);
                    const slopeDrop = hi - lo;
                    // Face doorway (+Z local) toward the road
                    const toRoadX = -nx * side, toRoadZ = -nz * side;
                    const yaw = Math.atan2(toRoadX, toRoadZ);
                    const bid = (((sx + 32) & 63) << 18) | (((sz + 32) & 63) << 12) | buildings.length;
                    const floors = arch === 'skyscraper' ? 10 + Math.floor(srng() * 24) : undefined;
                    const bp = generateBuildingBlueprint({
                        id: bid, seed: bid * 2654435761, archetype: arch,
                        width: bWidth, depth: bDepth, floors, groundY, slopeDrop, yaw, x: cx, z: cz,
                    });
                    buildings.push(bp);
                    placedCircles.push([cx, cz, Math.hypot(bWidth, bDepth) * 0.48]);
                }
            }
        }

        // Seed terrain-elevated trees strictly outside water, road corridors, and building footprints
        const trees = [];
        const tries = localRoads.length > 0 ? 48 : 34;
        for (let ti = 0; ti < tries; ti++) {
            const tx = xMin + 8 + srng() * (SECTOR_SIZE - 16);
            const tz = zMin + 8 + srng() * (SECTOR_SIZE - 16);
            if (riverSignedDist(tx, tz) < 12) continue;
            const d = districtAt(tx, tz);
            const prob = d === 'park' || d === 'hills' ? 0.78 : d === 'suburb' ? 0.45 : 0.16;
            if (srng() > prob) continue;
            let clear = true;
            for (const r of nearbyRoads) {
                if (pointToSegDistSq(tx, tz, r.x0, r.z0, r.x1, r.z1) < (r.halfW + r.sidewalkW + 4.5) ** 2) {
                    clear = false; break;
                }
            }
            if (!clear) continue;
            for (const p of placedCircles) {
                if (Math.hypot(tx - p[0], tz - p[1]) < p[2] + 4.5) { clear = false; break; }
            }
            if (!clear) continue;
            trees.push({
                x: tx,
                y: terrainHeight(tx, tz),
                z: tz,
                yaw: srng() * Math.PI * 2,
                size: 0.78 + srng() * 0.44,
                speciesIdx: Math.floor(srng() * 4),
            });
        }

        const data = {
            sx, sz,
            roads: localRoads,
            transit: transitSectors.get(key) ?? [],
            buildings,
            trees,
        };
        sectorCache.set(key, data);
        return data;
    }

    return {
        roads,
        bridges,
        transitLoop,
        stations,
        getSectorData,
        sampleRoadDeckY,
        stats: () => ({
            roadCount: roads.length,
            bridgeCount: bridges.length,
            transitCount: transitLoop.length,
            stationCount: stations.length,
            cachedSectors: sectorCache.size,
        }),
    };
}
